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
const STATE_FILE = path.join(rootDir, 'tournament_state.json');
const PORT = Number(process.env.PORT || 5000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'julie';
const TOTAL_QUESTIONS = 25;

// Default initial question pool (25 high-quality technical questions)
const defaultQuestions = [
  { id: 1, question: 'Which protocol is commonly used for lightweight IoT messaging?', options: ['HTTP', 'MQTT', 'FTP', 'SMTP'], answer: 'MQTT', category: 'IoT', difficulty: 'easy', explanation: 'MQTT (Message Queuing Telemetry Transport) is a lightweight publish-subscribe network protocol designed for resource-constrained IoT devices.' },
  { id: 2, question: 'Which data structure follows FIFO (First-In, First-Out) order?', options: ['Stack', 'Queue', 'Tree', 'Graph'], answer: 'Queue', category: 'Data Structures', difficulty: 'easy', explanation: 'A Queue inserts elements at the rear and removes from the front, ensuring First-In First-Out order.' },
  { id: 3, question: 'What does CSS primarily control in web applications?', options: ['Database logic', 'Page presentation & style', 'Server routing', 'CPU scheduling'], answer: 'Page presentation & style', category: 'Web', difficulty: 'easy', explanation: 'Cascading Style Sheets (CSS) dictate visual presentation, layout, fonts, and colors for HTML documents.' },
  { id: 4, question: 'Which HTTP status code signifies "Not Found"?', options: ['200', '301', '404', '500'], answer: '404', category: 'Web', difficulty: 'easy', explanation: 'HTTP 404 Not Found indicates that the client was able to communicate with a given server, but the server could not find what was requested.' },
  { id: 5, question: 'Which algorithm finds the single-source shortest path on graphs with non-negative edge weights?', options: ['Dijkstra', 'Kruskal', 'Boyer-Moore', 'KMP'], answer: 'Dijkstra', category: 'Algorithms', difficulty: 'medium', explanation: "Dijkstra's algorithm greedily expands the shortest path tree from source to target with non-negative edge weights." },
  { id: 6, question: 'Which SQL command is used to query and retrieve rows from a table?', options: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], answer: 'SELECT', category: 'SQL', difficulty: 'easy', explanation: 'The SELECT statement returns a result set of records from one or more database tables.' },
  { id: 7, question: 'Which Java keyword is used to inherit another class?', options: ['implements', 'extends', 'inherits', 'super'], answer: 'extends', category: 'Java', difficulty: 'easy', explanation: 'In Java, the extends keyword establishes an inheritance relationship between a subclass and its superclass.' },
  { id: 8, question: 'What is the default standard port for unencrypted HTTP traffic?', options: ['21', '25', '80', '443'], answer: '80', category: 'Networking', difficulty: 'easy', explanation: 'Port 80 is assigned by IANA for standard unencrypted World Wide Web HTTP traffic (HTTPS uses 443).' },
  { id: 9, question: 'Which library/framework popularised component-based UI with a virtual DOM?', options: ['React', 'MySQL', 'Docker', 'Redis'], answer: 'React', category: 'Web', difficulty: 'easy', explanation: 'React utilizes reusable components, declarative JSX, and an in-memory virtual DOM to optimize rendering.' },
  { id: 10, question: 'Which relational database normal form eliminates partial functional dependencies?', options: ['1NF', '2NF', '3NF', 'BCNF'], answer: '2NF', category: 'DBMS', difficulty: 'medium', explanation: 'Second Normal Form (2NF) requires 1NF and guarantees that all non-key attributes are fully functionally dependent on the entire primary key.' },
  { id: 11, question: 'Which cloud computing model delivers raw virtual machines, storage, and networking?', options: ['SaaS', 'PaaS', 'IaaS', 'DBaaS'], answer: 'IaaS', category: 'Cloud', difficulty: 'easy', explanation: 'Infrastructure as a Service (IaaS) provides virtualized computing resources over the cloud (e.g., AWS EC2, Azure VMs).' },
  { id: 12, question: 'Which Git command creates a local working copy of a remote repository?', options: ['git clone', 'git push', 'git merge', 'git diff'], answer: 'git clone', category: 'DevOps', difficulty: 'easy', explanation: 'git clone copies an existing repository, including all history and branches, to a new directory.' },
  { id: 13, question: 'Which layer of the OSI 7-layer model handles packet addressing and logical routing?', options: ['Data Link', 'Network', 'Session', 'Presentation'], answer: 'Network', category: 'Networking', difficulty: 'medium', explanation: 'Layer 3 (Network Layer) is responsible for packet forwarding, routing through intermediate routers, and IP addressing.' },
  { id: 14, question: 'Which standard Python built-in sequence type is immutable after creation?', options: ['List', 'Dictionary', 'Set', 'Tuple'], answer: 'Tuple', category: 'Python', difficulty: 'easy', explanation: 'Tuples are immutable sequence types in Python; once assigned, their elements cannot be changed or appended.' },
  { id: 15, question: 'Which comparison sort algorithm has a guaranteed average and worst-case O(n log n) time complexity?', options: ['Bubble Sort', 'Merge Sort', 'Linear Search', 'Counting Sort'], answer: 'Merge Sort', category: 'Algorithms', difficulty: 'medium', explanation: 'Merge Sort divides arrays into halves and merges them, maintaining O(n log n) running time across best, average, and worst cases.' },
  { id: 16, question: 'What does the abbreviation API stand for in software development?', options: ['Application Programming Interface', 'Advanced Program Internet', 'Application Process Integration', 'Automated Protocol Interface'], answer: 'Application Programming Interface', category: 'Software', difficulty: 'easy', explanation: 'An Application Programming Interface defines rules and protocols enabling software applications to communicate.' },
  { id: 17, question: 'Which NoSQL database engine stores semi-structured data as BSON documents?', options: ['MongoDB', 'MySQL', 'PostgreSQL', 'Oracle'], answer: 'MongoDB', category: 'DBMS', difficulty: 'easy', explanation: 'MongoDB is a document-oriented database using JSON-like BSON documents with dynamic schemas.' },
  { id: 18, question: 'Which container runtime and packaging tool isolates applications inside lightweight containers?', options: ['Docker', 'Jenkins', 'Nginx', 'Gradle'], answer: 'Docker', category: 'DevOps', difficulty: 'easy', explanation: 'Docker packages an application and its dependencies into a container image that runs uniformly across environments.' },
  { id: 19, question: 'Which Java standard collection class stores associations between unique keys and values?', options: ['ArrayList', 'HashMap', 'Stack', 'PriorityQueue'], answer: 'HashMap', category: 'Java', difficulty: 'easy', explanation: 'HashMap provides a hash-table based implementation of the Map interface for key-value pair lookups in O(1) average time.' },
  { id: 20, question: 'Which security protocol operates over TLS to secure HTTP communications on port 443?', options: ['HTTPS', 'Telnet', 'FTP', 'ARP'], answer: 'HTTPS', category: 'Networking', difficulty: 'easy', explanation: 'Hypertext Transfer Protocol Secure (HTTPS) encrypts communication between the client and server using TLS/SSL.' },
  { id: 21, question: 'Which supervised machine learning task models and predicts a continuous real numeric value?', options: ['Classification', 'Regression', 'Clustering', 'Association'], answer: 'Regression', category: 'Machine Learning', difficulty: 'medium', explanation: 'Regression algorithms forecast continuous output quantities (such as temperature, price, or time), whereas classification predicts discrete classes.' },
  { id: 22, question: 'Which balanced tree data structure is widely utilized for database indexing on disk storage?', options: ['B-Tree', 'Linked List', 'Stack', 'Min-Heap'], answer: 'B-Tree', category: 'DBMS', difficulty: 'medium', explanation: 'B-Trees and B+ Trees keep keys sorted and balance node size to align with storage block/page reads for fast indexing.' },
  { id: 23, question: 'Which standard UNIX/Linux shell command lists files and subdirectories?', options: ['ls', 'cd', 'pwdx', 'touchx'], answer: 'ls', category: 'Operating Systems', difficulty: 'easy', explanation: 'The ls command lists directory contents, filenames, and attributes in POSIX operating systems.' },
  { id: 24, question: 'Which high-speed hardware memory subsystem buffers frequently used data near the CPU core?', options: ['Cache', 'Compiler', 'Router', 'Parser'], answer: 'Cache', category: 'Computer Architecture', difficulty: 'easy', explanation: 'CPU cache (L1/L2/L3) is fast static RAM situated on the processor die to minimize latency from main memory (DRAM).' },
  { id: 25, question: 'Which React hook is standardly used to declare and update local state variables in a function component?', options: ['useState', 'useRoute', 'useNode', 'useClass'], answer: 'useState', category: 'React', difficulty: 'easy', explanation: 'useState declares a state variable and gives components an updater function that triggers re-renders on mutation.' }
];

