import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const STATE_FILE = process.env.STATE_FILE || path.join(rootDir, 'tournament_state.json');
const ARCHIVE_FILE = process.env.ARCHIVE_FILE || path.join(rootDir, 'tournament_archive.json');
const PORT = Number(process.env.PORT || 5000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'julie';

// Version tag to safeguard official question bank across restarts
const CURRENT_BANK_VERSION = 'v2_official_30_fixed';

// Official Question Bank (30 questions from master question paper)
const defaultQuestions = [
  { id: 1, question: 'Two fair dice are rolled. What is the probability that their sum is 7?', options: ['1/12', '1/9', '5/36', '⅙'], answer: '⅙', category: 'Aptitude / Probability', difficulty: 'easy', explanation: 'There are 6 combinations summing to 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1) out of 36 total outcomes. Probability = 6/36 = 1/6 (⅙).' },
  { id: 2, question: 'Which component is known as the "Brain of the Computer"?', options: ['RAM', 'CPU', 'Hard Disk', 'Motherboard'], answer: 'CPU', category: 'Computer Architecture', difficulty: 'easy', explanation: 'The Central Processing Unit (CPU) executes program instructions and coordinates computer operations.' },
  { id: 3, question: 'What is the output of the following C code?\n\nint x = 5;\nprintf("%d", x > 3 ? 1 : 2);', options: ['1', '2', '5', '3'], answer: '1', category: 'C Programming', difficulty: 'easy', explanation: 'Since x is 5 and (5 > 3) is true (1), the ternary operator returns 1.' },
  { id: 4, question: 'If you receive a suspicious email asking for your password, what should you do?', options: ['Reply with password', 'Click the link', 'Ignore and report it', 'Forward to friends'], answer: 'Ignore and report it', category: 'Cybersecurity', difficulty: 'easy', explanation: 'Suspicious requests for credentials are phishing attempts; ignore and report them immediately.' },
  { id: 5, question: 'Which of the following is NOT true about AI hallucinations?', options: ['They are always real', 'They can sound confident', 'They can be incorrect', 'They happen in LLMs'], answer: 'They are always real', category: 'Artificial Intelligence', difficulty: 'easy', explanation: 'AI hallucinations produce confident but factually incorrect or fabricated claims; they are not real.' },
  { id: 6, question: 'Which SQL function returns the total number of rows in a table?', options: ['TOTAL()', 'COUNT(*)', 'SUM()', 'ROWS()'], answer: 'COUNT(*)', category: 'DBMS / SQL', difficulty: 'easy', explanation: 'COUNT(*) calculates the total number of rows in a table, including rows containing NULLs.' },
  { id: 7, question: 'What is the SI unit of Electric Current?', options: ['Volt', 'Watt', 'Ampere', 'Ohm'], answer: 'Ampere', category: 'Physics / Electronics', difficulty: 'easy', explanation: 'The SI base unit of electric current is the Ampere (A).' },
  { id: 8, question: 'What mechanism enables Transformer models (like ChatGPT) to understand relationships between words in a sentence?', options: ['Convolution', 'Self-attention', 'Gradient descent', 'Backpropagation'], answer: 'Self-attention', category: 'Artificial Intelligence', difficulty: 'medium', explanation: 'Self-attention calculates mutual influence weights across all words in a sequence simultaneously.' },
  { id: 9, question: 'Find the next number in the series: 3, 5, 7, 9, ___', options: ['10', '11', '12', '13'], answer: '11', category: 'Aptitude / Series', difficulty: 'easy', explanation: 'The series increments by 2 with consecutive odd numbers: 3, 5, 7, 9, 11.' },
  { id: 10, question: 'Which software is used to protect a computer from malicious attacks?', options: ['Compiler', 'Antivirus', 'Browser', 'Operating System'], answer: 'Antivirus', category: 'Cybersecurity', difficulty: 'easy', explanation: 'Antivirus software detects, neutralizes, and removes malicious code such as viruses and ransomware.' },
  { id: 11, question: 'Which simple machine is used to lift water from a well?', options: ['Pulley', 'Lever', 'Inclined Plane', 'Wedge'], answer: 'Pulley', category: 'Physics / Mechanics', difficulty: 'easy', explanation: 'A pulley redirects pulling force, facilitating lifting water buckets from a deep well.' },
  { id: 12, question: 'Which component stores data temporarily while running programs?', options: ['Hard Disk', 'ROM', 'RAM', 'SSD'], answer: 'RAM', category: 'Computer Architecture', difficulty: 'easy', explanation: 'RAM (Random Access Memory) provides high-speed volatile storage for currently executing processes.' },
  { id: 13, question: 'Which device connects multiple computer networks and directs traffic?', options: ['Switch', 'Router', 'Hub', 'Modem'], answer: 'Router', category: 'Networking', difficulty: 'easy', explanation: 'A router directs packets at Layer 3 between distinct IP networks and subnets.' },
  { id: 14, question: 'What does IoT stand for?', options: ['Internet of Technology', 'Internal of Things', 'Internet of Things', 'Integrated of Technology'], answer: 'Internet of Things', category: 'IoT', difficulty: 'easy', explanation: 'IoT stands for "Internet of Things" — interconnected physical devices communicating over the internet.' },
  { id: 15, question: 'Which keyword is used to allocate memory dynamically in C++?', options: ['malloc', 'new', 'create', 'alloc'], answer: 'new', category: 'C++ Programming', difficulty: 'easy', explanation: 'In C++, the new operator dynamically allocates memory on the free store (heap) and initializes objects.' },
  { id: 16, question: 'Which SQL command is used to read/retrieve data from a database?', options: ['GET', 'FETCH', 'SELECT', 'RETRIEVE'], answer: 'SELECT', category: 'DBMS / SQL', difficulty: 'easy', explanation: 'The SELECT command queries and retrieves rows from one or more database tables.' },
  { id: 17, question: 'Which field in the IPv4 header prevents packets from circulating indefinitely in a network?', options: ['Checksum', 'TTL', 'TOS', 'MTU'], answer: 'TTL', category: 'Networking', difficulty: 'medium', explanation: 'Time-To-Live (TTL) is decremented at each hop; when it reaches 0, the packet is dropped.' },
  { id: 18, question: 'Which metric balances Precision and Recall in machine learning evaluation?', options: ['Accuracy', 'ROC-AUC', 'F1-score', 'Mean Squared Error'], answer: 'F1-score', category: 'Machine Learning', difficulty: 'medium', explanation: 'The F1-score is the harmonic mean of precision and recall: 2 * (P * R) / (P + R).' },
  { id: 19, question: 'If CLOCK is coded as 5, what is the code for WATCHMAN?', options: ['6', '7', '8', '9'], answer: '8', category: 'Aptitude / Reasoning', difficulty: 'easy', explanation: 'The code corresponds to the number of letters: CLOCK has 5 letters, and WATCHMAN has 8 letters.' },
  { id: 20, question: 'Which sensor is used to measure temperature?', options: ['Ultrasonic sensor', 'Thermometer', 'LDR sensor', 'PIR sensor'], answer: 'Thermometer', category: 'Sensors / Electronics', difficulty: 'easy', explanation: 'A thermometer (or digital thermal sensor) measures temperature.' },
  { id: 21, question: 'In Java, which keyword is used to prevent method overriding?', options: ['static', 'const', 'final', 'abstract'], answer: 'final', category: 'Java', difficulty: 'easy', explanation: 'In Java, declaring a method with final prevents any subclass from overriding it.' },
  { id: 22, question: 'What type of service is Google Drive?', options: ['Cloud storage', 'Operating System', 'Search Engine', 'Antivirus'], answer: 'Cloud storage', category: 'Cloud Computing', difficulty: 'easy', explanation: 'Google Drive is a cloud-based file storage and synchronization service.' },
  { id: 23, question: 'Which algorithm is best suited to find the shortest path in a graph with negative edge weights (and detect negative cycles)?', options: ["Dijkstra's algorithm", "Prim's algorithm", 'Bellman–Ford', "Kruskal's algorithm"], answer: 'Bellman–Ford', category: 'Algorithms', difficulty: 'medium', explanation: 'The Bellman–Ford algorithm computes shortest paths on graphs with negative edge weights and identifies negative cycles.' },
  { id: 24, question: 'What is the result of 1.1 + 2.3 in floating-point arithmetic?', options: ['3.3', '3.5', '3.2', '3.4'], answer: '3.4', category: 'Computer Arithmetic', difficulty: 'easy', explanation: '1.1 + 2.3 evaluates to 3.4 in standard floating-point addition.' },
  { id: 25, question: 'What is the output of the following Python code?\n\nx = [1, 2, 3]\nprint(len(x) * 3 + 1)', options: ['7', '10', '9', '12'], answer: '10', category: 'Python Programming', difficulty: 'easy', explanation: 'len(x) is 3; multiplication takes precedence over addition: 3 * 3 + 1 = 9 + 1 = 10.' },
  { id: 26, question: 'Which type of energy is generated using sunlight?', options: ['Wind energy', 'Thermal energy', 'Solar energy', 'Hydro energy'], answer: 'Solar energy', category: 'General Science', difficulty: 'easy', explanation: 'Solar energy is harnessed directly from sunlight using solar panels.' },
  { id: 27, question: 'Which technology is used for short-range contactless data transfer (like mobile payments)?', options: ['GPS', 'NFC', '4G', 'Satellite'], answer: 'NFC', category: 'Networking / IoT', difficulty: 'easy', explanation: 'Near Field Communication (NFC) enables short-range contactless communication for payments and credentials.' },
  { id: 28, question: 'In an automated greenhouse, which sensor maintains optimal climate conditions?', options: ['Proximity sensor', 'Gyroscope', 'Temperature sensor', 'Magnetometer'], answer: 'Temperature sensor', category: 'Sensors / Automation', difficulty: 'easy', explanation: 'A temperature sensor monitors climate parameters to trigger heating, ventilation, and cooling.' },
  { id: 29, question: 'What is the value of: 5 + 5 × 5?', options: ['50', '25', '30', '35'], answer: '30', category: 'Aptitude / Math', difficulty: 'easy', explanation: 'Multiplication takes precedence over addition: 5 + (5 × 5) = 5 + 25 = 30.' },
  { id: 30, question: 'What is the main purpose of multi-factor authentication (MFA)?', options: ['Speed up login', 'Add another layer of account security', 'Reset forgotten passwords', 'Remove passwords'], answer: 'Add another layer of account security', category: 'Cybersecurity', difficulty: 'easy', explanation: 'Multi-Factor Authentication (MFA) requires multiple distinct factors, providing extra layers of defense.' }
];

// Server Authoritative Configuration & State
const config = {
  bidChoices: [2, 4, 6, 9, 10, 13, 15],
  passPenalty: 5, // magnitude: deductions are -passPenalty
  pendingPassPenalty: null, // if set, activates on next question start
  biddingTime: 15,
  answerTime: 10,
  rulesLocked: false, // Locked once tournament starts
  requireAdminApproval: false // OPTIONAL FEATURE: Admin approval for player admission (default OFF)
};

const teams = new Map(); // teamId -> team object
const socketTeams = new Map(); // socketId -> teamId

// OPTIONAL FEATURE: Admin Admission Requests Store
// requestId -> { id, name, members, socketId, sessionToken, status: 'pending'|'approved'|'rejected', requestedAt }
const admissionRequests = new Map();

let questions = JSON.parse(JSON.stringify(defaultQuestions));

let state = {
  phase: 'waiting', // 'waiting', 'bidding', 'answering', 'question_result', 'finished'
  isPaused: false,
  pausedPhase: null,
  pausedTimerRemaining: 0,
  pausedTotalTime: 0,
  questionIndex: -1, // 0 to 24 during competition
  
  // Current question dynamic bidding data
  bids: new Map(), // teamId -> { bid: number, timestamp: number }
  passes: new Set(), // teamId -> passed this question
  answerQueue: [], // [ { teamId, bid, timestamp } ] sorted highest first
  activeQueueIndex: 0,
  activeBidder: null, // { teamId, teamName, bid }
  
  // Timer state
  timer: null,
  currentTime: 0,
  totalTime: 0,
  
  // Results of the current question
  currentQuestionResult: null, // { questionId, outcome: 'answered'|'unresolved'|'no_bids', correctTeam, correctAnswer, log: [] }
  roundResults: [], // historic results log

  // Completion sequence timestamp
  finishedAt: null
};

// Persistent record of last concluded tournament
let lastCompletedTournament = null;

function archiveCompletedTournament(finalStandings, finishedAt, roundResults) {
  if (!finalStandings || finalStandings.length === 0) return;
  const record = {
    finishedAt: finishedAt || Date.now(),
    archivedAt: Date.now(),
    winner: finalStandings[0] || null,
    standings: finalStandings,
    roundResults: roundResults || []
  };
  lastCompletedTournament = record;
  try {
    let archiveList = [];
    if (fs.existsSync(ARCHIVE_FILE)) {
      try {
        const raw = fs.readFileSync(ARCHIVE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) archiveList = parsed;
        else if (parsed && typeof parsed === 'object') archiveList = [parsed];
      } catch {
        archiveList = [];
      }
    }
    const exists = archiveList.some(r => r.finishedAt === record.finishedAt);
    if (!exists) {
      archiveList.push(record);
      if (archiveList.length > 20) archiveList = archiveList.slice(-20);
      fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archiveList, null, 2), 'utf-8');
      console.log(`[ARCHIVE] Completed tournament results preserved (${finalStandings.length} teams).`);
    }
  } catch (err) {
    console.error('Failed to write tournament archive:', err.message);
  }
}

