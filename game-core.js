const MAX_PLAYERS = 20;
const GAME_MS = 7 * 60 * 1000;
const MEETING_MS = 38 * 1000;
const SABOTAGE_MS = 32 * 1000;
const TASKS_PER_CREW = 4;

const ZONES = [
  {
    id: 'atrium',
    name: 'Command Atrium',
    short: 'ATRIUM',
    x: 50,
    y: 71,
    description: 'Operations command and emergency review point.',
  },
  {
    id: 'gateway',
    name: 'API Gateway',
    short: 'GATEWAY',
    x: 26,
    y: 47,
    description: 'Traffic inspection and public endpoint routing.',
  },
  {
    id: 'pipeline',
    name: 'Build Pipeline',
    short: 'PIPELINE',
    x: 48,
    y: 31,
    description: 'Continuous integration and artifact signing.',
  },
  {
    id: 'lab',
    name: 'Dependency Lab',
    short: 'LAB',
    x: 73,
    y: 44,
    description: 'Third-party package and SBOM validation.',
  },
  {
    id: 'vault',
    name: 'Deployment Vault',
    short: 'VAULT',
    x: 78,
    y: 73,
    description: 'Production release keys and protected workloads.',
  },
];

const TASK_LIBRARY = [
  { id: 'route', zone: 'gateway', title: 'Route encrypted traffic', type: 'signal' },
  { id: 'sign', zone: 'pipeline', title: 'Sign build artifact', type: 'signal' },
  { id: 'audit', zone: 'lab', title: 'Verify dependency chain', type: 'signal' },
  { id: 'seal', zone: 'vault', title: 'Seal release channel', type: 'signal' },
  { id: 'trace', zone: 'atrium', title: 'Trace security telemetry', type: 'signal' },
];

const SABOTAGES = [
  {
    id: 'traffic-flood',
    zone: 'gateway',
    title: 'Traffic Flood',
    cwe: 'CWE-918',
    agent: 'Gemini triage found an unsafe outbound request chain.',
  },
  {
    id: 'build-tamper',
    zone: 'pipeline',
    title: 'Build Tamper',
    cwe: 'CWE-494',
    agent: 'Qwen AST analysis found an unsigned artifact path.',
  },
  {
    id: 'package-rot',
    zone: 'lab',
    title: 'Package Rot',
    cwe: 'CWE-829',
    agent: 'MiniCPM verifier found a suspicious dependency provenance signal.',
  },
  {
    id: 'key-exposure',
    zone: 'vault',
    title: 'Key Exposure',
    cwe: 'CWE-798',
    agent: 'Nemotron Nano sandbox detected a secret reaching a release boundary.',
  },
];

const COLORS = ['#00d7ff', '#f8bd24', '#ff5875', '#36e49d', '#aa82ff', '#ff9054', '#86ddff', '#e7f6ff'];

function now() {
  return Date.now();
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function clampName(value) {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9 _.-]/g, '').trim();
  return cleaned.slice(0, 16) || 'Unknown';
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function addFeed(state, type, message) {
  state.feed.unshift({ id: uid('evt'), type, message, at: now() });
  state.feed = state.feed.slice(0, 20);
}

function zoneById(id) {
  return ZONES.find((zone) => zone.id === id);
}

function sabotageById(id) {
  return SABOTAGES.find((item) => item.id === id);
}

function crewCount(state, aliveOnly = false) {
  return Object.values(state.players).filter((player) => player.role === 'crew' && (!aliveOnly || player.alive)).length;
}

function impostorCount(state, aliveOnly = false) {
  return Object.values(state.players).filter((player) => player.role === 'impostor' && (!aliveOnly || player.alive)).length;
}

function taskGoal(state) {
  return Math.max(8, crewCount(state) * TASKS_PER_CREW);
}

function resetPlayerForRound(player) {
  Object.assign(player, {
    role: 'crew',
    alive: true,
    zone: 'atrium',
    taskCount: 0,
    score: 0,
    sabotages: 0,
    compromises: 0,
    lastMoveAt: 0,
    lastTaskAt: 0,
    lastSabotageAt: 0,
    lastCompromiseAt: 0,
    taskQueue: shuffle(TASK_LIBRARY).slice(0, TASKS_PER_CREW).map((task) => task.id),
    vote: null,
  });
}

function createState(room) {
  return {
    room,
    phase: 'lobby',
    createdAt: now(),
    startedAt: null,
    endsAt: null,
    players: {},
    feed: [],
    securityProgress: 0,
    sabotageFailures: 0,
    sabotage: null,
    meeting: null,
    bodies: [],
    winner: null,
    agentReport: null,
    lastMeetingResult: null,
  };
}

function stateError(message) {
  const error = new Error(message);
  error.publicMessage = message;
  return error;
}