// Server Authoritative Configuration & State
const config = {
  bidChoices: [2, 4, 6, 9, 10, 13, 15],
  passPenalty: 5, // magnitude: deductions are -passPenalty
  biddingTime: 15,
  answerTime: 10,
  rulesLocked: false // Locked once tournament starts
};

const teams = new Map(); // teamId -> team object
const socketTeams = new Map(); // socketId -> teamId

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
  roundResults: [] // historic results log
};

// Recovery persistence helper
function persistTournamentState() {
  try {
    const dataToSave = {
      config,
      questions,
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
        roundResults: state.roundResults
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
      if (saved.config) Object.assign(config, saved.config);
      if (Array.isArray(saved.questions) && saved.questions.length === TOTAL_QUESTIONS) {
        questions = saved.questions;
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
      }
      console.log('Restored tournament state successfully from backup.');
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
    totalQuestions: TOTAL_QUESTIONS,
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
  const currentQ = (state.questionIndex >= 0 && state.questionIndex < TOTAL_QUESTIONS)
    ? questions[state.questionIndex]
    : null;

  return {
    phase: state.phase,
    isPaused: state.isPaused,
    rulesLocked: config.rulesLocked,
    config: {
      bidChoices: config.bidChoices,
      passPenalty: config.passPenalty,
      biddingTime: config.biddingTime,
      answerTime: config.answerTime
    },
    question: currentQ ? {
      ...publicQuestion(currentQ, state.questionIndex),
      options: currentQ.options,
      answer: currentQ.answer,
      explanation: currentQ.explanation
    } : null,
    questionNumber: state.questionIndex + 1,
    totalQuestions: TOTAL_QUESTIONS,
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
    results: state.roundResults
  };
};

const emitSnapshot = () => {
  io.to('admins').emit('admin:snapshot', snapshot());
};

// Player personalized view update
function updatePlayerView(teamId) {
  const t = teams.get(teamId);
  if (!t || !t.socketId) return;

  const currentQ = (state.questionIndex >= 0 && state.questionIndex < TOTAL_QUESTIONS)
    ? questions[state.questionIndex]
    : null;

  const userBid = state.bids.get(teamId);
  const userPassed = state.passes.has(teamId);
  const isSelectedActive = state.activeBidder && state.activeBidder.teamId === teamId;

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
    }
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
  if (nextIndex >= TOTAL_QUESTIONS) {
    state.phase = 'finished';
    state.activeBidder = null;
    state.answerQueue = [];
    state.bids.clear();
    state.passes.clear();
    persistTournamentState();
    io.emit('event:finished');
    broadcastPlayerViews();
    emitSnapshot();
    return;
  }

  startRound(nextIndex);
}

// Start round for question index
function startRound(index) {
  clearTimer();
  config.rulesLocked = true;
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

    const lower = name.toLowerCase();
    const existing = [...teams.values()].find(t => t.name.toLowerCase() === lower);

    if (existing) {
      if (existing.socketId && existing.socketId !== socket.id) {
        return socket.emit('team:error', 'This team is already connected from another device/window.');
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
    if (!t) return socket.emit('team:error', 'Your session has expired. Please join again.');

    t.socketId = socket.id;
    socketTeams.set(socket.id, t.id);

    socket.emit('team:joined', payload(t));
    updatePlayerView(t.id);
    emitSnapshot();
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
    const isCorrect = String(chosenOption).trim() === String(q.answer).trim();

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

  // Anti-Cheating & Tab / Window Visibility Violation Tracking
  socket.on('team:violation', data => {
    const teamId = socketTeams.get(socket.id);
    const t = teams.get(teamId);
    if (!t) return;

    // Cap at 3 maximum violations
    const current = t.violations || 0;
    t.violations = Math.min(3, current + 1);
    persistTournamentState();

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
    if (state.questionIndex >= 0 && state.questionIndex < TOTAL_QUESTIONS) {
      clearTimer();
      state.isPaused = false;
      startRound(state.questionIndex);
    }
  }));

  // Emergency Stop / End Tournament
  socket.on('admin:end_tournament', requireAdmin(() => {
    clearTimer();
    state.phase = 'finished';
    state.isPaused = false;
    state.activeBidder = null;
    state.answerQueue = [];
    persistTournamentState();
    io.emit('event:finished');
    broadcastPlayerViews();
    emitSnapshot();
  }));

  // Reset Tournament
  socket.on('admin:reset_tournament', requireAdmin(() => {
    clearTimer();
    config.rulesLocked = false;
    for (const t of teams.values()) {
      t.points = 100;
      t.violations = 0;
      t.disqualified = false;
      t.locked = false;
    }
    state.phase = 'waiting';
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
    io.emit('event:reset');
    broadcastPlayerViews();
    emitSnapshot();
  }));

  // Rule Configuration Updates (Bid Choices, PASS penalty, Timers)
  socket.on('admin:update_rules', requireAdmin(rules => {
    if (config.rulesLocked) {
      return socket.emit('admin:error', 'Rules are locked after the competition begins. Reset to reconfigure.');
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
    socket.emit('admin:notification', `Question ${questionId} updated.`);
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

  // Disconnect handler
  socket.on('disconnect', () => {
    const teamId = socketTeams.get(socket.id);
    if (teamId && teams.has(teamId)) {
      teams.get(teamId).socketId = null;
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
  totalQuestions: TOTAL_QUESTIONS
}));

app.get('/api/config', (_, res) => res.json({
  passPenalty: config.passPenalty,
  bidChoices: config.bidChoices,
  startingScore: 100
}));

app.use(express.static(distDir));
app.use((_, res) => res.sendFile(path.join(distDir, 'index.html')));

server.listen(PORT, () => {
  console.log(`BIDNEX V2 Engine active on port ${PORT}`);
});