// Recovery persistence helper
function persistTournamentState() {
  try {
    const dataToSave = {
      bankVersion: CURRENT_BANK_VERSION,
      config: {
        ...config,
        requireAdminApproval: Boolean(config.requireAdminApproval)
      },
      questions,
      lastCompletedTournament: lastCompletedTournament || null,
      admissionRequests: [...admissionRequests.values()].map(r => ({
        id: r.id,
        name: r.name,
        members: r.members || '',
        sessionToken: r.sessionToken,
        status: r.status,
        requestedAt: r.requestedAt
      })),
      teams: [...teams.values()].map(t => ({
        id: t.id,
        name: t.name,
        members: t.members || '',
        points: t.points,
        violations: t.violations || 0,
        disqualified: Boolean(t.disqualified),
        locked: Boolean(t.locked),
        sessionToken: t.sessionToken
      })),
      state: {
        phase: state.phase,
        isPaused: state.isPaused,
        pausedPhase: state.pausedPhase,
        pausedTimerRemaining: state.pausedTimerRemaining,
        pausedTotalTime: state.pausedTotalTime,
        questionIndex: state.questionIndex,
        currentTime: state.currentTime,
        totalTime: state.totalTime,
        bids: [...state.bids.entries()],
        passes: [...state.passes],
        answerQueue: state.answerQueue,
        activeQueueIndex: state.activeQueueIndex,
        activeBidder: state.activeBidder,
        currentQuestionResult: state.currentQuestionResult,
        roundResults: state.roundResults,
        finishedAt: state.finishedAt
      }
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist tournament state:', err.message);
  }
}

function loadTournamentState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      const saved = JSON.parse(content);
      if (saved.config) {
        Object.assign(config, saved.config);
        config.requireAdminApproval = Boolean(saved.config.requireAdminApproval);
      }
      if (Array.isArray(saved.admissionRequests)) {
        admissionRequests.clear();
        for (const r of saved.admissionRequests) {
          admissionRequests.set(r.id, {
            ...r,
            socketId: null
          });
        }
      }
      if (saved.lastCompletedTournament) {
        lastCompletedTournament = saved.lastCompletedTournament;
      } else if (fs.existsSync(ARCHIVE_FILE)) {
        try {
          const raw = fs.readFileSync(ARCHIVE_FILE, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            lastCompletedTournament = parsed[parsed.length - 1];
          }
        } catch {}
      }
      if (saved.bankVersion === CURRENT_BANK_VERSION && Array.isArray(saved.questions) && saved.questions.length >= 30) {
        questions = saved.questions;
      } else {
        questions = JSON.parse(JSON.stringify(defaultQuestions));
        console.log(`Loaded official default question bank (${questions.length} questions, version: ${CURRENT_BANK_VERSION}).`);
        persistTournamentState();
      }
      if (Array.isArray(saved.teams)) {
        teams.clear();
        for (const t of saved.teams) {
          teams.set(t.id, {
            ...t,
            socketId: null
          });
        }
      }
      if (saved.state) {
        // If a previously saved tournament was finished, preserve final standings in archive
        // and boot fresh into lobby 'waiting' so newly connecting lab computers never receive a pre-completed tournament.
        if (saved.state.phase === 'finished') {
          if (!lastCompletedTournament && Array.isArray(saved.teams) && saved.teams.length > 0) {
            const savedStandings = [...saved.teams]
              .map(tm => ({ id: tm.id, name: tm.name, members: tm.members || '', points: tm.points, violations: tm.violations || 0 }))
              .sort((a, b) => b.points - a.points);
            archiveCompletedTournament(savedStandings, saved.state.finishedAt, saved.state.roundResults);
          }
          state.phase = 'waiting';
          state.finishedAt = null;
          state.questionIndex = -1;
          state.currentQuestionResult = null;
          // Restore teams to lobby 100 pts
          for (const t of teams.values()) {
            t.points = 100;
            t.violations = 0;
            t.disqualified = false;
            t.locked = false;
          }
          console.log('Restored previous finished tournament as clean lobby (waiting) state; completed standings preserved.');
        } else {
          state.phase = saved.state.phase || 'waiting';
          state.isPaused = Boolean(saved.state.isPaused);
          state.pausedPhase = saved.state.pausedPhase || null;
          state.pausedTimerRemaining = saved.state.pausedTimerRemaining || 0;
          state.pausedTotalTime = saved.state.pausedTotalTime || 0;
          state.questionIndex = saved.state.questionIndex ?? -1;
          state.currentTime = saved.state.currentTime || 0;
          state.totalTime = saved.state.totalTime || 0;
          state.bids = new Map(saved.state.bids || []);
          state.passes = new Set(saved.state.passes || []);
          state.answerQueue = saved.state.answerQueue || [];
          state.activeQueueIndex = saved.state.activeQueueIndex || 0;
          state.activeBidder = saved.state.activeBidder || null;
          state.currentQuestionResult = saved.state.currentQuestionResult || null;
          state.roundResults = saved.state.roundResults || [];
          state.finishedAt = saved.state.finishedAt || null;
          console.log(`Restored active tournament state (phase: ${state.phase}, question: ${state.questionIndex + 1}).`);
        }
      }
    } else {
      persistTournamentState();
      console.log(`Initialized fresh tournament state file with ${defaultQuestions.length} official questions.`);
    }
  } catch (err) {
    console.error('Error loading tournament state, using fresh state:', err.message);
  }
}

