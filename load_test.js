import { io } from 'socket.io-client';

const URL = 'http://localhost:5000';
const ADMIN_PASSWORD = 'julie';

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function computePercentiles(arr) {
  if (!arr || arr.length === 0) return { min: 0, median: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || max;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || max;
  return { min, median, p95, p99, max };
}

async function fetchHealth() {
  try {
    const res = await fetch(`${URL}/api/health`);
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function runLoadTestStage(targetPlayers) {
  console.log(`\n============================================================`);
  console.log(`🚀 RUNNING LOAD TEST STAGE: ${targetPlayers} SIMULTANEOUS PLAYERS`);
  console.log(`============================================================`);

  const initialHealth = await fetchHealth();
  const initHeapMB = initialHealth?.memory ? (initialHealth.memory.heapUsed / 1024 / 1024).toFixed(2) : 'N/A';
  const initRssMB = initialHealth?.memory ? (initialHealth.memory.rss / 1024 / 1024).toFixed(2) : 'N/A';
  console.log(`[Baseline] Server Heap: ${initHeapMB} MB, RSS: ${initRssMB} MB, Teams in state: ${initialHealth?.teams ?? 0}`);

  // 1. Connect and Authenticate Admin
  const adminSocket = io(URL, { forceNew: true, reconnection: false });
  await new Promise((resolve, reject) => {
    adminSocket.on('connect', resolve);
    adminSocket.on('connect_error', reject);
  });

  const adminAuthPromise = new Promise((resolve, reject) => {
    adminSocket.on('admin:authenticated', resolve);
    adminSocket.on('admin:error', reject);
  });
  adminSocket.emit('admin:auth', ADMIN_PASSWORD);
  await adminAuthPromise;

  // Clean reset tournament state
  adminSocket.emit('admin:reset_tournament');
  adminSocket.emit('admin:set_approval_mode', { enabled: false });
  await sleep(300);

  // Set fast test rules
  adminSocket.emit('admin:update_rules', {
    bidChoices: [2, 4, 6, 9, 10, 13, 15],
    passPenalty: 5,
    biddingTime: 6,
    answerTime: 4
  });
  await sleep(200);

  // Metrics collection
  const connectionLatencies = [];
  const joinLatencies = [];
  const actionLatencies = [];
  const reconnectLatencies = [];
  let connectionErrors = 0;
  let unexpectedDisconnects = 0;
  let socketErrors = 0;
  let timerTicksCount = 0;

  const clients = []; // Array of { id, index, socket, teamData, sessionToken, lastSync }

  // 2. Spawn and Connect All Target Players
  console.log(`Connecting ${targetPlayers} player client sockets concurrently...`);
  const connectPromises = [];

  for (let i = 1; i <= targetPlayers; i++) {
    const p = new Promise((resolve) => {
      const startTime = performance.now();
      const socket = io(URL, { forceNew: true, reconnection: false });
      const clientObj = {
        index: i,
        name: `Team_Load_${i}`,
        socket,
        teamData: null,
        sessionToken: null,
        lastSync: null,
        errors: []
      };

      socket.on('connect', () => {
        const connDuration = performance.now() - startTime;
        connectionLatencies.push(connDuration);

        // Join team
        const joinStartTime = performance.now();
        socket.emit('team:join', { name: clientObj.name, members: `Member_A${i}, Member_B${i}` });

        socket.on('team:joined', (teamData) => {
          const joinDuration = performance.now() - joinStartTime;
          joinLatencies.push(joinDuration);
          clientObj.teamData = teamData;
          clientObj.sessionToken = teamData.sessionToken;
          resolve(clientObj);
        });
      });

      socket.on('player:sync', (syncData) => {
        clientObj.lastSync = syncData;
        if (syncData.team) {
          clientObj.teamData = syncData.team;
        }
      });

      socket.on('timer', () => {
        timerTicksCount++;
      });

      socket.on('connect_error', (err) => {
        connectionErrors++;
        clientObj.errors.push(err.message);
        resolve(clientObj);
      });

      socket.on('disconnect', (reason) => {
        if (reason !== 'io client disconnect') {
          unexpectedDisconnects++;
        }
      });

      socket.on('team:error', (msg) => {
        socketErrors++;
        clientObj.errors.push(msg);
      });

      socket.on('bid:error', (msg) => {
        socketErrors++;
        clientObj.errors.push(msg);
      });

      clients.push(clientObj);
    });

    connectPromises.push(p);
  }

  await Promise.all(connectPromises);

  const connectedClients = clients.filter(c => c.teamData !== null);
  console.log(`✓ Connected & registered: ${connectedClients.length}/${targetPlayers} teams`);

  // Verify initial points
  const invalidStartingPoints = connectedClients.filter(c => c.teamData.points !== 100);
  if (invalidStartingPoints.length > 0) {
    throw new Error(`Starting score mismatch on ${invalidStartingPoints.length} teams`);
  }

  // 3. Question 1 Live Bidding Under Load
  console.log('Starting competition round 0...');
  adminSocket.emit('admin:start');
  await sleep(600); // Allow round start to propagate

  // Verify all players entered bidding
  const biddingReceived = connectedClients.filter(c => c.lastSync?.phase === 'bidding').length;
  console.log(`✓ Bidding state received by ${biddingReceived}/${connectedClients.length} players`);

  // Simulate concurrent player actions
  // Distribution:
  // ~60% place bids (varying amounts)
  // ~20% pass
  // ~20% idle
  console.log('Simulating concurrent bids and passes...');
  const actionPromises = [];
  const bidAmounts = [2, 4, 6, 9, 10, 13, 15];

  for (let i = 0; i < connectedClients.length; i++) {
    const client = connectedClients[i];
    const actionIndex = i % 10; // 0..5: bid, 6..7: pass, 8..9: idle

    if (actionIndex <= 5) {
      // Place bid
      const bid = bidAmounts[i % bidAmounts.length];
      const p = new Promise(res => {
        const start = performance.now();
        client.socket.once('bid:locked', ({ bid: confirmedBid }) => {
          actionLatencies.push(performance.now() - start);
          client.assignedAction = { type: 'bid', amount: confirmedBid };
          res();
        });
        client.socket.emit('team:bid', bid);
      });
      actionPromises.push(p);
    } else if (actionIndex <= 7) {
      // Pass
      const p = new Promise(res => {
        const start = performance.now();
        client.socket.once('pass:confirmed', ({ penalty, points }) => {
          actionLatencies.push(performance.now() - start);
          client.assignedAction = { type: 'pass', penalty, points };
          res();
        });
        client.socket.emit('team:pass');
      });
      actionPromises.push(p);
    } else {
      client.assignedAction = { type: 'idle' };
    }
  }

  await Promise.all(actionPromises);
  console.log(`✓ Concurrent actions processed: ${actionPromises.length} actions locked`);

  // 4. Close Bidding & Answer Cascade
  console.log('Closing bidding and resolving highest bidder...');
  const answeringPhasePromise = new Promise((resolve) => {
    const handler = (s) => {
      if (s.phase === 'answering' && s.activeBidder) {
        adminSocket.off('admin:snapshot', handler);
        resolve(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });

  adminSocket.emit('admin:close_bidding_early');
  const answeringSnapshot = await answeringPhasePromise;

  const activeBidderInfo = answeringSnapshot.activeBidder;
  console.log(`✓ Active bidder: ${activeBidderInfo.teamName} with bid ${activeBidderInfo.bid} pts`);

  // Active bidder submits correct answer
  const activeClient = connectedClients.find(c => c.teamData.id === activeBidderInfo.teamId);
  if (!activeClient) throw new Error('Active bidder client not found in connected clients');

  const question = answeringSnapshot.question;
  const answerPromise = new Promise(res => {
    activeClient.socket.once('player:answer_feedback', res);
  });

  activeClient.socket.emit('team:answer', question.answer);
  const answerResult = await answerPromise;
  console.log(`✓ Active bidder answer submitted: ${answerResult.message}`);
  if (answerResult.type !== 'correct') throw new Error(`Expected correct answer, got: ${answerResult.type}`);

  await sleep(1000); // Allow question_result phase sync

  // 5. Test Global Pause / Resume Under Load
  console.log('Testing Global Pause / Resume under load...');
  adminSocket.emit('admin:pause');
  await sleep(400);

  const pausedCount = connectedClients.filter(c => c.lastSync?.isPaused === true).length;
  console.log(`✓ Pause received by ${pausedCount}/${connectedClients.length} players`);

  adminSocket.emit('admin:resume');
  await sleep(400);

  const resumedCount = connectedClients.filter(c => c.lastSync?.isPaused === false).length;
  console.log(`✓ Resume received by ${resumedCount}/${connectedClients.length} players`);

  // 6. Test Concurrent Reconnect Under Load
  const reconnectCount = Math.min(5, Math.max(1, Math.floor(connectedClients.length * 0.1)));
  console.log(`Testing concurrent reconnection for ${reconnectCount} players...`);
  const reconnectPromises = [];

  for (let i = 0; i < reconnectCount; i++) {
    const target = connectedClients[i];
    const savedToken = target.sessionToken;
    const expectedPoints = target.teamData.points;

    // Disconnect old socket
    target.socket.disconnect();

    const p = new Promise(res => {
      const start = performance.now();
      const newSock = io(URL, { forceNew: true, reconnection: false });
      newSock.on('connect', () => {
        newSock.emit('team:reconnect', { token: savedToken });
      });
      newSock.on('team:joined', (restoredTeam) => {
        const dur = performance.now() - start;
        reconnectLatencies.push(dur);
        if (restoredTeam.points !== expectedPoints) {
          throw new Error(`Reconnected score mismatch: got ${restoredTeam.points}, expected ${expectedPoints}`);
        }
        target.socket = newSock;
        target.teamData = restoredTeam;
        res();
      });
    });
    reconnectPromises.push(p);
  }

  await Promise.all(reconnectPromises);
  console.log(`✓ All ${reconnectCount} reconnected players verified with matching state and points`);

  // 7. Verify Ground Truth State Consistency Across All Connected Players
  console.log('Verifying score consistency across all connected clients...');
  let scoreMismatches = 0;
  for (const client of connectedClients) {
    const serverTeam = answeringSnapshot.teams.find(t => t.id === client.teamData.id);
    if (!serverTeam) continue;
    // Check if points match expectations:
    // If active bidder: 100 + bid
    // If passed: 100 - 5 = 95
    // If idle: 100
    let expected = 100;
    if (client.teamData.id === activeBidderInfo.teamId) {
      expected = 100 + activeBidderInfo.bid;
    } else if (client.assignedAction?.type === 'pass') {
      expected = 95;
    }

    if (client.teamData.points !== expected) {
      scoreMismatches++;
      console.warn(`[Score Mismatch] ${client.name}: expected ${expected}, got ${client.teamData.points}`);
    }
  }

  if (scoreMismatches === 0) {
    console.log(`✓ 100% Score consistency verified across all ${connectedClients.length} clients!`);
  }

  // 8. Sample Final Health & Metrics
  const finalHealth = await fetchHealth();
  const finalHeapMB = finalHealth?.memory ? (finalHealth.memory.heapUsed / 1024 / 1024).toFixed(2) : 'N/A';
  const finalRssMB = finalHealth?.memory ? (finalHealth.memory.rss / 1024 / 1024).toFixed(2) : 'N/A';
  const heapDeltaMB = (finalHealth?.memory && initialHealth?.memory) 
    ? ((finalHealth.memory.heapUsed - initialHealth.memory.heapUsed) / 1024 / 1024).toFixed(2) 
    : '0.00';

  // 9. Clean Teardown
  adminSocket.emit('admin:reset_tournament');
  await sleep(200);

  for (const client of clients) {
    try {
      client.socket.disconnect();
    } catch {}
  }
  adminSocket.disconnect();
  await sleep(300);

  // Statistics Summary
  const connStats = computePercentiles(connectionLatencies);
  const joinStats = computePercentiles(joinLatencies);
  const actionStats = computePercentiles(actionLatencies);
  const reconnectStats = computePercentiles(reconnectLatencies);

  const passedCriteria = 
    connectedClients.length === targetPlayers &&
    unexpectedDisconnects === 0 &&
    socketErrors === 0 &&
    scoreMismatches === 0 &&
    actionStats.median < 100 &&
    actionStats.p95 < 250;

  const resultData = {
    targetPlayers,
    connected: connectedClients.length,
    failedConnections: connectionErrors,
    unexpectedDisconnects,
    socketErrors,
    scoreMismatches,
    timerTicksCount,
    connectionLatencies: connStats,
    joinLatencies: joinStats,
    actionLatencies: actionStats,
    reconnectLatencies: reconnectStats,
    memory: {
      initialHeapMB: initHeapMB,
      finalHeapMB: finalHeapMB,
      deltaMB: heapDeltaMB,
      rssMB: finalRssMB
    },
    passedCriteria
  };

  console.log(`------------------------------------------------------------`);
  console.log(`📊 STAGE ${targetPlayers} PLAYERS SUMMARY:`);
  console.log(`- Connected / Attempted: ${connectedClients.length}/${targetPlayers} (Success: ${(connectedClients.length/targetPlayers*100).toFixed(1)}%)`);
  console.log(`- Connection Failures:   ${connectionErrors}`);
  console.log(`- Unexpected Drops:      ${unexpectedDisconnects}`);
  console.log(`- Socket Errors:         ${socketErrors}`);
  console.log(`- Score Inconsistencies: ${scoreMismatches}`);
  console.log(`- Action Latency (p50):  ${actionStats.median.toFixed(1)} ms`);
  console.log(`- Action Latency (p95):  ${actionStats.p95.toFixed(1)} ms`);
  console.log(`- Action Latency (p99):  ${actionStats.p99.toFixed(1)} ms`);
  console.log(`- Server Heap Used:      ${finalHeapMB} MB (Δ ${heapDeltaMB} MB)`);
  console.log(`- Acceptance Status:     ${passedCriteria ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`------------------------------------------------------------\n`);

  return resultData;
}

// Master Runner CLI
async function main() {
  const args = process.argv.slice(2);
  let stages = [1, 10, 25, 40, 50, 60];

  const pIdx = args.indexOf('--players');
  if (pIdx !== -1 && args[pIdx + 1]) {
    stages = [Number(args[pIdx + 1])];
  }

  console.log('====================================================');
  console.log('BIDNEX V2 REAL-TIME CONCURRENT LOAD TEST SUITE');
  console.log(`Stages to evaluate: ${stages.join(', ')} concurrent players`);
  console.log('====================================================');

  const allResults = [];

  for (const stage of stages) {
    try {
      const res = await runLoadTestStage(stage);
      allResults.push(res);
      await sleep(1000); // Cool-down between stages
    } catch (err) {
      console.error(`❌ Load test stage ${stage} players failed with fatal error:`, err);
      allResults.push({
        targetPlayers: stage,
        error: err.message,
        passedCriteria: false
      });
      break;
    }
  }

  console.log('\n========================================================================================');
  console.log('🏁 FINAL CONCURRENT LOAD TEST RESULTS TABLE');
  console.log('========================================================================================');
  console.log('| Players | Connected | Disconnects | Action p50 | Action p95 | Action p99 | Heap (MB) | Status |');
  console.log('|---------|-----------|-------------|------------|------------|------------|-----------|--------|');
  for (const r of allResults) {
    if (r.error) {
      console.log(`| ${String(r.targetPlayers).padEnd(7)} | ERROR     | ERROR       | ERROR      | ERROR      | ERROR      | ERROR     | ❌ FAIL |`);
    } else {
      console.log(`| ${String(r.targetPlayers).padEnd(7)} | ${String(r.connected + '/' + r.targetPlayers).padEnd(9)} | ${String(r.unexpectedDisconnects).padEnd(11)} | ${String(r.actionLatencies.median.toFixed(1) + 'ms').padEnd(10)} | ${String(r.actionLatencies.p95.toFixed(1) + 'ms').padEnd(10)} | ${String(r.actionLatencies.p99.toFixed(1) + 'ms').padEnd(10)} | ${String(r.memory.finalHeapMB).padEnd(9)} | ${r.passedCriteria ? '✅ PASS' : '❌ FAIL'} |`);
    }
  }
  console.log('========================================================================================\n');
}

if (process.argv[1]?.endsWith('load_test.js')) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('Fatal load test failure:', err);
    process.exit(1);
  });
}

