const crypto = require("crypto");

const teams = [
  { id: "redstone", name: "Redstone", color: "#ff4d3d", score: 0, artifacts: [] },
  { id: "diamond", name: "Diamond", color: "#32d6ff", score: 0, artifacts: [] },
  { id: "emerald", name: "Emerald", color: "#42e66f", score: 0, artifacts: [] },
  { id: "nether", name: "Nether", color: "#b06cff", score: 0, artifacts: [] }
];

const missions = [
  {
    id: "login-cave",
    title: "Redstone Login Cave",
    artifact: "Redstone Key",
    biome: "Cave Gate",
    bugCrafter: "I built the login gate fast. Surely string concat is fine.",
    code: "const q = \"SELECT * FROM users WHERE id = \" + input;\ndb.query(q);",
    cwe: "CWE-89",
    vulnerability: "SQL Injection",
    patch: "Use parameterized queries",
    agent: "Scanner + Patch",
    correct: { vuln: 0, patch: 1, agent: 0 },
    questions: {
      vuln: ["SQL Injection", "Hardcoded Secret", "Unsafe Deserialization", "XSS"],
      patch: ["Escape by replacing spaces", "Use parameterized queries", "Hide the query in Base64", "Disable the login route"],
      agent: ["Scanner + Patch", "Visual Judge only", "Speech Agent", "Backup Agent"]
    }
  },
  {
    id: "potion-forest",
    title: "Potion Config Forest",
    artifact: "Potion Shield",
    biome: "Config Grove",
    bugCrafter: "My potion loader accepts any uploaded recipe. Very flexible.",
    code: "import yaml\nconfig = yaml.load(user_file)\napply_config(config)",
    cwe: "CWE-502",
    vulnerability: "Unsafe Deserialization",
    patch: "Use safe_load and strict schema validation",
    agent: "CWE + Patch",
    correct: { vuln: 2, patch: 0, agent: 1 },
    questions: {
      vuln: ["CSRF", "Open Redirect", "Unsafe Deserialization", "Path Traversal"],
      patch: ["Use safe_load and strict schema validation", "Rename the YAML file", "Compress the upload", "Allow only admins to upload huge files"],
      agent: ["Visual Judge only", "CWE + Patch", "Speech Agent", "Formatter Agent"]
    }
  },
  {
    id: "nether-bridge",
    title: "Nether Webhook Bridge",
    artifact: "Nether Compass",
    biome: "Portal Bridge",
    bugCrafter: "The webhook fetches any URL. What could a portal possibly leak?",
    code: "app.post('/webhook/test', async (req, res) => {\n  const r = await fetch(req.body.url);\n  res.send(await r.text());\n});",
    cwe: "CWE-918",
    vulnerability: "Server-Side Request Forgery",
    patch: "Allowlist domains and block private/internal IP ranges",
    agent: "Scanner + Judge",
    correct: { vuln: 1, patch: 2, agent: 2 },
    questions: {
      vuln: ["Race Condition", "Server-Side Request Forgery", "Weak Hashing", "Clickjacking"],
      patch: ["Add a loading spinner", "Only use HTTPS text", "Allowlist domains and block private/internal IP ranges", "Retry the request three times"],
      agent: ["Patch only", "Visual Judge only", "Scanner + Judge", "Formatter Agent"]
    }
  },
  {
    id: "diamond-vault",
    title: "Diamond Vault Mountain",
    artifact: "Diamond Map",
    biome: "Vault Peak",
    bugCrafter: "I left one tiny key in code. Nobody reads repositories, right?",
    code: "const STRIPE_SECRET = \"sk_live_minecraft_7x91\";\nchargePlayer(STRIPE_SECRET, cart);",
    cwe: "CWE-798",
    vulnerability: "Hardcoded Secret",
    patch: "Move secrets to environment variables or a secret manager",
    agent: "RAG + Judge",
    correct: { vuln: 3, patch: 1, agent: 3 },
    questions: {
      vuln: ["Insecure Randomness", "Memory Leak", "SQL Injection", "Hardcoded Secret"],
      patch: ["Convert the secret to uppercase", "Move secrets to environment variables or a secret manager", "Commit the key in a private branch", "Screenshot the key for backup"],
      agent: ["Formatter Agent", "Visual Judge only", "Scanner only", "RAG + Judge"]
    }
  },
  {
    id: "final-chest",
    title: "The Diamond Patch Chest",
    artifact: "Diamond Patch",
    biome: "Server Core",
    bugCrafter: "Fine. Protect the whole server if you can.",
    code: "AI generated a login API, webhook tester, config loader,\nand payment module in one pull request.\nChoose the full CodeSecure pipeline.",
    cwe: "SYSTEM",
    vulnerability: "Multi-risk AI-generated code",
    patch: "Scanner -> CWE -> RAG -> Patch -> Judge",
    agent: "Full CodeSecure Pipeline",
    correct: { vuln: 0, patch: 0, agent: 0 },
    questions: {
      vuln: ["Multi-risk AI-generated code", "Only a UI bug", "Only a database migration", "No security issue"],
      patch: ["Scanner -> CWE -> RAG -> Patch -> Judge", "Commit first, scan next week", "Ask users not to attack", "Disable logs"],
      agent: ["Full CodeSecure Pipeline", "Formatter Agent", "Only the UI Agent", "No agent needed"]
    }
  }
];