// App & Socket Setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// Safe public question payload (Does NOT leak correct answer or explanation to players)
const publicQuestion = (q, qIndex) => {
  if (!q) return null;
  return {
    id: q.id,
    questionNumber: (qIndex >= 0 ? qIndex : state.questionIndex) + 1,
    totalQuestions: questions.length,
    question: q.question,
    category: q.category,
    difficulty: q.difficulty,
    bidChoices: config.bidChoices,
    passPenalty: config.passPenalty
  };
};

const payload = t => ({
  id: t.id,
  name: t.name,
  members: t.members || '',
  points: t.points,
  violations: t.violations || 0,
  disqualified: Boolean(t.disqualified),
  locked: Boolean(t.locked),
  sessionToken: t.sessionToken
});

const clearTimer = () => {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
};

const emitTimer = (time, totalTime) => {
  state.currentTime = time;
  state.totalTime = totalTime;
  io.emit('timer', { phase: state.phase, isPaused: state.isPaused, time, totalTime });
  io.to('admins').emit('admin:timer', { phase: state.phase, isPaused: state.isPaused, time, totalTime });
};

// Complete Admin Snapshot
const snapshot = () => {
  const total = questions.length;
  const currentQ = (state.questionIndex >= 0 && state.questionIndex < total)
    ? questions[state.questionIndex]
    : null;

  return {
    phase: state.phase,
    isPaused: state.isPaused,
    rulesLocked: config.rulesLocked,
    config: {
      bidChoices: config.bidChoices,
      passPenalty: config.passPenalty,
      pendingPassPenalty: config.pendingPassPenalty,
      biddingTime: config.biddingTime,
      answerTime: config.answerTime,
      requireAdminApproval: Boolean(config.requireAdminApproval)
    },
    question: currentQ ? {
      ...publicQuestion(currentQ, state.questionIndex),
      options: currentQ.options,
      answer: currentQ.answer,
      explanation: currentQ.explanation
    } : null,
    questionNumber: state.questionIndex + 1,
    totalQuestions: total,
    time: state.currentTime,
    totalTime: state.totalTime,
    teams: [...teams.values()].map(t => ({
      id: t.id,
      name: t.name,
      points: t.points,
      online: Boolean(t.socketId),
      bid: state.bids.has(t.id) ? state.bids.get(t.id).bid : null,
      passed: state.passes.has(t.id),
      violations: t.violations || 0,
      disqualified: Boolean(t.disqualified),
      locked: Boolean(t.locked)
    })).sort((a, b) => b.points - a.points),
    allQuestions: questions.map((q, idx) => ({
      ...q,
      isCurrent: idx === state.questionIndex,
      isCompleted: idx < state.questionIndex,
      isUpcoming: idx > state.questionIndex
    })),
    answerQueue: state.answerQueue.map(qItem => ({
      teamId: qItem.teamId,
      teamName: teams.get(qItem.teamId)?.name || 'Unknown',
      bid: qItem.bid
    })),
    activeBidder: state.activeBidder,
    currentQuestionResult: state.currentQuestionResult,
    results: state.roundResults,
    finishedAt: state.finishedAt,
    winner: state.phase === 'finished' ? ([...teams.values()].map(t => ({ id: t.id, name: t.name, points: t.points })).sort((a, b) => b.points - a.points)[0] || null) : null,
    lastCompletedTournament: lastCompletedTournament || null,
    admissionRequests: [...admissionRequests.values()].map(r => ({
      id: r.id,
      name: r.name,
      members: r.members || '',
      status: r.status,
      requestedAt: r.requestedAt
    })).sort((a, b) => b.requestedAt - a.requestedAt)
  };
};

const emitSnapshot = () => {
  io.to('admins').emit('admin:snapshot', snapshot());
};

