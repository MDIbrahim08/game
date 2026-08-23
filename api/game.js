const { createState, applyAction, playerSnapshot, hostSnapshot } = require('../game-core');

const memory = globalThis.__commitImpostorRooms || (globalThis.__commitImpostorRooms = new Map());

function cleanRoom(value) {
  return String(value || 'showtime').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'showtime';
}

function kvConfigured() {
  return Boolean(redisUrl() && redisToken());
}

function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}

function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

async function kvCommand(command) {
  const response = await fetch(redisUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`KV request failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function readRoom(room) {
  const key = cleanRoom(room);
  if (!kvConfigured()) {
    if (!memory.has(key)) memory.set(key, createState(key));
    return memory.get(key);
  }
  const raw = await kvCommand(['GET', `commit-impostor:${key}`]);
  return raw ? JSON.parse(raw) : createState(key);
}

async function writeRoom(state) {
  if (!kvConfigured()) {
    memory.set(state.room, state);
    return;
  }
  await kvCommand(['SET', `commit-impostor:${state.room}`, JSON.stringify(state), 'EX', 7200]);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const state = await readRoom(req.query.room);
      const snapshot = req.query.host === '1' ? hostSnapshot(state) : playerSnapshot(state, req.query.player);
      await writeRoom(state);
      return res.status(200).json(snapshot);
    }
    if (req.method === 'POST') {
      const state = await readRoom(req.body?.room);
      const result = applyAction(state, req.body || {});
      const finalState = result.reset || state;
      await writeRoom(finalState);
      return res.status(200).json({ ok: true, ...result });
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    return res.status(400).json({ error: error.publicMessage || error.message || 'Request failed.' });
  }
};