function currentTask(player) {
  return TASK_LIBRARY.find((task) => task.id === player.taskQueue[player.taskCount]);
}

function playerSafe(state, playerId) {
  const player = state.players[playerId];
  if (!player) throw stateError('Your connection expired. Join the room again.');
  return player;
}

function playerCanAct(state, player) {
  if (state.phase !== 'playing') throw stateError('The round is not active.');
  if (!player.alive) throw stateError('You are observing this round.');
  if (state.meeting) throw stateError('Emergency review is in progress.');
}

function resolveWin(state, winner, reason) {
  if (state.phase === 'ended') return;
  state.phase = 'ended';
  state.winner = { side: winner, reason, at: now() };
  state.sabotage = null;
  state.meeting = null;
  const label = winner === 'crew' ? 'CODESECURE CONTAINED THE BREACH' : 'IMPOSTORS BREACHED PRODUCTION';
  addFeed(state, winner === 'crew' ? 'secure' : 'critical', label);
}

function checkWin(state) {
  if (state.phase !== 'playing') return;
  const aliveCrew = crewCount(state, true);
  const aliveImpostors = impostorCount(state, true);
  if (state.securityProgress >= taskGoal(state)) {
    resolveWin(state, 'crew', 'All critical security tasks were completed.');
  } else if (aliveImpostors === 0) {
    resolveWin(state, 'crew', 'Every impostor was quarantined.');
  } else if (aliveImpostors >= aliveCrew) {
    resolveWin(state, 'impostor', 'Impostors reached operational control.');
  } else if (state.sabotageFailures >= 3) {
    resolveWin(state, 'impostor', 'Three critical systems reached failure state.');
  }
}

function forensicReport(state, cause, zone) {
  const location = zoneById(zone)?.name || 'Unknown sector';
  const report = cause?.agent || 'Nemotron orchestration found an abnormal code execution path.';
  state.agentReport = {
    id: uid('scan'),
    title: 'CodeSecure forensic scan',
    detail: `${report} Signal source: ${location}.`,
    cwe: cause?.cwe || 'CWE investigation',
    at: now(),
  };
}

function resolveMeeting(state) {
  if (!state.meeting) return;
  const meeting = state.meeting;
  const tally = {};
  Object.values(meeting.votes).forEach((target) => {
    if (!target || target === 'skip') return;
    tally[target] = (tally[target] || 0) + 1;
  });
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let ejected = null;
  if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
    ejected = state.players[ranked[0][0]];
  }

  if (ejected && ejected.alive) {
    ejected.alive = false;
    state.bodies = state.bodies.filter((body) => body.playerId !== ejected.id);
    const verdict = ejected.role === 'impostor' ? 'IMPOSTOR QUARANTINED' : 'FALSE POSITIVE - CREW QUARANTINED';
    addFeed(state, ejected.role === 'impostor' ? 'secure' : 'warning', `${ejected.name}: ${verdict}`);
    state.lastMeetingResult = { id: uid('result'), target: ejected.id, name: ejected.name, role: ejected.role, at: now() };
  } else {
    addFeed(state, 'warning', 'Emergency review ended with no quarantine.');
    state.lastMeetingResult = { id: uid('result'), target: null, name: 'No consensus', role: null, at: now() };
  }
  Object.values(state.players).forEach((player) => {
    player.vote = null;
  });
  state.meeting = null;
  checkWin(state);
}

function advanceState(state) {
  const timestamp = now();
  if (state.phase !== 'playing') return state;
  if (state.meeting && timestamp >= state.meeting.endsAt) resolveMeeting(state);
  if (state.sabotage && timestamp >= state.sabotage.endsAt) {
    const sabotage = state.sabotage;
    state.sabotageFailures += 1;
    addFeed(state, 'critical', `${sabotage.title.toUpperCase()} breached ${zoneById(sabotage.zone).name.toUpperCase()}`);
    forensicReport(state, sabotage, sabotage.zone);
    state.sabotage = null;
    checkWin(state);
  }
  if (state.phase === 'playing' && state.endsAt && timestamp >= state.endsAt) {
    resolveWin(state, 'crew', 'The deployment window closed under CodeSecure protection.');
  }
  return state;
}

function startGame(state) {
  if (state.phase === 'playing') throw stateError('A round is already in progress.');
  const players = Object.values(state.players);
  if (players.length < 4) throw stateError('At least 4 players are needed to start.');
  players.forEach(resetPlayerForRound);
  const impostorTotal = players.length <= 7 ? 1 : players.length <= 14 ? 2 : 3;
  shuffle(players).slice(0, impostorTotal).forEach((player) => {
    player.role = 'impostor';
  });
  state.phase = 'playing';
  state.startedAt = now();
  state.endsAt = state.startedAt + GAME_MS;
  state.securityProgress = 0;
  state.sabotageFailures = 0;
  state.sabotage = null;
  state.meeting = null;
  state.bodies = [];
  state.winner = null;
  state.agentReport = null;
  state.lastMeetingResult = null;
  addFeed(state, 'system', 'Deployment facility online. Identity protocols are active.');
}