// Player personalized view update
function updatePlayerView(teamId) {
  const t = teams.get(teamId);
  if (!t || !t.socketId) return;

  const currentQ = (state.questionIndex >= 0 && state.questionIndex < questions.length)
    ? questions[state.questionIndex]
    : null;

  const userBid = state.bids.get(teamId);
  const userPassed = state.passes.has(teamId);
  const isSelectedActive = state.activeBidder && state.activeBidder.teamId === teamId;

  let topWinner = null;
  let topLeaderboard = null;
  if (state.phase === 'finished') {
    const sortedStandings = [...teams.values()]
      .map(tm => ({ id: tm.id, name: tm.name, points: tm.points }))
      .sort((a, b) => b.points - a.points);
    topWinner = sortedStandings.length > 0 ? sortedStandings[0] : null;
    topLeaderboard = sortedStandings.slice(0, 5);
  }

  io.to(t.socketId).emit('player:sync', {
    team: payload(t),
    phase: state.phase,
    isPaused: state.isPaused,
    question: currentQ ? publicQuestion(currentQ, state.questionIndex) : null,
    time: state.currentTime,
    totalTime: state.totalTime,
    myBid: userBid ? userBid.bid : null,
    myPassed: userPassed,
    isActiveBidder: Boolean(isSelectedActive),
    answerOptions: isSelectedActive && currentQ ? currentQ.options : null,
    result: state.currentQuestionResult,
    config: {
      bidChoices: config.bidChoices,
      passPenalty: config.passPenalty
    },
    finishedAt: state.finishedAt,
    winner: topWinner,
    leaderboard: topLeaderboard
  });
}

function broadcastPlayerViews() {
  for (const t of teams.values()) {
    if (t.socketId) {
      updatePlayerView(t.id);
    }
  }
}

// Global Tournament Progression Logic

// Move to next question automatically (continuous tournament)
function proceedToNextQuestion() {
  if (state.isPaused) return;
  clearTimer();

  const nextIndex = state.questionIndex + 1;
  if (nextIndex >= questions.length) {
    state.phase = 'finished';
    state.finishedAt = state.finishedAt || Date.now();
    state.activeBidder = null;
    state.answerQueue = [];
    state.bids.clear();
    state.passes.clear();
    const sortedStandings = [...teams.values()]
      .map(tm => ({ id: tm.id, name: tm.name, members: tm.members || '', points: tm.points, violations: tm.violations || 0 }))
      .sort((a, b) => b.points - a.points);
    archiveCompletedTournament(sortedStandings, state.finishedAt, state.roundResults);
    persistTournamentState();
    io.emit('event:finished', {
      finishedAt: state.finishedAt,
      winner: sortedStandings[0] || null,
      leaderboard: sortedStandings
    });
    broadcastPlayerViews();
    emitSnapshot();
    return;
  }

  startRound(nextIndex);
}

// Start round for question index — applies pendingPassPenalty atomically
function startRound(index) {
  clearTimer();
  config.rulesLocked = true;

  // Apply any pending PASS penalty change at the boundary between rounds
  if (config.pendingPassPenalty !== null) {
    config.passPenalty = config.pendingPassPenalty;
    config.pendingPassPenalty = null;
  }

  state.questionIndex = index;
  state.phase = 'bidding';
  state.bids.clear();
  state.passes.clear();
  state.answerQueue = [];
  state.activeQueueIndex = 0;
  state.activeBidder = null;
  state.currentQuestionResult = null;

  const q = questions[state.questionIndex];
  let left = config.biddingTime;
  emitTimer(left, config.biddingTime);
  persistTournamentState();
  broadcastPlayerViews();
  emitSnapshot();

  state.timer = setInterval(() => {
    if (state.isPaused) return;
    left--;
    emitTimer(Math.max(left, 0), config.biddingTime);
    if (left <= 0) {
      clearTimer();
      closeBidding();
    }
  }, 1000);
}

// Close bidding and build answer queue
function closeBidding() {
  clearTimer();
  if (state.phase !== 'bidding') return;

  // Rank valid bids (excluding passed, disqualified, or non-eligible teams)
  const validBids = [];
  for (const [teamId, bidObj] of state.bids.entries()) {
    const t = teams.get(teamId);
    if (t && !t.disqualified && !t.locked && !state.passes.has(teamId)) {
      validBids.push({
        teamId,
        bid: bidObj.bid,
        timestamp: bidObj.timestamp
      });
    }
  }

  // Sort bids highest -> lowest; tie goes to earliest valid submission
  validBids.sort((a, b) => {
    if (b.bid !== a.bid) {
      return b.bid - a.bid;
    }
    return a.timestamp - b.timestamp;
  });

  state.answerQueue = validBids;
  state.activeQueueIndex = 0;

  if (state.answerQueue.length === 0) {
    // 7. NO-BID CASE: Nobody submitted a valid bid
    handleNoBidResolution();
    return;
  }

  // Move to Answer Cascade
  advanceAnswerCascade();
}

// Cascade through answerQueue
function advanceAnswerCascade() {
  clearTimer();
  const q = questions[state.questionIndex];

  if (state.activeQueueIndex >= state.answerQueue.length) {
    // If all eligible bidders fail: reveal correct answer and proceed
    const outcome = {
      questionId: q.id,
      questionNumber: state.questionIndex + 1,
      outcome: 'unresolved',
      correctAnswer: q.answer,
      explanation: q.explanation || '',
      summary: 'No team answered correctly. The question was left unresolved.'
    };
    state.currentQuestionResult = outcome;
    state.roundResults.push(outcome);
    state.phase = 'question_result';
    state.activeBidder = null;

    let displayTime = 4;
    emitTimer(displayTime, displayTime);
    persistTournamentState();
    broadcastPlayerViews();
    emitSnapshot();

    state.timer = setInterval(() => {
      if (state.isPaused) return;
      displayTime--;
      emitTimer(Math.max(displayTime, 0), 4);
      if (displayTime <= 0) {
        clearTimer();
        proceedToNextQuestion();
      }
    }, 1000);
    return;
  }

  // Pick current candidate bidder
  const candidate = state.answerQueue[state.activeQueueIndex];
  const t = teams.get(candidate.teamId);

  if (!t || t.disqualified || t.locked) {
    state.activeQueueIndex++;
    advanceAnswerCascade();
    return;
  }

  state.activeBidder = {
    teamId: t.id,
    teamName: t.name,
    bid: candidate.bid
  };
  state.phase = 'answering';

  let left = config.answerTime;
  emitTimer(left, config.answerTime);
  persistTournamentState();
  broadcastPlayerViews();
  emitSnapshot();

  state.timer = setInterval(() => {
    if (state.isPaused) return;
    left--;
    emitTimer(Math.max(left, 0), config.answerTime);
    if (left <= 0) {
      clearTimer();
      handleAnswerTimeout();
    }
  }, 1000);
}

// Answer timeout: deduct bid, advance to next bidder
function handleAnswerTimeout() {
  if (!state.activeBidder) return;
  const currentBidder = state.activeBidder;
  const t = teams.get(currentBidder.teamId);

  if (t) {
    t.points -= currentBidder.bid; // Server authoritative negative scoring allowed
    if (t.socketId) {
      io.to(t.socketId).emit('player:answer_feedback', {
        type: 'timeout',
        bid: currentBidder.bid,
        points: t.points,
        message: `Time's up! -${currentBidder.bid} pts`
      });
    }
  }

  state.activeQueueIndex++;
  advanceAnswerCascade();
}

// No-bid resolution
function handleNoBidResolution() {
  clearTimer();
  const q = questions[state.questionIndex];
  const outcome = {
    questionId: q.id,
    questionNumber: state.questionIndex + 1,
    outcome: 'no_bids',
    correctAnswer: q.answer,
    explanation: q.explanation || '',
    summary: 'No bids were placed for this question.'
  };

  state.currentQuestionResult = outcome;
  state.roundResults.push(outcome);
  state.phase = 'question_result';
  state.activeBidder = null;

  let displayTime = 4;
  emitTimer(displayTime, displayTime);
  persistTournamentState();
  broadcastPlayerViews();
  emitSnapshot();

  state.timer = setInterval(() => {
    if (state.isPaused) return;
    displayTime--;
    emitTimer(Math.max(displayTime, 0), 4);
    if (displayTime <= 0) {
      clearTimer();
      proceedToNextQuestion();
    }
  }, 1000);
}

// Load persisted state on startup
loadTournamentState();

