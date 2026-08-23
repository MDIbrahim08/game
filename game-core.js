const crypto = require("crypto");

const GAME_MS = 8 * 60 * 1000;

const rooms = [
  {
    id: "login-gate",
    title: "Redstone Login Gate",
    artifact: "Scanner Lens",
    brief: "The AI built a login gate. Something lets attackers enter as admin.",
    code: "const q = \"SELECT * FROM users WHERE name='\" + user + \"' AND pass='\" + pass + \"'\";\ndb.query(q);",
    question: "Which fix unlocks this gate?",
    options: [
      "Use parameterized queries for user and password values.",
      "Base64 encode the password before adding it to SQL.",
      "Hide this route behind a loading screen.",
      "Rename the users table."
    ],
    correct: 0,
    cwe: "CWE-89",
    explanation: "CodeSecure detects SQL injection and patches the query with parameters."
  },
  {
    id: "potion-lab",
    title: "Potion Config Lab",
    artifact: "CWE Compass",
    brief: "A potion config upload can execute dangerous objects.",
    code: "import yaml\nrecipe = yaml.load(uploaded_file)\ncraft(recipe)",
    question: "Which patch keeps the potion lab safe?",
    options: [
      "Only accept files with short names.",
      "Use yaml.safe_load and validate the schema.",
      "Compress uploaded files first.",
      "Ask users not to upload dangerous configs."
    ],
    correct: 1,
    cwe: "CWE-502",
    explanation: "CodeSecure maps unsafe deserialization to CWE-502 and recommends safe parsing."
  },
  {
    id: "nether-relay",
    title: "Nether Webhook Relay",
    artifact: "RAG Scroll",
    brief: "A webhook tester opens a portal to any URL the user enters.",
    code: "const response = await fetch(req.body.url);\nres.send(await response.text());",
    question: "What closes the dangerous portal?",
    options: [
      "Retry failed requests automatically.",
      "Allow only HTTPS URLs and ignore redirects.",
      "Allowlist domains and block private/internal IP ranges.",
      "Make the response text smaller."
    ],
    correct: 2,
    cwe: "CWE-918",
    explanation: "CodeSecure recognizes SSRF and retrieves rules for URL validation and internal-IP blocking."
  },
  {
    id: "diamond-vault",
    title: "Diamond Secret Vault",
    artifact: "Patch Hammer",
    brief: "The AI left a production key inside the source code.",
    code: "const STRIPE_SECRET = \"sk_live_minecraft_7x91\";\ncharge(STRIPE_SECRET, amount);",
    question: "Which action protects the vault?",
    options: [
      "Move the secret to environment variables or a secret manager.",
      "Change the variable name to PRIVATE_KEY.",
      "Screenshot the secret and delete this line later.",
      "Convert the key to uppercase."
    ],
    correct: 0,
    cwe: "CWE-798",
    explanation: "CodeSecure flags hardcoded credentials and patches the flow to use managed secrets."
  },
  {
    id: "server-core",
    title: "Final Server Core",
    artifact: "Diamond Patch",
    brief: "You reached the final room. Choose the full CodeSecure pipeline.",
    code: "AI-generated PR includes login, config upload, webhook tester, and payment module.",
    question: "Which pipeline safely ships this AI-generated code?",
    options: [
      "Commit first, then scan if users complain.",
      "Formatter -> prettier -> deploy.",
      "Scanner -> CWE classifier -> RAG evidence -> Patch generator -> Judge verifier.",
      "Only ask the AI to try harder."
    ],
    correct: 2,
    cwe: "SYSTEM",
    explanation: "This is the product story: CodeSecure detects, explains, patches, and verifies before release."
  }
];

const state = globalThis.__escapeRoomState || {
  phase: "lobby",
  startedAt: null,
  players: {},
  feed: [{ type: "system", text: "Escape room lobby opened. Scan QR to join solo." }]
};

globalThis.__escapeRoomState = state;

function pushFeed(text, type = "system") {
  state.feed.unshift({ text, type, time: new Date().toLocaleTimeString() });
  state.feed = state.feed.slice(0, 10);
}

function playerList() {
  return Object.values(state.players);
}

function elapsed() {
  return state.startedAt ? Date.now() - state.startedAt : 0;
}

function advance() {
  if (state.phase === "running" && elapsed() >= GAME_MS) {
    state.phase = "ended";
    pushFeed("Time is up. Escape room closed.", "danger");
  }
}

function snapshot(joinUrl) {
  advance();
  const players = playerList().sort((a, b) => {
    if (b.room !== a.room) return b.room - a.room;
    if (b.score !== a.score) return b.score - a.score;
    return (a.finishedAt || Infinity) - (b.finishedAt || Infinity);
  });

  return {
    phase: state.phase,
    startedAt: state.startedAt,
    durationMs: GAME_MS,
    elapsedMs: elapsed(),
    rooms,
    players,
    feed: state.feed,
    escaped: players.filter((p) => p.escaped).length,
    joinUrl
  };
}

function join(body) {
  const id = crypto.randomUUID();
  state.players[id] = {
    id,
    name: String(body.name || "Student").slice(0, 18),
    room: 0,
    score: 0,
    mistakes: 0,
    artifacts: [],
    escaped: false,
    finishedAt: null,
    lastResult: null
  };
  pushFeed(`${state.players[id].name} entered the dungeon.`, "join");
  return { ok: true, playerId: id };
}

function answer(body) {
  advance();
  const player = state.players[body.playerId];
  if (!player || state.phase !== "running" || player.escaped) return { ok: false };

  const room = rooms[player.room];
  const choice = Number(body.choice);
  const correct = choice === room.correct;

  if (correct) {
    const speedBonus = Math.max(0, 80 - player.mistakes * 15);
    const points = 220 + speedBonus;
    player.score += points;
    player.artifacts.push(room.artifact);
    player.lastResult = { correct: true, text: room.explanation, points };
    pushFeed(`${player.name} unlocked ${room.title}.`, "success");

    if (player.room === rooms.length - 1) {
      player.escaped = true;
      player.finishedAt = elapsed();
      player.score += 500;
      pushFeed(`${player.name} escaped with the Diamond Patch.`, "success");
    } else {
      player.room += 1;
    }
  } else {
    player.mistakes += 1;
    player.score = Math.max(0, player.score - 60);
    player.lastResult = { correct: false, text: "Trap triggered. Try another patch.", points: -60 };
    pushFeed(`${player.name} triggered a trap in ${room.title}.`, "danger");
  }

  return { ok: true, correct, player };
}

function host(action) {
  if (action === "start") {
    state.phase = "running";
    state.startedAt = Date.now();
    for (const player of playerList()) {
      player.room = 0;
      player.score = 0;
      player.mistakes = 0;
      player.artifacts = [];
      player.escaped = false;
      player.finishedAt = null;
      player.lastResult = null;
    }
    state.feed = [{ type: "system", text: "Escape room started. First to recover the Diamond Patch wins." }];
    return { ok: true };
  }

  if (action === "reset") {
    state.phase = "lobby";
    state.startedAt = null;
    state.players = {};
    state.feed = [{ type: "system", text: "Lobby reset. Scan QR to join solo." }];
    return { ok: true };
  }

  return { ok: false };
}

function route(action, body = {}) {
  if (action === "join") return join(body);
  if (action === "answer") return answer(body);
  if (action && action.startsWith("host:")) return host(action.slice(5));
  return { ok: false };
}

module.exports = { snapshot, route };
