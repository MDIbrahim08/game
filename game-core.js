const crypto = require("crypto");

const ROUND_MS = 150000;
const LANES = ["Gateway", "Config", "Webhook", "Vault"];

const THREAT_TYPES = [
  {
    id: "sqli",
    name: "SQL Injection",
    cwe: "CWE-89",
    lane: 0,
    hp: 130,
    impact: 95,
    reward: 170,
    color: "#ff4d3d",
    code: "\"SELECT * FROM users WHERE id = \" + input",
    secure: "Parameterized query"
  },
  {
    id: "deser",
    name: "Unsafe Loader",
    cwe: "CWE-502",
    lane: 1,
    hp: 155,
    impact: 110,
    reward: 190,
    color: "#ffcf4d",
    code: "yaml.load(user_file)",
    secure: "safe_load + schema"
  },
  {
    id: "ssrf",
    name: "SSRF Portal",
    cwe: "CWE-918",
    lane: 2,
    hp: 170,
    impact: 125,
    reward: 220,
    color: "#b06cff",
    code: "fetch(req.body.url)",
    secure: "allowlist + block private IPs"
  },
  {
    id: "secret",
    name: "Secret Leak",
    cwe: "CWE-798",
    lane: 3,
    hp: 145,
    impact: 105,
    reward: 185,
    color: "#32d6ff",
    code: "const API_KEY = \"sk_live_...\"",
    secure: "secret manager"
  },
  {
    id: "zero-day",
    name: "BugCrafter Core",
    cwe: "MULTI",
    lane: 2,
    hp: 360,
    impact: 230,
    reward: 520,
    color: "#42e66f",
    code: "AI pull request contains login + webhook + config risks",
    secure: "Scanner -> CWE -> RAG -> Patch -> Judge"
  }
];

const TEAM_BLUEPRINTS = [
  { id: "redstone", name: "Redstone", color: "#ff4d3d" },
  { id: "diamond", name: "Diamond", color: "#32d6ff" },
  { id: "emerald", name: "Emerald", color: "#42e66f" },
  { id: "nether", name: "Nether", color: "#b06cff" }
];

function freshTeams() {
  return TEAM_BLUEPRINTS.map((team) => ({
    ...team,
    score: 0,
    energy: 0,
    agents: 0,
    actions: 0
  }));
}

const state = globalThis.__securecraftState || {
  phase: "lobby",
  roomCode: "RAID",
  players: {},
  teams: freshTeams(),
  threats: [],
  defeated: [],
  feed: [{ type: "system", text: "Lobby open. Players can join the CodeSecure Core Raid." }],
  startedAt: null,
  lastTick: Date.now(),
  nextSpawnAt: 0,
  coreHp: 1000,
  maxCoreHp: 1000,
  shield: 0,
  combo: 1,
  winner: null
};

globalThis.__securecraftState = state;

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function pushFeed(text, type = "system") {
  state.feed.unshift({ type, text, time: nowLabel() });
  state.feed = state.feed.slice(0, 10);
}

function teamById(id) {
  return state.teams.find((team) => team.id === id) || state.teams[0];
}

function playerList() {
  return Object.values(state.players);
}

function elapsed(now = Date.now()) {
  return state.startedAt ? Math.max(0, now - state.startedAt) : 0;
}

function spawnThreat(now) {
  const t = elapsed(now);
  let type;
  if (t > ROUND_MS - 30000 && !state.threats.some((x) => x.type === "zero-day") && !state.defeated.some((x) => x.type === "zero-day")) {
    type = THREAT_TYPES.find((item) => item.id === "zero-day");
  } else {
    const pool = THREAT_TYPES.filter((item) => item.id !== "zero-day");
    type = pool[Math.floor((t / 7000 + state.threats.length) % pool.length)];
  }

  const scale = 1 + Math.min(0.8, t / ROUND_MS);
  const threat = {
    id: crypto.randomUUID(),
    type: type.id,
    name: type.name,
    cwe: type.cwe,
    lane: type.lane,
    hp: Math.round(type.hp * scale),
    maxHp: Math.round(type.hp * scale),
    impact: Math.round(type.impact * scale),
    reward: Math.round(type.reward * scale),
    color: type.color,
    code: type.code,
    secure: type.secure,
    spawnAt: now,
    reachAt: now + (type.id === "zero-day" ? 28000 : 23000 - Math.min(5500, t / 18)),
    scanned: false
  };

  state.threats.push(threat);
  pushFeed(`${threat.name} entered ${LANES[threat.lane]} lane.`, "warning");
}