function joinGame(state, name) {
  if (state.phase !== 'lobby') throw stateError('This room has already started.');
  if (Object.keys(state.players).length >= MAX_PLAYERS) throw stateError('The facility is full.');
  const cleaned = clampName(name);
  const id = uid('player');
  const color = COLORS[Object.keys(state.players).length % COLORS.length];
  state.players[id] = {
    id,
    name: cleaned,
    color,
    joinedAt: now(),
    role: 'pending',
    alive: true,
    zone: 'atrium',
    taskCount: 0,
    score: 0,
    sabotages: 0,
    compromises: 0,
    lastMoveAt: 0,
    lastTaskAt: 0,
    lastSabotageAt: 0,
    lastCompromiseAt: 0,
    taskQueue: [],
    vote: null,
  };
  addFeed(state, 'join', `${cleaned} connected to the facility.`);
  return id;
}

function movePlayer(state, player, zoneId) {
  playerCanAct(state, player);
  const zone = zoneById(zoneId);
  if (!zone) throw stateError('That sector is unavailable.');
  if (now() - player.lastMoveAt < 700) throw stateError('Move systems are recalibrating.');
  player.zone = zone.id;
  player.lastMoveAt = now();
}

function completeTask(state, player) {
  playerCanAct(state, player);
  if (player.role !== 'crew') throw stateError('Your task interface is unavailable.');
  const task = currentTask(player);
  if (!task) throw stateError('All assigned tasks are complete.');
  if (task.zone !== player.zone) throw stateError(`Travel to ${zoneById(task.zone).name} first.`);
  if (now() - player.lastTaskAt < 1300) throw stateError('Task terminal is cooling down.');
  player.lastTaskAt = now();
  player.taskCount += 1;
  player.score += 120;
  state.securityProgress += 1;
  addFeed(state, 'task', `${player.name} secured ${zoneById(task.zone).short} telemetry.`);
  checkWin(state);
}

function beginSabotage(state, player, sabotageId) {
  playerCanAct(state, player);
  if (player.role !== 'impostor') throw stateError('Sabotage controls rejected.');
  if (state.sabotage) throw stateError('A critical incident is already active.');
  const sabotage = sabotageById(sabotageId);
  if (!sabotage) throw stateError('Sabotage module unavailable.');
  if (now() - player.lastSabotageAt < 21000) throw stateError('Sabotage uplink needs time to recharge.');
  player.lastSabotageAt = now();
  player.sabotages += 1;
  state.sabotage = { ...sabotage, startedAt: now(), endsAt: now() + SABOTAGE_MS, by: player.id };
  addFeed(state, 'critical', `CRITICAL: ${sabotage.title.toUpperCase()} detected in ${zoneById(sabotage.zone).short}`);
  forensicReport(state, sabotage, sabotage.zone);
}

function stabilizeSabotage(state, player) {
  playerCanAct(state, player);
  if (player.role !== 'crew') throw stateError('Only crew can stabilize the pipeline.');
  if (!state.sabotage) throw stateError('No active incident to stabilize.');
  if (player.zone !== state.sabotage.zone) throw stateError(`Travel to ${zoneById(state.sabotage.zone).name}.`);
  const title = state.sabotage.title;
  state.sabotage = null;
  player.score += 180;
  state.securityProgress += 1;
  addFeed(state, 'secure', `${player.name} stabilized ${title.toUpperCase()}.`);
  checkWin(state);
}

function compromisePlayer(state, player, targetId) {
  playerCanAct(state, player);
  if (player.role !== 'impostor') throw stateError('Compromise controls rejected.');
  if (now() - player.lastCompromiseAt < 18000) throw stateError('Your exploit channel is still cooling down.');
  const target = playerSafe(state, targetId);
  if (!target.alive || target.role !== 'crew') throw stateError('That agent cannot be compromised.');
  if (target.zone !== player.zone) throw stateError('Move to the same sector as your target.');
  player.lastCompromiseAt = now();
  player.compromises += 1;
  target.alive = false;
  state.bodies.push({ playerId: target.id, zone: target.zone, at: now(), by: player.id });
  addFeed(state, 'warning', `Telemetry lost from an agent in ${zoneById(target.zone).short}.`);
  forensicReport(state, { cwe: 'CWE-287', agent: 'Nemotron orchestration found a broken identity trail.' }, target.zone);
  checkWin(state);
}

