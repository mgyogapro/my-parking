const http = require('http');
const fs = require('fs');
const path = require('path');

// ═══ КОНФИГУРАЦИЯ ═══
const ADMIN_PASSWORD = 'Bron5s3';
const TOTAL_SPOTS = 10;
const TIMEZONE = 'Europe/Moscow'; // часовой пояс работы
const BOOKING_START_HOUR = 6; // начало окна бронирования
const BOOKING_START_MIN = 1;
const BOOKING_END_HOUR = 23;
const BOOKING_END_MIN = 59;
const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');

// ═══ СОСТОЯНИЕ ═══
let state = { date: null, bookings: {} };

function getNow() {
const fmt = new Intl.DateTimeFormat('sv-SE', {
timeZone: TIMEZONE,
year: 'numeric', month: '2-digit', day: '2-digit',
hour: '2-digit', minute: '2-digit', hour12: false
});
const [datePart, timePart] = fmt.format(new Date()).split(' ');
const [hour, minute] = timePart.split(':').map(Number);
return { date: datePart, hour, minute };
}

function getToday() { return getNow().date; }

function isBookingWindow() {
const { hour, minute } = getNow();
const cur = hour * 60 + minute;
const start = BOOKING_START_HOUR * 60 + BOOKING_START_MIN;
const end = BOOKING_END_HOUR * 60 + BOOKING_END_MIN;
return cur >= start && cur <= end;
}

function resetIfNewDay() {
const today = getToday();
if (state.date !== today) {
state = { date: today, bookings: {} };
saveState();
}
}

function loadState() {
try {
const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
if (data.date === getToday()) state = data;
else state = { date: getToday(), bookings: {} };
} catch {
state = { date: getToday(), bookings: {} };
}
}

function saveState() {
try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); }
catch (e) { console.error('saveState:', e); }
}

function getStatus() {
resetIfNewDay();
return {
date: state.date,
totalSpots: TOTAL_SPOTS,
spots: state.bookings,
canBook: isBookingWindow(),
serverTime: new Date().toISOString(),
timezone: TIMEZONE
};
}

function sendJson(res, code, data) {
res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify(data));
}

function readBody(req) {
return new Promise(resolve => {
let data = '';
req.on('data', c => data += c);
req.on('end', () => {
try { resolve(JSON.parse(data || '{}')); }
catch { resolve({}); }
});
});
}

function normPlate(p) {
return String(p || '').trim().toUpperCase().replace(/\s+/g, '');
}

// ═══ СЕРВЕР ═══
const server = http.createServer(async (req, res) => {
const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
const p = url.pathname;

try {
if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
res.end(html);
return;
}

if (req.method === 'GET' && p === '/api/status') {
return sendJson(res, 200, getStatus());
}

if (req.method === 'POST' && p === '/api/book') {
const { spot, plate } = await readBody(req);
resetIfNewDay();

if (!isBookingWindow()) {
return sendJson(res, 400, { error: 'Бронирование доступно ежедневно с 06:01 до 23:59' });
}

const spotNum = parseInt(spot);
if (!spotNum || spotNum < 1 || spotNum > TOTAL_SPOTS) {
return sendJson(res, 400, { error: 'Неверный номер места' });
}

const plateNorm = normPlate(plate);
if (!plateNorm) return sendJson(res, 400, { error: 'Введите гос. номер' });
if (plateNorm.length > 20) return sendJson(res, 400, { error: 'Слишком длинный номер' });

if (state.bookings[spotNum]) {
return sendJson(res, 400, { error: 'Это место уже забронировано' });
}

for (const [s, b] of Object.entries(state.bookings)) {
if (b.plate === plateNorm) {
return sendJson(res, 400, { error: `Этот номер уже забронирован (место ${s})` });
}
}

state.bookings[spotNum] = { plate: plateNorm, bookedAt: new Date().toISOString() };
saveState();
return sendJson(res, 200, { ok: true });
}

if (req.method === 'POST' && p === '/api/cancel') {
const { spot, plate } = await readBody(req);
resetIfNewDay();

const spotNum = parseInt(spot);
const booking = state.bookings[spotNum];
if (!booking) return sendJson(res, 404, { error: 'Брони на этом месте нет' });

if (booking.plate !== normPlate(plate)) {
return sendJson(res, 403, { error: 'Это не ваша бронь. Проверьте гос. номер.' });
}

delete state.bookings[spotNum];
saveState();
return sendJson(res, 200, { ok: true });
}

if (req.method === 'POST' && p === '/api/admin/verify') {
const { password } = await readBody(req);
if (password !== ADMIN_PASSWORD) return sendJson(res, 403, { error: 'Неверный пароль' });
return sendJson(res, 200, { ok: true });
}

if (req.method === 'POST' && p === '/api/admin/cancel') {
const { spot, password } = await readBody(req);
if (password !== ADMIN_PASSWORD) return sendJson(res, 403, { error: 'Неверный пароль' });
resetIfNewDay();
const spotNum = parseInt(spot);
if (!state.bookings[spotNum]) return sendJson(res, 404, { error: 'Брони нет' });
delete state.bookings[spotNum];
saveState();
return sendJson(res, 200, { ok: true });
}

sendJson(res, 404, { error: 'Not found' });
} catch (e) {
console.error(e);
sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
}
});

loadState();
server.listen(PORT, () => {
console.log(`🅿️ Сервер запущен: http://localhost:${PORT}`);
console.log(` Пароль админа: ${ADMIN_PASSWORD}`);
console.log(` Часовой пояс: ${TIMEZONE}`);
});