function applyCoreDamage(amount) {
  const blocked = Math.min(state.shield, amount);
  state.shield -= blocked;
  const damage = amount - blocked;
  state.coreHp = Math.max(0, state.coreHp - damage);
  if (damage > 0) pushFeed(`Server core took ${damage} damage.`, "danger");
  if (blocked > 0) pushFeed(`CodeSecure firewall blocked ${blocked} damage.`, "success");
}

function defeatThreat(threat, team, actorName, source) {
  state.threats = state.threats.filter((item) => item.id !== threat.id);
  state.defeated.push({ type: threat.type, name: threat.name, team: team.id, at: Date.now() });
  state.defeated = state.defeated.slice(-20);
  const points = Math.round(threat.reward * state.combo);
  team.score += points;
  team.energy = Math.min(100, team.energy + 24);
  team.actions += 1;
  state.combo = Math.min(5, state.combo + 0.15);
  pushFeed(`${actorName} neutralized ${threat.name} with ${source}. +${points}`, "success");
}

function runAgentBursts() {
  for (const team of state.teams) {
    if (team.energy < 100 || state.threats.length === 0) continue;
    team.energy = 0;
    team.agents += 1;
    const damage = 78 + team.agents * 8;
    for (const threat of state.threats) {
      threat.hp -= damage;
      threat.scanned = true;
    }
    team.score += 180;
    state.shield = Math.min(420, state.shield + 70);
    pushFeed(`Team ${team.name} triggered CodeSecure Agent Burst.`, "power");
  }
}

function advance(now = Date.now()) {
  if (state.phase !== "running") return;

  if (state.startedAt && now - state.startedAt >= ROUND_MS) {
    state.phase = "ended";
    state.winner = [...state.teams].sort((a, b) => b.score - a.score)[0] || null;
    pushFeed(`Raid complete. Team ${state.winner ? state.winner.name : "CodeSecure"} leads the defense.`, "success");
    return;
  }

  if (now >= state.nextSpawnAt) {
    spawnThreat(now);
    const pressure = Math.max(3600, 7400 - elapsed(now) / 45);
    state.nextSpawnAt = now + pressure;
  }

  for (const threat of [...state.threats]) {
    if (threat.hp <= 0) {
      const team = [...state.teams].sort((a, b) => b.energy - a.energy)[0] || state.teams[0];
      defeatThreat(threat, team, "CodeSecure", "auto-patch");
      continue;
    }
    if (now >= threat.reachAt) {
      state.threats = state.threats.filter((item) => item.id !== threat.id);
      applyCoreDamage(threat.impact);
      state.combo = 1;
    }
  }

  runAgentBursts();

  if (state.coreHp <= 0) {
    state.phase = "ended";
    state.winner = [...state.teams].sort((a, b) => b.score - a.score)[0] || null;
    pushFeed("Server core collapsed. Check the scoreboard for the best defenders.", "danger");
  }
}

function snapshot(joinUrl) {
  advance();
  const now = Date.now();
  return {
    phase: state.phase,
    roomCode: state.roomCode,
    players: playerList(),
    teams: state.teams,
    threats: state.threats.map((threat) => ({
      ...threat,
      progress: Math.max(0, Math.min(1, (now - threat.spawnAt) / (threat.reachAt - threat.spawnAt)))
    })),
    defeated: state.defeated,
    feed: state.feed,
    coreHp: state.coreHp,
    maxCoreHp: state.maxCoreHp,
    shield: state.shield,
    combo: state.combo,
    startedAt: state.startedAt,
    durationMs: ROUND_MS,
    elapsedMs: elapsed(now),
    lanes: LANES,
    threatTypes: THREAT_TYPES,
    winner: state.winner,
    joinUrl
  };
}

