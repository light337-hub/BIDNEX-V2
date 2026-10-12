import { io } from 'socket.io-client';

const URL = 'http://localhost:5000';

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runMultiComputerAudit() {
  console.log('====================================================');
  console.log('🧪 BIDNEX V2 MULTI-COMPUTER PRODUCTION RELIABILITY AUDIT');
  console.log('====================================================');

  // 1. Connect Admin Socket
  const adminSocket = io(URL, { transports: ['websocket', 'polling'] });
  await new Promise(res => adminSocket.on('connect', res));
  console.log('✓ Admin connected to server');

  // Authenticate Admin
  const authPromise = new Promise((resolve, reject) => {
    adminSocket.on('admin:authenticated', resolve);
    adminSocket.on('admin:error', reject);
  });
  adminSocket.emit('admin:auth', 'julie');
  await authPromise;
  console.log('✓ Admin authenticated successfully');

  // Reset to clean lobby
  adminSocket.emit('admin:reset_tournament');
  await sleep(400);

  // ================================================================
  // TEST SCENARIO 1: 13 CONCURRENT INDEPENDENT CLIENT CONNECTIONS
  // ================================================================
  console.log('\n--- TEST SCENARIO 1: 13 SIMULTANEOUS LAB COMPUTERS JOINING ---');
  const numComputers = 13;
  const clients = [];
  const teamTokens = new Map(); // teamName -> sessionToken

  for (let i = 1; i <= numComputers; i++) {
    const socket = io(URL, { transports: ['websocket', 'polling'], forceNew: true });
    clients.push({ id: i, name: `Lab_PC_${i.toString().padStart(2, '0')}`, socket, token: null, sync: null });
  }

  // Wait for all 13 sockets to connect
  await Promise.all(clients.map(c => new Promise(res => {
    if (c.socket.connected) res();
    else c.socket.once('connect', res);
  })));
  console.log(`✓ All ${numComputers} independent client sockets connected`);

  // Set up listeners for each client
  clients.forEach(c => {
    c.socket.on('player:sync', data => { c.sync = data; });
    c.socket.on('team:joined', data => { c.token = data.sessionToken; teamTokens.set(c.name, data.sessionToken); });
  });

  // Simultaneous Join Emission
  console.log(`Simultaneously registering ${numComputers} teams...`);
  const joinPromises = clients.map(c => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout joining ${c.name}`)), 5000);
    c.socket.once('team:joined', data => {
      clearTimeout(timeout);
      resolve(data);
    });
    c.socket.once('team:error', err => {
      clearTimeout(timeout);
      reject(new Error(`Join error for ${c.name}: ${err}`));
    });
    c.socket.emit('team:join', { name: c.name, members: `Student_${c.id}` });
  }));

  const joinedResults = await Promise.all(joinPromises);
  console.log(`✓ All ${joinedResults.length} teams registered successfully`);

  // Verify all 13 have score 100 and phase 'waiting'
  await sleep(300);
  for (const c of clients) {
    if (!c.sync) throw new Error(`Client ${c.name} received no sync data`);
    if (c.sync.phase !== 'waiting') throw new Error(`Client ${c.name} phase is "${c.sync.phase}", expected "waiting"`);
    if (!c.sync.team || c.sync.team.points !== 100) throw new Error(`Client ${c.name} starting score is ${c.sync.team?.points}, expected 100`);
    if (!c.token) throw new Error(`Client ${c.name} missing sessionToken`);
  }
  console.log('✓ 100% of computers confirmed in Lobby (phase: waiting, points: 100)');

  // ================================================================
  // TEST SCENARIO 2: TEMPORARY NETWORK LOSS & RECONNECT ON 3 COMPUTERS
  // ================================================================
  console.log('\n--- TEST SCENARIO 2: ABRUPT DISCONNECT & RECOVERY ON COMPUTERS 3, 7, 11 ---');
  const disconnectTargets = [clients[2], clients[6], clients[10]]; // PC 3, 7, 11

  // Disconnect sockets abruptly
  for (const target of disconnectTargets) {
    target.socket.disconnect();
  }
  console.log(`Disconnected sockets for: ${disconnectTargets.map(t => t.name).join(', ')}`);
  await sleep(400);

  // Check admin snapshot reflects offline status
  const snapAfterDrop = await new Promise(res => {
    adminSocket.once('admin:snapshot', res);
    adminSocket.emit('admin:auth', 'julie');
  });
  const offlineCount = snapAfterDrop.teams.filter(t => !t.online).length;
  console.log(`✓ Admin snapshot reports ${offlineCount} offline teams`);

  // Reconnect with new sockets using stored sessionToken (simulating browser reload / wifi return)
  console.log('Simulating wifi recovery / browser reload with session tokens...');
  for (const target of disconnectTargets) {
    const newSocket = io(URL, { transports: ['websocket', 'polling'], forceNew: true });
    target.socket = newSocket;
    target.sync = null;

    newSocket.on('player:sync', data => { target.sync = data; });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Reconnect timeout for ${target.name}`)), 5000);
      newSocket.on('connect', () => {
        newSocket.emit('team:reconnect', { token: target.token });
      });
      newSocket.on('team:joined', data => {
        clearTimeout(timeout);
        resolve(data);
      });
      newSocket.on('team:error', err => {
        clearTimeout(timeout);
        reject(new Error(`Reconnect error for ${target.name}: ${err}`));
      });
    });
  }
  await sleep(300);

  // Verify reconnected teams got full state and points preserved
  for (const target of disconnectTargets) {
    if (!target.sync) throw new Error(`Reconnected ${target.name} did not receive player:sync`);
    if (target.sync.phase !== 'waiting') throw new Error(`Reconnected ${target.name} wrong phase: ${target.sync.phase}`);
    if (target.sync.team.points !== 100) throw new Error(`Reconnected ${target.name} points altered: ${target.sync.team.points}`);
  }
  console.log('✓ All 3 dropped computers reconnected seamlessly with state and 100 pts preserved');

  // ================================================================
  // TEST SCENARIO 2B: STALE TOKEN & DUPLICATE DEVICE ATTACK MITIGATION
  // ================================================================
  console.log('\n--- TEST SCENARIO 2B: STALE TOKEN & DUPLICATE DEVICE PROTECTION ---');
  const rogueSocket = io(URL, { transports: ['websocket', 'polling'], forceNew: true });
  await new Promise(res => rogueSocket.on('connect', res));

  // Test stale/invalid token
  const staleTokenPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on stale token')), 4000);
    rogueSocket.once('team:session_expired', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
    rogueSocket.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Accepted invalid session token'));
    });
  });
  rogueSocket.emit('team:reconnect', { token: 'invalid-stale-token-uuid-99999' });
  const expiredMsg = await staleTokenPromise;
  console.log(`✓ Stale token safely rejected with session_expired: "${expiredMsg}"`);

  // Test duplicate device attempting to hijack active team Lab_PC_01
  const duplicateDevicePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on duplicate join')), 4000);
    rogueSocket.once('team:error', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
    rogueSocket.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Allowed duplicate device to hijack active team!'));
    });
  });
  rogueSocket.emit('team:join', { name: 'Lab_PC_01', members: 'Imposter' });
  const duplicateError = await duplicateDevicePromise;
  console.log(`✓ Duplicate device hijack blocked: "${duplicateError}"`);
  rogueSocket.disconnect();

  // ================================================================
  // TEST SCENARIO 3: ENDING TOURNAMENT & VERIFYING RESET SYNCHRONIZATION
  // ================================================================
  console.log('\n--- TEST SCENARIO 3: ENDING TOURNAMENT, ARCHIVING & RESET SYNCHRONIZATION ---');
  // End tournament to trigger finished state
  const finishPromises = clients.map(c => new Promise(res => c.socket.once('event:finished', res)));
  adminSocket.emit('admin:end_tournament');
  await Promise.all(finishPromises);
  await sleep(300);

  for (const c of clients) {
    if (c.sync.phase !== 'finished') throw new Error(`Client ${c.name} did not enter finished phase`);
  }
  console.log('✓ All 13 computers successfully received tournament finish notification');

  // Verify tournament results were archived properly
  const archiveRes = await fetch('http://localhost:5000/api/standings/last');
  const archiveData = await archiveRes.json();
  if (!archiveData.lastCompletedTournament || !Array.isArray(archiveData.lastCompletedTournament.standings)) {
    throw new Error('Tournament archive record not found or invalid');
  }
  if (archiveData.lastCompletedTournament.standings.length < 13) {
    throw new Error(`Archived standings incomplete: expected 13 teams, found ${archiveData.lastCompletedTournament.standings.length}`);
  }
  console.log(`✓ Completed tournament standings verified in persistent archive (${archiveData.lastCompletedTournament.standings.length} teams preserved)`);

  // Now, test joining while tournament is finished (Scenario 1 root cause check)
  console.log('\nVerifying new connection behavior during finished tournament...');
  const lateClient = io(URL, { transports: ['websocket', 'polling'], forceNew: true });
  await new Promise(res => lateClient.on('connect', res));

  const lateJoinError = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on late join')), 4000);
    lateClient.once('team:error', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
    lateClient.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Newly joined team was accepted into a finished tournament!'));
    });
    lateClient.emit('team:join', { name: 'Late_Team_99', members: 'Late Member' });
  });
  console.log(`✓ Safe protection confirmed: Late join rejected with "${lateJoinError}"`);

  // Admin resets tournament: Clears all registered teams and forces fresh login
  console.log('\nAdmin triggering reset_tournament...');
  const resetPromises = clients.map(c => new Promise(res => {
    c.socket.once('event:reset', res);
  }));

  adminSocket.emit('admin:reset_tournament');
  const resetEvents = await Promise.all(resetPromises);
  await sleep(300);

  console.log(`✓ All 13 computers received event:reset with message: "${resetEvents[0]?.message}"`);

  // Verify Admin snapshot reflects 0 registered teams
  const resetSnap = await new Promise(res => {
    adminSocket.once('admin:snapshot', res);
    adminSocket.emit('admin:auth', 'julie');
  });
  if (resetSnap.teams.length !== 0) {
    throw new Error(`Admin snapshot teams not empty after reset: expected 0, found ${resetSnap.teams.length}`);
  }
  if (resetSnap.phase !== 'waiting') {
    throw new Error(`Admin snapshot phase is "${resetSnap.phase}", expected "waiting"`);
  }
  if (resetSnap.finishedAt !== null) {
    throw new Error(`Admin snapshot finishedAt is not null: ${resetSnap.finishedAt}`);
  }
  console.log('✓ Admin snapshot immediately reflects 0 registered teams, empty roster, phase: waiting');

  // Verify old session tokens are invalidated and cannot restore old teams
  console.log('\nVerifying old session tokens are rejected...');
  const staleToken = teamTokens.get('Lab_PC_01');
  const staleClient = io(URL, { transports: ['websocket', 'polling'], forceNew: true });
  await new Promise(res => staleClient.on('connect', res));
  const expiredPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on stale reconnect')), 4000);
    staleClient.once('team:session_expired', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
    staleClient.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Stale session token restored team after reset!'));
    });
    staleClient.emit('team:reconnect', { token: staleToken });
  });
  const postResetExpiredMsg = await expiredPromise;
  staleClient.disconnect();
  console.log(`✓ Stale token rejected correctly with: "${postResetExpiredMsg}"`);

  // Now verify that a fresh team registration cleanly succeeds with 100 points
  console.log('\nVerifying fresh registration in clean lobby...');
  const lateJoinSuccess = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on fresh join after reset')), 4000);
    lateClient.once('team:joined', data => {
      clearTimeout(timeout);
      resolve(data);
    });
    lateClient.once('team:error', msg => {
      clearTimeout(timeout);
      reject(new Error(`Failed fresh join after reset: ${msg}`));
    });
    lateClient.emit('team:join', { name: 'Fresh_Team_01', members: 'Fresh Member' });
  });
  if (lateJoinSuccess.points !== 100) {
    throw new Error(`Expected fresh team to start at 100 points, got ${lateJoinSuccess.points}`);
  }
  console.log(`✓ Fresh_Team_01 registered cleanly in new waiting lobby (Points: ${lateJoinSuccess.points}, Session Token: ${lateJoinSuccess.sessionToken?.slice(0, 8)}...)`);

  // ================================================================
  // TEST SCENARIO 4: CACHE HEADERS AUDIT
  // ================================================================
  console.log('\n--- TEST SCENARIO 4: VERIFYING HTTP CACHE-CONTROL HEADERS ---');
  const indexRes = await fetch('http://localhost:5000/');
  const cacheControl = indexRes.headers.get('cache-control');
  console.log(`✓ GET / Cache-Control: "${cacheControl}"`);
  if (!cacheControl || !cacheControl.includes('no-cache')) {
    throw new Error(`Expected no-cache header on index.html, got: ${cacheControl}`);
  }

  // ================================================================
  // CLEAN DISCONNECT
  // ================================================================
  lateClient.disconnect();
  for (const c of clients) {
    c.socket.disconnect();
  }
  adminSocket.disconnect();

  console.log('\n====================================================');
  console.log('🎉 MULTI-COMPUTER PRODUCTION AUDIT PASSED 100%');
  console.log('   13 Simultaneous Connections:     ✅ VERIFIED');
  console.log('   Abrupt Disconnect & Recovery:     ✅ VERIFIED');
  console.log('   Finished State Protection:        ✅ VERIFIED');
  console.log('   Synchronized Admin Reset:         ✅ VERIFIED');
  console.log('   No-Cache SPA Headers:             ✅ VERIFIED');
  console.log('====================================================\n');
}

runMultiComputerAudit().catch(err => {
  console.error('\n❌ MULTI-COMPUTER AUDIT FAILED:', err);
  process.exit(1);
});

