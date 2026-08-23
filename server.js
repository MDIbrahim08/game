const http = require('http');
const fs = require('fs');
const path = require('path');
const { createState, applyAction, playerSnapshot, hostSnapshot } = require('./game-core');

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();

function cleanRoom(value) {
  return String(value || 'showtime').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'showtime';
}

function getRoom(room) {
  const key = cleanRoom(room);
  if (!rooms.has(key)) rooms.set(key, createState(key));
  return rooms.get(key);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON payload.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname === '/api/game') {
    try {
      if (req.method === 'GET') {
        const state = getRoom(requestUrl.searchParams.get('room'));
        const playerId = requestUrl.searchParams.get('player');
        const host = requestUrl.searchParams.get('host') === '1';
        return send(res, 200, host ? hostSnapshot(state) : playerSnapshot(state, playerId));
      }
      if (req.method === 'POST') {
        const input = await parseBody(req);
        const state = getRoom(input.room);
        const result = applyAction(state, input);
        if (result.reset) rooms.set(state.room, result.reset);
        return send(res, 200, { ok: true, ...result });
      }
      return send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      return send(res, 400, { error: error.publicMessage || error.message || 'Request failed.' });
    }
  }

  const requested = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
  const safePath = path.join(__dirname, requested);
  if (!safePath.startsWith(__dirname) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
  const ext = path.extname(safePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return send(res, 200, fs.readFileSync(safePath), types[ext] || 'application/octet-stream');
});

server.listen(PORT, () => {
  console.log(`Commit Impostor running at http://localhost:${PORT}`);
});