function join(body) {
  const id = crypto.randomUUID();
  const team = teamById(body.team);
  state.players[id] = {
    id,
    name: String(body.name || "Operator").slice(0, 18),
    team: team.id,
    score: 0,
    actions: 0,
    lastActionAt: {},
    joinedAt: Date.now()
  };
  pushFeed(`${state.players[id].name} joined Team ${team.name}.`, "join");
  return { ok: true, playerId: id };
}

function action(body) {
  advance();
  const player = state.players[body.playerId];
  if (!player || state.phase !== "running") return { ok: false, message: "Raid is not running." };

  const kind = String(body.kind || "");
  const cooldowns = { scan: 900, patch: 1600, shield: 2600, overclock: 3200 };
  const last = player.lastActionAt[kind] || 0;
  const now = Date.now();
  if (now - last < (cooldowns[kind] || 1000)) {
    return { ok: false, message: "Action cooling down." };
  }
  player.lastActionAt[kind] = now;
  player.actions += 1;

  const team = teamById(player.team);
  const target = [...state.threats].sort((a, b) => b.progress - a.progress)[0];
  let score = 0;
  let message = "";

  if (kind === "scan") {
    if (target) {
      target.scanned = true;
      target.hp -= 18;
    }
    team.energy = Math.min(100, team.energy + 12);
    score = 22;
    message = "Scanner ping sent.";
  }

  if (kind === "patch") {
    if (target) {
      const damage = target.scanned ? 68 : 46;
      target.hp -= damage;
      score = damage;
      message = `Patch packet hit ${target.name}.`;
      if (target.hp <= 0) defeatThreat(target, team, player.name, "manual patch");
    } else {
      score = 10;
      message = "No active threat. Patch cached.";
    }
    team.energy = Math.min(100, team.energy + 16);
  }

  if (kind === "shield") {
    state.shield = Math.min(420, state.shield + 46);
    team.energy = Math.min(100, team.energy + 9);
    score = 34;
    message = "Firewall shield reinforced.";
  }

  if (kind === "overclock") {
    for (const threat of state.threats) threat.hp -= 28;
    team.energy = Math.min(100, team.energy + 22);
    score = 55;
    message = "Multi-agent overclock fired.";
  }

  player.score += score;
  team.score += score;
  team.actions += 1;
  pushFeed(`${player.name}: ${message}`, "power");
  advance();
  return { ok: true, score, message };
}

function host(actionName) {
  if (actionName === "start") {
    state.phase = "running";
    state.startedAt = Date.now();
    state.lastTick = state.startedAt;
    state.nextSpawnAt = state.startedAt + 1000;
    state.threats = [];
    state.defeated = [];
    state.coreHp = state.maxCoreHp;
    state.shield = 120;
    state.combo = 1;
    state.winner = null;
    for (const team of state.teams) {
      team.score = 0;
      team.energy = 0;
      team.agents = 0;
      team.actions = 0;
    }
    for (const player of playerList()) {
      player.score = 0;
      player.actions = 0;
      player.lastActionAt = {};
    }
    state.feed = [{ type: "system", text: "Raid started. Defend the server core." }];
    return { ok: true };
  }

  if (actionName === "reset") {
    state.phase = "lobby";
    state.players = {};
    state.teams = freshTeams();
    state.threats = [];
    state.defeated = [];
    state.startedAt = null;
    state.nextSpawnAt = 0;
    state.coreHp = state.maxCoreHp;
    state.shield = 0;
    state.combo = 1;
    state.winner = null;
    state.feed = [{ type: "system", text: "Lobby reset. Players can join the next Core Raid." }];
    return { ok: true };
  }

  return { ok: false };
}

function route(actionName, body = {}) {
  if (actionName === "join") return join(body);
  if (actionName === "action") return action(body);
  if (actionName && actionName.startsWith("host:")) return host(actionName.slice(5));
  return { ok: false };
}

module.exports = { snapshot, route };
