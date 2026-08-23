const crypto = require("crypto");

const ROUND_MS = 120000;
const WIDTH = 1000;
const HEIGHT = 620;

const THREATS = [
  { id: "sqli", name: "SQL Creeper", cwe: "CWE-89", color: "#ff4d3d", hp: 70, damage: 55, score: 120 },
  { id: "ssrf", name: "Portal Ghast", cwe: "CWE-918", color: "#b06cff", hp: 92, damage: 75, score: 160 },
  { id: "secret", name: "Key Thief", cwe: "CWE-798", color: "#32d6ff", hp: 64, damage: 60, score: 130 },
  { id: "loader", name: "YAML Slime", cwe: "CWE-502", color: "#ffcf4d", hp: 82, damage: 70, score: 145 }
];

const TEAM_BLUEPRINTS = [
  { id: "redstone", name: "Redstone", color: "#ff4d3d", x: 170 },
  { id: "diamond", name: "Diamond", color: "#32d6ff", x: 390 },
  { id: "emerald", name: "Emerald", color: "#42e66f", x: 610 },
  { id: "nether", name: "Nether", color: "#b06cff", x: 830 }
];

function freshTeams() {
  return TEAM_BLUEPRINTS.map((team) => ({
    ...team,
    score: 0,
    energy: 0,
    shield: 0,
    shots: 0,
    hits: 0
  }));
}

const state = globalThis.__securecraftState || {
  phase: "lobby",
  roomCode: "RUN",
  players: {},
  teams: freshTeams(),
  threats: [],
  blasts: [],
  coreHp: 1000,
  maxCoreHp: 1000,
  startedAt: null,
  lastTick: Date.now(),
  nextSpawnAt: 0,
  feed: [{ type: "system", text: "Lobby open. Join CodeSecure Creeper Run." }],
  winner: null
};

globalThis.__securecraftState = state;

function pushFeed(text, type = "system") {
  state.feed.unshift({ text, type, time: new Date().toLocaleTimeString() });
  state.feed = state.feed.slice(0, 8);
}

function playerList() {
  return Object.values(state.players);
}

function teamById(id) {
  return state.teams.find((team) => team.id === id) || state.teams[0];
}

function elapsed(now = Date.now()) {
  return state.startedAt ? Math.max(0, now - state.startedAt) : 0;
}

function spawn(now) {
  const t = elapsed(now);
  const type = THREATS[Math.floor((t / 4200 + state.threats.length) % THREATS.length)];
  const scale = 1 + Math.min(1.1, t / ROUND_MS);
  const x = 80 + Math.floor(Math.random() * (WIDTH - 160));
  state.threats.push({
    id: crypto.randomUUID(),
    type: type.id,
    name: type.name,
    cwe: type.cwe,
    color: type.color,
    x,
    y: -40,
    hp: Math.round(type.hp * scale),
    maxHp: Math.round(type.hp * scale),
    damage: Math.round(type.damage * scale),
    score: Math.round(type.score * scale),
    speed: 78 + Math.random() * 48 + t / 1800,
    createdAt: now
  });
}

function addBlast(x, y, color, label) {
  state.blasts.push({ id: crypto.randomUUID(), x, y, color, label, at: Date.now() });
  state.blasts = state.blasts.slice(-18);
}

function advance(now = Date.now()) {
  if (state.phase !== "running") return;
  const dt = Math.min(0.12, Math.max(0, (now - state.lastTick) / 1000));
  state.lastTick = now;

  if (now - state.startedAt >= ROUND_MS) {
    state.phase = "ended";
    state.winner = [...state.teams].sort((a, b) => b.score - a.score)[0] || null;
    pushFeed(`Time. ${state.winner.name} wins the bug bounty run.`, "success");
    return;
  }

  if (now >= state.nextSpawnAt) {
    spawn(now);
    state.nextSpawnAt = now + Math.max(520, 1250 - elapsed(now) / 120);
  }

  for (const threat of [...state.threats]) {
    threat.y += threat.speed * dt;
    if (threat.y >= HEIGHT - 90) {
      const shieldTeam = state.teams.find((team) => team.shield > 0);
      if (shieldTeam) {
        shieldTeam.shield = Math.max(0, shieldTeam.shield - threat.damage);
        shieldTeam.score += 35;
        addBlast(threat.x, threat.y, shieldTeam.color, "BLOCK");
      } else {
        state.coreHp = Math.max(0, state.coreHp - threat.damage);
        addBlast(threat.x, threat.y, threat.color, "HIT");
      }
      state.threats = state.threats.filter((item) => item.id !== threat.id);
    }
  }

  state.blasts = state.blasts.filter((blast) => now - blast.at < 1400);

  if (state.coreHp <= 0) {
    state.phase = "ended";
    state.winner = [...state.teams].sort((a, b) => b.score - a.score)[0] || null;
    pushFeed("Server core crashed. Highest bounty score takes it.", "danger");
  }
}

