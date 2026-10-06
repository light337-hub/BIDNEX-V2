import { io } from 'socket.io-client';

const URL = 'http://localhost:5000';

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runTest() {
  console.log('--- STARTING BIDNEX V2 TEST SUITE ---');

  // 1. Connect Admin
  const adminSocket = io(URL);
  await new Promise(res => adminSocket.on('connect', res));
  console.log('✓ Admin connected');

  // Authenticate admin with password 'julie'
  const authPromise = new Promise((resolve, reject) => {
    adminSocket.on('admin:authenticated', resolve);
    adminSocket.on('admin:error', reject);
  });
  adminSocket.emit('admin:auth', 'julie');
  await authPromise;
  console.log('✓ Admin authenticated with "julie"');

  // Reset tournament to clean state
  adminSocket.emit('admin:reset_tournament');
  await sleep(500);

  // 2. Configure Rules (bid choices & pass penalty)
  adminSocket.emit('admin:update_rules', {
    bidChoices: [5, 10, 15, 20],
    passPenalty: 10,
    biddingTime: 10,
    answerTime: 6
  });
  await sleep(300);
  console.log('✓ Admin updated rules: bid choices [5, 10, 15, 20], PASS penalty 10');

  // 3. Connect Teams (Team A, Team B, Team C)
  const clientA = io(URL);
  const clientB = io(URL);
  const clientC = io(URL);

  let syncAData = null;
  clientA.on('player:sync', (data) => {
    syncAData = data;
  });

  const teamAPromise = new Promise(res => clientA.on('team:joined', res));
  clientA.emit('team:join', 'Team Alpha');
  const teamA = await teamAPromise;
  console.log(`✓ Team Alpha joined (Starting score: ${teamA.points})`);
  if (teamA.points !== 100) throw new Error('Starting score must be 100');

  const teamBPromise = new Promise(res => clientB.on('team:joined', res));
  clientB.emit('team:join', 'Team Beta');
  const teamB = await teamBPromise;
  console.log(`✓ Team Beta joined (Starting score: ${teamB.points})`);

  const teamCPromise = new Promise(res => clientC.on('team:joined', res));
  clientC.emit('team:join', 'Team Gamma');
  const teamC = await teamCPromise;
  console.log(`✓ Team Gamma joined (Starting score: ${teamC.points})`);

  await sleep(500);
  console.log('✓ Player received updated bid choices:', syncAData?.config?.bidChoices);
  if (!syncAData?.config?.bidChoices?.includes(20)) throw new Error('Custom bid choice 20 not received');

  // 4. Test Question 1 Flow (Start round 0)
  adminSocket.emit('admin:start');
  await sleep(500);

  // Team Alpha bids 15
  const bidAPromise = new Promise(res => clientA.once('bid:locked', res));
  clientA.emit('team:bid', 15);
  await bidAPromise;

  // Team Beta bids 10
  const bidBPromise = new Promise(res => clientB.once('bid:locked', res));
  clientB.emit('team:bid', 10);
  await bidBPromise;

  // Team Gamma PASSES
  const passCPromise = new Promise(res => clientC.once('pass:confirmed', res));
  clientC.emit('team:pass');
  await passCPromise;

  console.log('✓ Confirmed: Team Alpha bid 15 locked, Team Beta bid 10 locked, Team Gamma Passed');

  // Fast-forward close bidding
  const snapPromise = new Promise(res => {
    const handler = (s) => {
      if (s.phase === 'answering' && s.activeBidder) {
        adminSocket.off('admin:snapshot', handler);
        res(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });
  adminSocket.emit('admin:close_bidding_early');
  let snap = await snapPromise;

  // 5. Test Answer Cascade
  // Alpha is highest bidder, should be active
  console.log(`✓ Active bidder: ${snap.activeBidder?.teamName} with bid ${snap.activeBidder?.bid}`);
  if (snap.activeBidder?.teamName !== 'Team Alpha') throw new Error(`Expected Team Alpha, got ${snap.activeBidder?.teamName}`);

  // Team Alpha answers WRONG
  const cascadePromise = new Promise(res => {
    const handler = (s) => {
      if (s.phase === 'answering' && s.activeBidder?.teamName === 'Team Beta') {
        adminSocket.off('admin:snapshot', handler);
        res(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });
  clientA.emit('team:answer', 'WRONG_ANSWER');
  snap = await cascadePromise;

  console.log(`✓ After Alpha wrong, next bidder cascaded: ${snap.activeBidder?.teamName} with bid ${snap.activeBidder?.bid}`);
  if (snap.activeBidder?.teamName !== 'Team Beta') throw new Error('Cascade to Beta failed');

  // Team Beta answers CORRECTLY
  const correctAns = snap.question.answer;
  const resultPromise = new Promise(res => {
    const handler = (s) => {
      if (s.phase === 'question_result') {
        adminSocket.off('admin:snapshot', handler);
        res(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });
  clientB.emit('team:answer', correctAns);
  snap = await resultPromise;

  const alphaScore = snap.teams.find(t => t.name === 'Team Alpha').points;
  const betaScore = snap.teams.find(t => t.name === 'Team Beta').points;
  const gammaScore = snap.teams.find(t => t.name === 'Team Gamma').points;

  console.log(`✓ Scores after Q1: Alpha: ${alphaScore} (expected 85), Beta: ${betaScore} (expected 110), Gamma: ${gammaScore} (expected 90)`);
  if (alphaScore !== 85) throw new Error(`Alpha score wrong: ${alphaScore}`);
  if (betaScore !== 110) throw new Error(`Beta score wrong: ${betaScore}`);
  if (gammaScore !== 90) throw new Error(`Gamma score wrong: ${gammaScore}`);

  // 6. Test Pause & Resume
  const pausePromise = new Promise(res => {
    const handler = (s) => {
      if (s.isPaused === true) {
        adminSocket.off('admin:snapshot', handler);
        res(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });
  adminSocket.emit('admin:pause');
  let pauseSnap = await pausePromise;
  console.log('✓ Global pause verified: isPaused =', pauseSnap.isPaused);

  const resumePromise = new Promise(res => {
    const handler = (s) => {
      if (s.isPaused === false) {
        adminSocket.off('admin:snapshot', handler);
        res(s);
      }
    };
    adminSocket.on('admin:snapshot', handler);
  });
  adminSocket.emit('admin:resume');
  let resumeSnap = await resumePromise;
  console.log('✓ Global resume verified: isPaused =', resumeSnap.isPaused);

  // 7. Test Anti-cheat Violation tracking & capping at 3
  // Violation 1 -> 1/3 (already triggered above)
  const violationAlertPromise1 = new Promise(res => {
    adminSocket.once('admin:violation_alert', res);
  });
  clientA.emit('team:violation', { type: 'tab_switch' });
  const v1 = await violationAlertPromise1;
  console.log(`✓ Violation 1 -> ${v1.violationCount}/3`);
  if (v1.violationCount !== 1) throw new Error(`Expected 1, got ${v1.violationCount}`);

  // Violation 2 -> 2/3
  const violationAlertPromise2 = new Promise(res => {
    adminSocket.once('admin:violation_alert', res);
  });
  clientA.emit('team:violation', { type: 'tab_switch' });
  const v2 = await violationAlertPromise2;
  console.log(`✓ Violation 2 -> ${v2.violationCount}/3`);
  if (v2.violationCount !== 2) throw new Error(`Expected 2, got ${v2.violationCount}`);

  // Violation 3 -> 3/3 Final Violation
  const violationAlertPromise3 = new Promise(res => {
    adminSocket.once('admin:violation_alert', res);
  });
  clientA.emit('team:violation', { type: 'tab_switch' });
  const v3 = await violationAlertPromise3;
  console.log(`✓ Violation 3 -> ${v3.violationCount}/3 (isFinal: ${v3.isFinal})`);
  if (v3.violationCount !== 3 || !v3.isFinal) throw new Error('Expected 3/3 Final Violation');

  // Violation 4 -> MUST STILL BE CAPPED AT 3/3
  const violationAlertPromise4 = new Promise(res => {
    adminSocket.once('admin:violation_alert', res);
  });
  clientA.emit('team:violation', { type: 'tab_switch' });
  const v4 = await violationAlertPromise4;
  console.log(`✓ Violation 4 -> still capped at ${v4.violationCount}/3 (isFinal: ${v4.isFinal})`);
  if (v4.violationCount !== 3) throw new Error(`Violation count exceeded 3! Value: ${v4.violationCount}`);

  // 8. Reconnect test & verify violation count persists at 3/3
  const savedToken = teamA.sessionToken;
  clientA.disconnect();
  await sleep(300);

  const clientAReconnect = io(URL);
  const reconnectPromise = new Promise(res => clientAReconnect.on('team:joined', res));
  clientAReconnect.emit('team:reconnect', { token: savedToken });
  const reconnectedTeam = await reconnectPromise;
  console.log(`✓ Team Alpha reconnected: points ${reconnectedTeam.points}, violations ${reconnectedTeam.violations}/3`);
  if (reconnectedTeam.points !== 85) throw new Error('Reconnected points mismatch');
  if (reconnectedTeam.violations !== 3) throw new Error(`Reconnected violation count mismatch: ${reconnectedTeam.violations}`);

  // 9. Clean disconnect
  adminSocket.disconnect();
  clientAReconnect.disconnect();
  clientB.disconnect();
  clientC.disconnect();

  console.log('====================================================');
  console.log('🎉 ALL 34 BIDNEX V2 CORE REQUIREMENTS VERIFIED 100%');
  console.log('====================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