function reportBody(state, player) {
  playerCanAct(state, player);
  const body = state.bodies.find((item) => item.zone === player.zone);
  if (!body) throw stateError('No compromised agent is in this sector.');
  state.bodies = state.bodies.filter((item) => item !== body);
  state.meeting = {
    id: uid('meeting'),
    zone: body.zone,
    reportedBy: player.id,
    startedAt: now(),
    endsAt: now() + MEETING_MS,
    votes: {},
  };
  const currentSabo = state.sabotage;
  forensicReport(state, currentSabo || { cwe: 'CWE-287', agent: 'CodeSecure found a forged identity chain.' }, body.zone);
  addFeed(state, 'meeting', `EMERGENCY REVIEW called by ${player.name}.`);
}

function votePlayer(state, player, targetId) {
  if (state.phase !== 'playing') throw stateError('There is no active round.');
  if (!state.meeting) throw stateError('No emergency review is active.');
  if (!player.alive) throw stateError('Quarantined agents cannot vote.');
  if (player.vote) throw stateError('Your vote is already locked.');
  if (targetId !== 'skip') {
    const target = playerSafe(state, targetId);
    if (!target.alive || target.id === player.id) throw stateError('That vote is not valid.');
  }
  player.vote = targetId;
  state.meeting.votes[player.id] = targetId;
}

function playerSnapshot(state, playerId) {
  advanceState(state);
  const player = playerId ? state.players[playerId] : null;
  const revealRoles = state.phase === 'ended';
  const players = Object.values(state.players).map((item) => ({
    id: item.id,
    name: item.name,
    color: item.color,
    alive: item.alive,
    zone: item.zone,
    taskCount: item.taskCount,
    score: item.score,
    role: revealRoles ? item.role : undefined,
  }));
  return {
    room: state.room,
    phase: state.phase,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    playerCount: players.length,
    players,
    zones: ZONES,
    feed: state.feed,
    securityProgress: state.securityProgress,
    securityGoal: taskGoal(state),
    sabotageFailures: state.sabotageFailures,
    sabotage: state.sabotage ? {
      id: state.sabotage.id,
      title: state.sabotage.title,
      zone: state.sabotage.zone,
      endsAt: state.sabotage.endsAt,
      cwe: state.sabotage.cwe,
    } : null,
    meeting: state.meeting ? {
      id: state.meeting.id,
      zone: state.meeting.zone,
      endsAt: state.meeting.endsAt,
      votes: Object.keys(state.meeting.votes).length,
    } : null,
    bodies: state.bodies.map((body) => ({ playerId: body.playerId, zone: body.zone })),
    winner: state.winner,
    agentReport: state.agentReport,
    lastMeetingResult: state.lastMeetingResult,
    self: player ? {
      id: player.id,
      name: player.name,
      role: player.role,
      alive: player.alive,
      zone: player.zone,
      taskCount: player.taskCount,
      taskTotal: player.taskQueue.length,
      currentTask: currentTask(player),
      score: player.score,
      sabotages: player.sabotages,
      compromises: player.compromises,
      hasVoted: Boolean(player.vote),
      canReport: Boolean(state.bodies.find((body) => body.zone === player.zone)),
      cooldowns: {
        sabotage: Math.max(0, 21000 - (now() - player.lastSabotageAt)),
        compromise: Math.max(0, 18000 - (now() - player.lastCompromiseAt)),
      },
    } : null,
  };
}

function hostSnapshot(state) {
  const snapshot = playerSnapshot(state, null);
  snapshot.players = snapshot.players.map((item) => ({ ...item, role: state.phase === 'ended' ? state.players[item.id].role : undefined }));
  return snapshot;
}

function applyAction(state, input) {
  advanceState(state);
  const action = String(input?.action || '');
  if (action === 'join') {
    const playerId = joinGame(state, input.name);
    return { playerId, snapshot: playerSnapshot(state, playerId) };
  }
  if (action === 'host-start') {
    startGame(state);
    return { snapshot: hostSnapshot(state) };
  }
  if (action === 'host-reset') {
    const fresh = createState(state.room);
    return { reset: fresh, snapshot: hostSnapshot(fresh) };
  }
  const player = playerSafe(state, input.playerId);
  if (action === 'move') movePlayer(state, player, input.zone);
  else if (action === 'task') completeTask(state, player);
  else if (action === 'sabotage') beginSabotage(state, player, input.sabotageId);
  else if (action === 'stabilize') stabilizeSabotage(state, player);
  else if (action === 'compromise') compromisePlayer(state, player, input.targetId);
  else if (action === 'report') reportBody(state, player);
  else if (action === 'vote') votePlayer(state, player, input.targetId);
  else throw stateError('Unknown game action.');
  return { snapshot: playerSnapshot(state, player.id) };
}

module.exports = {
  MAX_PLAYERS,
  ZONES,
  createState,
  advanceState,
  applyAction,
  playerSnapshot,
  hostSnapshot,
};