// SOCKET.IO REAL-TIME EVENT HANDLERS
io.on('connection', socket => {

  // Team Registration
  // Team Registration
  socket.on('team:join', rawPayload => {
    let name = '';
    let members = '';

    if (typeof rawPayload === 'object' && rawPayload !== null) {
      name = String(rawPayload.name ?? '').trim();
      members = String(rawPayload.members ?? '').trim();
    } else {
      name = String(rawPayload ?? '').trim();
    }

    if (!name) return socket.emit('team:error', 'Please enter your team name.');
    if (name.length > 30) return socket.emit('team:error', 'Team name must be 30 characters or fewer.');
    if (members.length > 100) return socket.emit('team:error', 'Team members list must be 100 characters or fewer.');

    if (state.phase === 'finished') {
      return socket.emit('team:error', 'The tournament has concluded. Please wait for the admin to reset for the next round.');
    }

    const lower = name.toLowerCase();
    const existing = [...teams.values()].find(t => t.name.toLowerCase() === lower);

    if (existing) {
      const activeOldSocket = existing.socketId ? io.sockets.sockets.get(existing.socketId) : null;
      const isSameToken = Boolean(rawPayload && rawPayload.token && rawPayload.token === existing.sessionToken);

      // Prevent a different device from hijacking an active team without matching sessionToken
      if (activeOldSocket && activeOldSocket.connected && activeOldSocket.id !== socket.id && !isSameToken) {
        return socket.emit('team:error', 'This team is already connected from another device/window.');
      }

      // If there was an old connected socket being replaced, notify and clean it up
      if (activeOldSocket && activeOldSocket.id !== socket.id) {
        socketTeams.delete(activeOldSocket.id);
        activeOldSocket.emit('team:error', 'Your session was resumed in another window/device.');
      }

      // Re-link existing team
      if (members && !existing.members) existing.members = members;
      existing.socketId = socket.id;
      socketTeams.set(socket.id, existing.id);
      socket.emit('team:joined', payload(existing));
      updatePlayerView(existing.id);
      emitSnapshot();
      return;
    }

    // OPTIONAL FEATURE: Admin Admission Approval Workflow
    if (config.requireAdminApproval) {
      const existingReq = [...admissionRequests.values()].find(
        r => r.name.toLowerCase() === lower || (rawPayload?.token && r.sessionToken === rawPayload.token)
      );

      if (existingReq) {
        const isSameToken = Boolean(rawPayload?.token && existingReq.sessionToken === rawPayload.token);

        if (existingReq.status === 'pending') {
          if (!isSameToken && existingReq.socketId && existingReq.socketId !== socket.id) {
            const oldSock = io.sockets.sockets.get(existingReq.socketId);
            if (oldSock && oldSock.connected) {
              return socket.emit('team:error', 'An admission request for this team name is already pending.');
            }
          }
          existingReq.socketId = socket.id;
          if (members && !existingReq.members) existingReq.members = members;
          return socket.emit('team:approval_pending', {
            requestId: existingReq.id,
            sessionToken: existingReq.sessionToken,
            teamName: existingReq.name,
            status: 'pending',
            message: 'ACCESS REQUEST SENT — Waiting for Admin approval.'
          });
        }

        if (existingReq.status === 'rejected') {
          if (isSameToken || existingReq.name.toLowerCase() === lower) {
            return socket.emit('team:rejected', {
              requestId: existingReq.id,
              teamName: existingReq.name,
              message: 'Access request was rejected by admin.'
            });
          }
        }
      }

      // Create new pending admission request
      const reqId = crypto.randomUUID();
      const sessionToken = (rawPayload && rawPayload.token) || crypto.randomUUID();
      const newReq = {
        id: reqId,
        name,
        members,
        socketId: socket.id,
        sessionToken,
        status: 'pending',
        requestedAt: Date.now()
      };
      admissionRequests.set(reqId, newReq);
      persistTournamentState();
      emitSnapshot();

      socket.emit('team:approval_pending', {
        requestId: reqId,
        sessionToken,
        teamName: name,
        status: 'pending',
        message: 'ACCESS REQUEST SENT — Waiting for Admin approval.'
      });
      return;
    }

    const team = {
      id: crypto.randomUUID(),
      name,
      members,
      points: 100, // Server-authoritative starting score = 100
      sessionToken: crypto.randomUUID(),
      socketId: socket.id,
      violations: 0,
      disqualified: false,
      locked: false
    };

    teams.set(team.id, team);
    socketTeams.set(socket.id, team.id);
    persistTournamentState();

    socket.emit('team:joined', payload(team));
    updatePlayerView(team.id);
    emitSnapshot();
  });

  // Reconnect from local sessionToken
  socket.on('team:reconnect', ({ token } = {}) => {
    if (!token) return socket.emit('team:error', 'Session token missing.');
    const t = [...teams.values()].find(x => x.sessionToken === token);
    if (t) {
      // Clean up old socket reference if different
      if (t.socketId && t.socketId !== socket.id) {
        const oldSock = io.sockets.sockets.get(t.socketId);
        if (oldSock) {
          socketTeams.delete(oldSock.id);
        }
      }

      t.socketId = socket.id;
      socketTeams.set(socket.id, t.id);

      socket.emit('team:joined', payload(t));
      updatePlayerView(t.id);
      emitSnapshot();
      return;
    }

    // Check admission requests if approval is active or was used
    const req = [...admissionRequests.values()].find(x => x.sessionToken === token);
    if (req) {
      req.socketId = socket.id;
      if (req.status === 'pending') {
        return socket.emit('team:approval_pending', {
          requestId: req.id,
          sessionToken: req.sessionToken,
          teamName: req.name,
          status: 'pending',
          message: 'ACCESS REQUEST SENT — Waiting for Admin approval.'
        });
      }
      if (req.status === 'rejected') {
        return socket.emit('team:rejected', {
          requestId: req.id,
          teamName: req.name,
          message: 'Access request was rejected by admin.'
        });
      }
    }

    socket.emit('team:session_expired', 'Your session has expired. Please register again.');
  });

  // Team Bid Submission
  socket.on('team:bid', rawBid => {
    const teamId = socketTeams.get(socket.id);
    const t = teams.get(teamId);
    if (!t) return socket.emit('bid:error', 'Join a team first.');
    if (t.disqualified || t.locked) return socket.emit('bid:error', 'Your team is currently locked or disqualified.');
    if (state.isPaused) return socket.emit('bid:error', 'Game is paused.');
    if (state.phase !== 'bidding') return socket.emit('bid:error', 'Bidding is closed.');
    if (state.passes.has(t.id)) return socket.emit('bid:error', 'You have already passed this question.');
    if (state.bids.has(t.id)) return socket.emit('bid:error', 'Your bid is already locked.');

    const bid = Number(rawBid);
    if (!Number.isInteger(bid) || !config.bidChoices.includes(bid)) {
      return socket.emit('bid:error', `Invalid bid choice. Must be one of: ${config.bidChoices.join(', ')}.`);
    }

    // A team cannot bid more points than its current score
    if (bid > t.points) {
      return socket.emit('bid:error', `You cannot bid ${bid} pts because your score is ${t.points} pts.`);
    }

    // Record valid bid
    state.bids.set(t.id, { bid, timestamp: Date.now() });
    persistTournamentState();

    socket.emit('bid:locked', { bid });
    updatePlayerView(t.id);
    emitSnapshot();
  });

  // Team Pass Submission
  socket.on('team:pass', () => {
    const teamId = socketTeams.get(socket.id);
    const t = teams.get(teamId);
    if (!t) return socket.emit('bid:error', 'Join a team first.');
    if (t.disqualified || t.locked) return socket.emit('bid:error', 'Your team is currently locked or disqualified.');
    if (state.isPaused) return socket.emit('bid:error', 'Game is paused.');
    if (state.phase !== 'bidding') return socket.emit('bid:error', 'Bidding is closed.');
    if (state.passes.has(t.id)) return socket.emit('bid:error', 'You already passed this question.');
    if (state.bids.has(t.id)) return socket.emit('bid:error', 'You have already placed a bid.');

    // Deduct pass penalty immediately
    state.passes.add(t.id);
    const penalty = Number(config.passPenalty) || 5;
    t.points -= penalty;
    persistTournamentState();

    socket.emit('pass:confirmed', { penalty, points: t.points });
    updatePlayerView(t.id);
    emitSnapshot();
  });

// Mathematical and text equivalence helper (handles Unicode fraction characters and equivalent fraction strings)
function areAnswersEquivalent(a, b) {
  if (a == null || b == null) return false;
  const strA = String(a).trim();
  const strB = String(b).trim();
  if (strA === strB) return true;
  const norm = s => s.replace(/\u2159/g, '1/6')
                     .replace(/\u00BD/g, '1/2')
                     .replace(/\u2153/g, '1/3')
                     .replace(/\u00BC/g, '1/4')
                     .replace(/\u00BE/g, '3/4')
                     .replace(/\s+/g, '');
  return norm(strA) === norm(strB);
}

  // Team Answer Submission
  socket.on('team:answer', chosenOption => {
    const teamId = socketTeams.get(socket.id);
    const t = teams.get(teamId);
    if (!t) return;
    if (state.isPaused) return;
    if (state.phase !== 'answering') return;
    if (!state.activeBidder || state.activeBidder.teamId !== t.id) {
      return socket.emit('player:error', 'It is not your turn to answer.');
    }

    clearTimer();
    const q = questions[state.questionIndex];
    const bidAmount = state.activeBidder.bid;
    const isCorrect = areAnswersEquivalent(chosenOption, q.answer);

    if (isCorrect) {
      // Correct! +bid, question ends
      t.points += bidAmount;
      const outcome = {
        questionId: q.id,
        questionNumber: state.questionIndex + 1,
        outcome: 'answered',
        winnerTeam: t.name,
        winningBid: bidAmount,
        correctAnswer: q.answer,
        explanation: q.explanation || '',
        summary: `${t.name} answered correctly! (+${bidAmount} pts)`
      };

      state.currentQuestionResult = outcome;
      state.roundResults.push(outcome);
      state.phase = 'question_result';
      state.activeBidder = null;

      socket.emit('player:answer_feedback', {
        type: 'correct',
        bid: bidAmount,
        points: t.points,
        message: `Correct! +${bidAmount} pts`
      });

      let displayTime = 4;
      emitTimer(displayTime, displayTime);
      persistTournamentState();
      broadcastPlayerViews();
      emitSnapshot();

      state.timer = setInterval(() => {
        if (state.isPaused) return;
        displayTime--;
        emitTimer(Math.max(displayTime, 0), 4);
        if (displayTime <= 0) {
          clearTimer();
          proceedToNextQuestion();
        }
      }, 1000);
    } else {
      // Wrong! -bid, advance to next bidder in queue
      t.points -= bidAmount;
      socket.emit('player:answer_feedback', {
        type: 'wrong',
        bid: bidAmount,
        points: t.points,
        message: `Wrong! -${bidAmount} pts`
      });

      state.activeQueueIndex++;
      advanceAnswerCascade();
    }
  });

  // Anti-Cheating & Tab / Window Visibility Violation Tracking (Authoritative Cap: 0-3)
  socket.on('team:violation', data => {
    const teamId = socketTeams.get(socket.id);
    const t = teams.get(teamId);
    if (!t) return;

    // Authoritative violation count strictly capped between 0 and 3
    const current = Math.min(3, Math.max(0, t.violations || 0));
    if (current < 3) {
      t.violations = current + 1;
      persistTournamentState();
    } else {
      t.violations = 3; // Keep team's final-violation state active at 3/3; do not increase to 4 or higher
    }

    const violationPayload = {
      teamId: t.id,
      teamName: t.name,
      violationCount: t.violations,
      isFinal: t.violations >= 3,
      type: data?.type || 'tab_switch',
      timestamp: Date.now()
    };

    io.to('admins').emit('admin:violation_alert', violationPayload);
    socket.emit('player:violation_warning', {
      violationCount: t.violations,
      maxWarnings: 3,
      isFinal: t.violations >= 3
    });
    emitSnapshot();
  });

  // ADMIN AUTHENTICATION
  socket.on('admin:auth', password => {
    if (String(password ?? '') !== ADMIN_PASSWORD) {
      return socket.emit('admin:error', 'Invalid admin password.');
    }
    socket.join('admins');
    socket.emit('admin:authenticated', { ok: true });
    socket.emit('admin:snapshot', snapshot());
  });

  // Helper guard for admin commands
  const requireAdmin = handler => (...args) => {
    if (!socket.rooms.has('admins')) {
      return socket.emit('admin:error', 'Unauthorized. Please sign in with admin password.');
    }
    handler(...args);
  };

  // Start Competition
  socket.on('admin:start', requireAdmin(() => {
    if (state.phase === 'finished') return;
    if (state.phase === 'waiting') {
      startRound(0);
    }
  }));

  // Global Pause
  socket.on('admin:pause', requireAdmin(() => {
    if (state.isPaused || state.phase === 'finished' || state.phase === 'waiting') return;
    clearTimer();
    state.isPaused = true;
    state.pausedPhase = state.phase;
    state.pausedTimerRemaining = state.currentTime;
    state.pausedTotalTime = state.totalTime;
    persistTournamentState();
    broadcastPlayerViews();
    emitSnapshot();
  }));

  // Global Resume
  socket.on('admin:resume', requireAdmin(() => {
    if (!state.isPaused) return;
    state.isPaused = false;
    let remaining = state.pausedTimerRemaining;
    const totalTime = state.pausedTotalTime;
    state.phase = state.pausedPhase;
    persistTournamentState();

    emitTimer(remaining, totalTime);
    broadcastPlayerViews();
    emitSnapshot();

    state.timer = setInterval(() => {
      if (state.isPaused) return;
      remaining--;
      emitTimer(Math.max(remaining, 0), totalTime);
      if (remaining <= 0) {
        clearTimer();
        if (state.phase === 'bidding') {
          closeBidding();
        } else if (state.phase === 'answering') {
          handleAnswerTimeout();
        } else if (state.phase === 'question_result') {
          proceedToNextQuestion();
        }
      }
    }, 1000);
  }));

  // Close Bidding Early
  socket.on('admin:close_bidding_early', requireAdmin(() => {
    if (state.phase === 'bidding') {
      clearTimer();
      closeBidding();
    }
  }));

  // Force Next Question
  socket.on('admin:next_question', requireAdmin(() => {
    clearTimer();
    state.isPaused = false;
    proceedToNextQuestion();
  }));

  // Restart Current Question
  socket.on('admin:restart_current_question', requireAdmin(() => {
    if (state.questionIndex >= 0 && state.questionIndex < questions.length) {
      clearTimer();
      state.isPaused = false;
      startRound(state.questionIndex);
    }
  }));

  // Emergency Stop / End Tournament
  socket.on('admin:end_tournament', requireAdmin(() => {
    clearTimer();
    state.phase = 'finished';
    state.finishedAt = state.finishedAt || Date.now();
    state.isPaused = false;
    state.activeBidder = null;
    state.answerQueue = [];
    const sortedStandings = [...teams.values()]
      .map(tm => ({ id: tm.id, name: tm.name, members: tm.members || '', points: tm.points, violations: tm.violations || 0 }))
      .sort((a, b) => b.points - a.points);
    archiveCompletedTournament(sortedStandings, state.finishedAt, state.roundResults);
    persistTournamentState();
    io.emit('event:finished', {
      finishedAt: state.finishedAt,
      winner: sortedStandings[0] || null,
      leaderboard: sortedStandings
    });
    broadcastPlayerViews();
    emitSnapshot();
  }));

  // Reset Tournament — Full reset clears all player registrations & forces fresh login
  socket.on('admin:reset_tournament', requireAdmin(() => {
    clearTimer();
    if (state.phase === 'finished' || (state.roundResults && state.roundResults.length > 0) || teams.size > 0) {
      const finalStandings = [...teams.values()]
        .map(tm => ({ id: tm.id, name: tm.name, members: tm.members || '', points: tm.points, violations: tm.violations || 0 }))
        .sort((a, b) => b.points - a.points);
      if (finalStandings.length > 0) {
        archiveCompletedTournament(finalStandings, state.finishedAt || Date.now(), state.roundResults);
      }
    }
    config.rulesLocked = false;
    teams.clear();
    socketTeams.clear();
    admissionRequests.clear();
    state.phase = 'waiting';
    state.finishedAt = null;
    state.isPaused = false;
    state.pausedPhase = null;
    state.pausedTimerRemaining = 0;
    state.questionIndex = -1;
    state.bids.clear();
    state.passes.clear();
    state.answerQueue = [];
    state.activeQueueIndex = 0;
    state.activeBidder = null;
    state.currentQuestionResult = null;
    state.roundResults = [];
    state.currentTime = 0;
    state.totalTime = 0;

    persistTournamentState();
    io.emit('event:reset', { message: 'Tournament reset by Admin. Please register your team again.' });
    emitSnapshot();
  }));

  // Rule Configuration Updates (Bid Choices, Timers — pre-tournament only)
  socket.on('admin:update_rules', requireAdmin(rules => {
    if (config.rulesLocked) {
      return socket.emit('admin:error', 'Rules are locked after the competition begins. Use the live PASS penalty control to adjust the penalty mid-tournament.');
    }
    if (Array.isArray(rules.bidChoices) && rules.bidChoices.length > 0) {
      const cleanChoices = rules.bidChoices
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0);
      if (cleanChoices.length > 0) {
        config.bidChoices = [...new Set(cleanChoices)].sort((a, b) => a - b);
      }
    }
    if (Number.isInteger(Number(rules.passPenalty))) {
      config.passPenalty = Math.max(0, Number(rules.passPenalty));
    }
    if (Number(rules.biddingTime) >= 5) {
      config.biddingTime = Number(rules.biddingTime);
    }
    if (Number(rules.answerTime) >= 3) {
      config.answerTime = Number(rules.answerTime);
    }
    persistTournamentState();
    broadcastPlayerViews();
    emitSnapshot();
    socket.emit('admin:notification', 'Competition rules updated successfully.');
  }));

  // LIVE PASS PENALTY CHANGE — allowed at any time, including during active competition.
  // If tournament is running, the new value is queued as pendingPassPenalty and activates
  // atomically at the START of the next question. The current question is unaffected.
  // If tournament hasn't started yet, applies immediately.
  socket.on('admin:update_pass_penalty', requireAdmin(({ passPenalty }) => {
    const newPenalty = Number(passPenalty);
    if (!Number.isInteger(newPenalty) || newPenalty < 0) {
      return socket.emit('admin:error', 'Invalid PASS penalty value. Must be a non-negative integer.');
    }
    if (!config.rulesLocked) {
      // Pre-tournament: apply immediately
      config.passPenalty = newPenalty;
      config.pendingPassPenalty = null;
      persistTournamentState();
      broadcastPlayerViews();
      emitSnapshot();
      socket.emit('admin:notification', `PASS penalty updated to −${newPenalty} pts (applied immediately).`);
    } else {
      // Live tournament: schedule for next round
      config.pendingPassPenalty = newPenalty;
      persistTournamentState();
      emitSnapshot();
      socket.emit('admin:notification', `PASS penalty scheduled: −${newPenalty} pts will activate from the next question.`);
    }
  }));

  // QUESTION MANAGER: Update individual question
  socket.on('admin:update_question', requireAdmin(({ questionId, updatedData }) => {
    const idx = questions.findIndex(q => q.id === questionId);
    if (idx === -1) return socket.emit('admin:error', 'Question not found.');

    if (config.rulesLocked) {
      if (idx === state.questionIndex && state.phase !== 'waiting') {
        return socket.emit('admin:error', 'Cannot edit active question while round is live.');
      }
      if (idx < state.questionIndex) {
        return socket.emit('admin:error', 'Cannot retroactively modify a completed question.');
      }
    }

    const target = questions[idx];
    if (updatedData.question) target.question = String(updatedData.question).trim();
    if (Array.isArray(updatedData.options) && updatedData.options.length >= 2) {
      target.options = updatedData.options.map(s => String(s).trim());
    }
    if (updatedData.answer) target.answer = String(updatedData.answer).trim();
    if (updatedData.category) target.category = String(updatedData.category).trim();
    if (updatedData.difficulty) target.difficulty = String(updatedData.difficulty).trim();
    if (updatedData.explanation !== undefined) target.explanation = String(updatedData.explanation).trim();

    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Question updated successfully.`);
  }));

  // QUESTION MANAGER: Add new question
  socket.on('admin:add_question', requireAdmin(newQ => {
    if (!newQ || !String(newQ.question || '').trim()) {
      return socket.emit('admin:error', 'Question text is required.');
    }
    if (!Array.isArray(newQ.options) || newQ.options.length < 2) {
      return socket.emit('admin:error', 'At least 2 answer options are required.');
    }
    if (!newQ.answer || !newQ.options.includes(newQ.answer)) {
      return socket.emit('admin:error', 'Correct answer must be one of the provided options.');
    }

    const maxId = questions.reduce((m, q) => Math.max(m, q.id || 0), 0);
    const q = {
      id: maxId + 1,
      question: String(newQ.question).trim(),
      options: newQ.options.map(s => String(s).trim()),
      answer: String(newQ.answer).trim(),
      category: String(newQ.category || 'General').trim(),
      difficulty: ['easy', 'medium', 'hard'].includes(newQ.difficulty) ? newQ.difficulty : 'easy',
      explanation: String(newQ.explanation || '').trim()
    };

    questions.push(q);
    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Question Q${questions.length} added. Bank now has ${questions.length} questions.`);
  }));

  // QUESTION MANAGER: Delete question (only upcoming questions, not current/completed)
  socket.on('admin:delete_question', requireAdmin(({ questionId }) => {
    const idx = questions.findIndex(q => q.id === questionId);
    if (idx === -1) return socket.emit('admin:error', 'Question not found.');

    if (questions.length <= 1) {
      return socket.emit('admin:error', 'Cannot delete: question bank must have at least 1 question.');
    }
    if (config.rulesLocked && idx <= state.questionIndex) {
      return socket.emit('admin:error', 'Cannot delete current or already-played questions during a live competition.');
    }

    const deleted = questions.splice(idx, 1)[0];
    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Question "${deleted.question.substring(0, 40)}..." deleted. Bank now has ${questions.length} questions.`);
  }));

  // QUESTION MANAGER: Reorder questions
  socket.on('admin:reorder_questions', requireAdmin(({ fromIndex, toIndex }) => {
    if (config.rulesLocked && (fromIndex <= state.questionIndex || toIndex <= state.questionIndex)) {
      return socket.emit('admin:error', 'Cannot reorder current or past questions once the competition is running.');
    }
    if (fromIndex < 0 || fromIndex >= questions.length || toIndex < 0 || toIndex >= questions.length) {
      return socket.emit('admin:error', 'Invalid question indices.');
    }

    const [moved] = questions.splice(fromIndex, 1);
    questions.splice(toIndex, 0, moved);

    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', 'Questions reordered successfully.');
  }));

  // TEAM ACTIONS (Adjust score, lock/unlock, kick, disqualify, reset violations)
  socket.on('admin:adjust_score', requireAdmin(({ teamId, delta, newScore }) => {
    const t = teams.get(teamId);
    if (!t) return socket.emit('admin:error', 'Team not found.');
    if (newScore !== undefined && !Number.isNaN(Number(newScore))) {
      t.points = Number(newScore);
    } else if (delta !== undefined && !Number.isNaN(Number(delta))) {
      t.points += Number(delta);
    }
    persistTournamentState();
    updatePlayerView(t.id);
    emitSnapshot();
    socket.emit('admin:notification', `Score updated for ${t.name} (${t.points} pts).`);
  }));

  socket.on('admin:kick_team', requireAdmin(({ teamId }) => {
    const t = teams.get(teamId);
    if (!t) return;
    if (t.socketId) {
      const sock = io.sockets.sockets.get(t.socketId);
      if (sock) sock.disconnect(true);
    }
    teams.delete(teamId);
    state.bids.delete(teamId);
    state.passes.delete(teamId);
    state.answerQueue = state.answerQueue.filter(x => x.teamId !== teamId);
    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Team ${t.name} removed from competition.`);
  }));

  socket.on('admin:toggle_lock_team', requireAdmin(({ teamId }) => {
    const t = teams.get(teamId);
    if (!t) return;
    t.locked = !t.locked;
    persistTournamentState();
    updatePlayerView(t.id);
    emitSnapshot();
  }));

  socket.on('admin:disqualify_team', requireAdmin(({ teamId }) => {
    const t = teams.get(teamId);
    if (!t) return;
    t.disqualified = true;
    persistTournamentState();
    updatePlayerView(t.id);
    emitSnapshot();
    socket.emit('admin:notification', `${t.name} has been disqualified.`);
  }));

  socket.on('admin:clear_violations', requireAdmin(({ teamId }) => {
    const t = teams.get(teamId);
    if (!t) return;
    t.violations = 0;
    persistTournamentState();
    updatePlayerView(t.id);
    emitSnapshot();
    socket.emit('admin:notification', `Violations cleared for ${t.name}.`);
  }));

  /* === OPTIONAL FEATURE: ADMIN APPROVAL FOR PLAYER ADMISSION === */
  socket.on('admin:set_approval_mode', requireAdmin(({ enabled }) => {
    const prevMode = config.requireAdminApproval;
    config.requireAdminApproval = Boolean(enabled);

    // If toggled OFF from ON, auto-approve any pending requests so waiting players aren't stranded
    if (prevMode && !config.requireAdminApproval) {
      for (const req of admissionRequests.values()) {
        if (req.status === 'pending') {
          req.status = 'approved';
          let tm = [...teams.values()].find(t => t.name.toLowerCase() === req.name.toLowerCase());
          if (!tm) {
            tm = {
              id: req.id,
              name: req.name,
              members: req.members || '',
              points: 100,
              sessionToken: req.sessionToken,
              socketId: req.socketId,
              violations: 0,
              disqualified: false,
              locked: false
            };
            teams.set(tm.id, tm);
          }
          if (req.socketId) {
            socketTeams.set(req.socketId, tm.id);
            io.to(req.socketId).emit('team:joined', payload(tm));
            updatePlayerView(tm.id);
          }
        }
      }
    }

    persistTournamentState();
    emitSnapshot();
    io.emit('config:update', { requireAdminApproval: config.requireAdminApproval });
    socket.emit('admin:notification', `Admin admission approval set to ${config.requireAdminApproval ? 'ON' : 'OFF'}.`);
  }));

  socket.on('admin:approve_admission', requireAdmin(({ requestId }) => {
    const req = admissionRequests.get(requestId);
    if (!req) return socket.emit('admin:error', 'Admission request not found.');
    if (req.status !== 'pending') return socket.emit('admin:error', `Request is already ${req.status}.`);

    req.status = 'approved';
    let tm = [...teams.values()].find(t => t.name.toLowerCase() === req.name.toLowerCase());
    if (!tm) {
      tm = {
        id: req.id,
        name: req.name,
        members: req.members || '',
        points: 100,
        sessionToken: req.sessionToken,
        socketId: req.socketId,
        violations: 0,
        disqualified: false,
        locked: false
      };
      teams.set(tm.id, tm);
    }
    if (req.socketId) {
      socketTeams.set(req.socketId, tm.id);
      io.to(req.socketId).emit('team:joined', payload(tm));
      updatePlayerView(tm.id);
    }

    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Approved team "${req.name}".`);
  }));

  socket.on('admin:reject_admission', requireAdmin(({ requestId }) => {
    const req = admissionRequests.get(requestId);
    if (!req) return socket.emit('admin:error', 'Admission request not found.');
    if (req.status !== 'pending') return socket.emit('admin:error', `Request is already ${req.status}.`);

    req.status = 'rejected';
    if (req.socketId) {
      io.to(req.socketId).emit('team:rejected', {
        requestId: req.id,
        teamName: req.name,
        message: 'Access request was rejected by admin.'
      });
    }

    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Rejected request for team "${req.name}".`);
  }));

  socket.on('admin:approve_all_admissions', requireAdmin(() => {
    let approvedCount = 0;
    for (const req of admissionRequests.values()) {
      if (req.status === 'pending') {
        req.status = 'approved';
        let tm = [...teams.values()].find(t => t.name.toLowerCase() === req.name.toLowerCase());
        if (!tm) {
          tm = {
            id: req.id,
            name: req.name,
            members: req.members || '',
            points: 100,
            sessionToken: req.sessionToken,
            socketId: req.socketId,
            violations: 0,
            disqualified: false,
            locked: false
          };
          teams.set(tm.id, tm);
        }
        if (req.socketId) {
          socketTeams.set(req.socketId, tm.id);
          io.to(req.socketId).emit('team:joined', payload(tm));
          updatePlayerView(tm.id);
        }
        approvedCount++;
      }
    }

    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', `Approved all ${approvedCount} pending admission requests.`);
  }));

  socket.on('admin:clear_admission_history', requireAdmin(() => {
    for (const [id, req] of [...admissionRequests.entries()]) {
      if (req.status === 'approved' || req.status === 'rejected') {
        admissionRequests.delete(id);
      }
    }
    persistTournamentState();
    emitSnapshot();
    socket.emit('admin:notification', 'Cleared completed admission request history.');
  }));

  // Disconnect handler
  socket.on('disconnect', () => {
    const teamId = socketTeams.get(socket.id);
    if (teamId && teams.has(teamId)) {
      const t = teams.get(teamId);
      // Only clear socketId if it matches this disconnecting socket
      if (t.socketId === socket.id) {
        t.socketId = null;
      }
    }
    for (const req of admissionRequests.values()) {
      if (req.socketId === socket.id) {
        req.socketId = null;
      }
    }
    socketTeams.delete(socket.id);
    emitSnapshot();
  });
});

// REST Health Check & Static SPA Hosting
app.get('/api/health', (_, res) => res.json({
  ok: true,
  phase: state.phase,
  isPaused: state.isPaused,
  teams: teams.size,
  question: state.questionIndex + 1,
  totalQuestions: questions.length,
  memory: process.memoryUsage(),
  uptime: process.uptime()
}));

app.get('/api/config', (_, res) => res.json({
  passPenalty: config.passPenalty,
  bidChoices: config.bidChoices,
  startingScore: 100,
  requireAdminApproval: Boolean(config.requireAdminApproval)
}));

app.get('/api/standings/last', (_, res) => res.json({
  lastCompletedTournament: lastCompletedTournament || null
}));

// Serve immutable hashed bundles
app.use('/assets', express.static(path.join(distDir, 'assets'), {
  maxAge: '1y',
  immutable: true
}));

app.use(express.static(path.join(rootDir, 'public')));

// Prevent browser/lab caching of index.html and root files
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.use((_, res) => {
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  } else {
    res.status(200).send('BIDNEX V2 Engine active. Run build to generate frontend.');
  }
});

server.listen(PORT, () => {
  console.log(`BIDNEX V2 Engine active on port ${PORT}`);
});