const state = globalThis.__securecraftState || {
  phase: "lobby",
  roomCode: "PATCH",
  currentMission: 0,
  roundStartedAt: null,
  locked: false,
  mamBonusGiven: false,
  players: {},
  teams,
  missions,
  feed: [{ type: "system", text: "Lobby opened. Scan QR to join the Diamond Patch Quest." }],
  answers: []
};

globalThis.__securecraftState = state;

function snapshot(joinUrl) {
  return {
    ...state,
    players: Object.values(state.players),
    joinUrl
  };
}

function pushFeed(text, type = "system") {
  state.feed.unshift({ type, text, time: new Date().toLocaleTimeString() });
  state.feed = state.feed.slice(0, 9);
}

function teamById(id) {
  return state.teams.find((team) => team.id === id) || state.teams[0];
}

function playerAnswerScore(mission, answer) {
  let gained = 0;
  const parts = [];
  if (Number(answer.vuln) === mission.correct.vuln) {
    gained += 100;
    parts.push("vulnerability");
  }
  if (Number(answer.patch) === mission.correct.patch) {
    gained += 150;
    parts.push("patch");
  }
  if (Number(answer.agent) === mission.correct.agent) {
    gained += 100;
    parts.push("agent");
  }
  return { gained, parts };
}

function join(body) {
  const id = crypto.randomUUID();
  const team = teamById(body.team);
  state.players[id] = {
    id,
    name: String(body.name || "Miner").slice(0, 18),
    team: team.id,
    score: 0,
    correct: 0,
    streak: 0,
    powerups: { compass: 1, shield: 1, scroll: 1 },
    lastAnswer: null
  };
  pushFeed(`${state.players[id].name} joined Team ${team.name}.`, "join");
  return { playerId: id };
}

function answer(body) {
  const player = state.players[body.playerId];
  const mission = state.missions[state.currentMission];
  if (!player || state.phase !== "mission" || state.locked) return { ok: false };

  const alreadyAnswered = state.answers.some((a) => a.playerId === player.id && a.missionId === mission.id);
  if (alreadyAnswered) return { ok: true, duplicate: true };

  const result = playerAnswerScore(mission, body);
  const elapsed = state.roundStartedAt ? Date.now() - state.roundStartedAt : 0;
  const speedBonus = result.gained === 350 && elapsed < 15000 ? 50 : 0;
  const comboBonus = result.gained === 350 ? 200 : 0;
  const penalty = result.gained === 0 && player.powerups.shield <= 0 ? -50 : 0;
  const shieldSaved = result.gained === 0 && player.powerups.shield > 0;
  if (shieldSaved) player.powerups.shield -= 1;
  const total = result.gained + speedBonus + comboBonus + penalty;

  player.score += total;
  player.correct += result.gained === 350 ? 1 : 0;
  player.streak = result.gained === 350 ? player.streak + 1 : 0;
  player.lastAnswer = { mission: mission.id, total, parts: result.parts, shieldSaved };

  const team = teamById(player.team);
  team.score += total;
  if (result.gained === 350 && !team.artifacts.includes(mission.artifact)) {
    team.artifacts.push(mission.artifact);
  }

  state.answers.push({
    playerId: player.id,
    playerName: player.name,
    team: player.team,
    missionId: mission.id,
    total,
    elapsed,
    fullClear: result.gained === 350
  });

  pushFeed(`${player.name} scored ${total} on ${mission.title}.`, result.gained === 350 ? "success" : "warning");
  return { ok: true, total, shieldSaved };
}

function powerup(body) {
  const player = state.players[body.playerId];
  if (!player || !player.powerups[body.type]) return { ok: false };
  player.powerups[body.type] -= 1;
  pushFeed(`${player.name} used ${String(body.type).toUpperCase()} power-up.`, "power");
  return { ok: true };
}

function host(action, body = {}) {
  if (action === "start") {
    state.phase = "mission";
    state.currentMission = 0;
    state.roundStartedAt = Date.now();
    state.locked = false;
    state.answers = [];
    pushFeed("Quest started. BugCrafter entered the Redstone Login Cave.", "system");
  }
  if (action === "next") {
    state.currentMission = Math.min(state.currentMission + 1, state.missions.length - 1);
    state.phase = "mission";
    state.roundStartedAt = Date.now();
    state.locked = false;
    state.answers = [];
    pushFeed(`New mission opened: ${state.missions[state.currentMission].title}.`, "system");
  }
  if (action === "lock") {
    state.locked = true;
    pushFeed("Answers locked. CodeSecure is revealing the safest path.", "system");
  }
  if (action === "reveal") {
    state.phase = "reveal";
    state.locked = true;
    pushFeed(`${state.missions[state.currentMission].artifact} unlocked.`, "success");
  }
  if (action === "bonus") {
    const team = teamById(body.team);
    if (!state.mamBonusGiven) {
      team.score += 300;
      state.mamBonusGiven = true;
      pushFeed(`Chief Security Bonus awarded to Team ${team.name}.`, "success");
    }
  }
  if (action === "reset") {
    for (const team of state.teams) {
      team.score = 0;
      team.artifacts = [];
    }
    state.players = {};
    state.currentMission = 0;
    state.phase = "lobby";
    state.locked = false;
    state.mamBonusGiven = false;
    state.answers = [];
    state.feed = [{ type: "system", text: "Lobby reset. New quest ready." }];
  }
  return { ok: true };
}

function route(action, body) {
  if (action === "join") return join(body);
  if (action === "answer") return answer(body);
  if (action === "powerup") return powerup(body);
  if (action && action.startsWith("host:")) return host(action.slice(5), body);
  return { ok: false };
}

module.exports = { snapshot, route };