function snapshot(joinUrl) {
  advance();
  return {
    phase: state.phase,
    roomCode: state.roomCode,
    players: playerList(),
    teams: state.teams,
    threats: state.threats,
    blasts: state.blasts,
    coreHp: state.coreHp,
    maxCoreHp: state.maxCoreHp,
    startedAt: state.startedAt,
    durationMs: ROUND_MS,
    elapsedMs: elapsed(),
    feed: state.feed,
    winner: state.winner,
    arena: { width: WIDTH, height: HEIGHT },
    joinUrl
  };
}

function join(body) {
  const id = crypto.randomUUID();
  const team = teamById(body.team);
  state.players[id] = {
    id,
    name: String(body.name || "Player").slice(0, 18),
    team: team.id,
    score: 0,
    actions: 0,
    lastActionAt: {}
  };
  pushFeed(`${state.players[id].name} joined ${team.name}.`, "join");
  return { ok: true, playerId: id };
}

function cooldown(player, kind, ms) {
  const now = Date.now();
  const last = player.lastActionAt[kind] || 0;
  if (now - last < ms) return false;
  player.lastActionAt[kind] = now;
  return true;
}

function action(body) {
  advance();
  const player = state.players[body.playerId];
  if (!player || state.phase !== "running") return { ok: false, message: "Game not running." };
  const team = teamById(player.team);
  const kind = String(body.kind || "");
  player.actions += 1;

  if (kind === "left" && cooldown(player, kind, 120)) {
    team.x = Math.max(55, team.x - 42);
    return { ok: true, message: "Moved left." };
  }

  if (kind === "right" && cooldown(player, kind, 120)) {
    team.x = Math.min(WIDTH - 55, team.x + 42);
    return { ok: true, message: "Moved right." };
  }

  if (kind === "shield" && cooldown(player, kind, 1800)) {
    team.shield = Math.min(220, team.shield + 85);
    team.energy = Math.min(100, team.energy + 8);
    team.score += 20;
    player.score += 20;
    addBlast(team.x, HEIGHT - 100, team.color, "SHIELD");
    return { ok: true, message: "Firewall shield up." };
  }

  if (kind === "shoot" && cooldown(player, kind, 420)) {
    team.shots += 1;
    const target = state.threats
      .filter((threat) => Math.abs(threat.x - team.x) < 92)
      .sort((a, b) => b.y - a.y)[0];
    if (!target) {
      addBlast(team.x, HEIGHT - 138, team.color, "MISS");
      return { ok: true, message: "Patch shot missed." };
    }

    const damage = 44 + Math.round(team.energy / 6);
    target.hp -= damage;
    team.energy = Math.min(100, team.energy + 10);
    team.hits += 1;
    player.score += 18;
    team.score += 18;
    addBlast(target.x, target.y, team.color, "PATCH");

    if (target.hp <= 0) {
      state.threats = state.threats.filter((item) => item.id !== target.id);
      team.score += target.score;
      player.score += Math.round(target.score * 0.45);
      team.energy = Math.min(100, team.energy + 18);
      pushFeed(`${player.name} patched ${target.name}. +${target.score}`, "success");
    }
    return { ok: true, message: `Patch shot hit ${target.name}.` };
  }

  if (kind === "ultimate" && team.energy >= 100 && cooldown(player, kind, 4000)) {
    team.energy = 0;
    let cleared = 0;
    for (const threat of [...state.threats]) {
      if (Math.abs(threat.x - team.x) < 190 || threat.y > HEIGHT * 0.48) {
        cleared += 1;
        team.score += threat.score;
        player.score += Math.round(threat.score * 0.3);
        addBlast(threat.x, threat.y, team.color, "AGENT");
        state.threats = state.threats.filter((item) => item.id !== threat.id);
      }
    }
    pushFeed(`${team.name} fired CodeSecure Agent Burst and cleared ${cleared}.`, "power");
    return { ok: true, message: `Agent Burst cleared ${cleared} threats.` };
  }

  return { ok: false, message: "Cooling down or not enough energy." };
}

function host(actionName) {
  if (actionName === "start") {
    state.phase = "running";
    state.players = { ...state.players };
    state.teams = freshTeams();
    for (const player of playerList()) {
      player.score = 0;
      player.actions = 0;
      player.lastActionAt = {};
    }
    state.threats = [];
    state.blasts = [];
    state.coreHp = state.maxCoreHp;
    state.startedAt = Date.now();
    state.lastTick = state.startedAt;
    state.nextSpawnAt = state.startedAt + 600;
    state.winner = null;
    state.feed = [{ type: "system", text: "Creeper Run started. Patch mobs before they hit the core." }];
    return { ok: true };
  }

  if (actionName === "reset") {
    state.phase = "lobby";
    state.players = {};
    state.teams = freshTeams();
    state.threats = [];
    state.blasts = [];
    state.coreHp = state.maxCoreHp;
    state.startedAt = null;
    state.nextSpawnAt = 0;
    state.winner = null;
    state.feed = [{ type: "system", text: "Lobby reset. Join CodeSecure Creeper Run." }];
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
