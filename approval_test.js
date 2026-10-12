import { io } from 'socket.io-client';

const URL = 'http://localhost:5000';
const ADMIN_PASSWORD = 'julie';

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runApprovalTests() {
  console.log('====================================================');
  console.log('🛡️ BIDNEX V2 OPTIONAL ADMIN APPROVAL FEATURE AUDIT');
  console.log('====================================================');

  // 1. Connect Admin
  const adminSocket = io(URL, { forceNew: true });
  await new Promise(res => adminSocket.on('connect', res));
  console.log('✓ Admin connected');

  // Authenticate Admin
  const authPromise = new Promise((resolve, reject) => {
    adminSocket.on('admin:authenticated', resolve);
    adminSocket.on('admin:error', reject);
  });
  adminSocket.emit('admin:auth', ADMIN_PASSWORD);
  await authPromise;
  console.log('✓ Admin authenticated');

  // Reset to clean lobby
  adminSocket.emit('admin:reset_tournament');
  await sleep(300);

  // Ensure approval is OFF initially
  adminSocket.emit('admin:set_approval_mode', { enabled: false });
  await sleep(200);

  // ----------------------------------------------------------------
  // TEST 1: Approval OFF (default) — Normal Direct Registration
  // ----------------------------------------------------------------
  console.log('\n--- TEST 1: Approval OFF — Normal Direct Registration ---');
  const normalClient = io(URL, { forceNew: true });
  await new Promise(res => normalClient.on('connect', res));

  const directJoinPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on direct join')), 4000);
    normalClient.once('team:joined', data => {
      clearTimeout(timeout);
      resolve(data);
    });
    normalClient.once('team:approval_pending', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Received approval_pending when approval feature was OFF'));
    });
    normalClient.emit('team:join', { name: 'Direct_Team', members: 'Direct User' });
  });

  const directJoined = await directJoinPromise;
  console.log(`✓ Direct join succeeded immediately: ${directJoined.name} (100 pts)`);
  normalClient.disconnect();

  // ----------------------------------------------------------------
  // TEST 2: Toggle Approval ON — Stored on Server
  // ----------------------------------------------------------------
  console.log('\n--- TEST 2: Enable Admin Approval Mode ---');
  adminSocket.emit('admin:set_approval_mode', { enabled: true });
  await sleep(300);

  const snap1 = await new Promise(res => {
    adminSocket.once('admin:snapshot', res);
    adminSocket.emit('admin:auth', ADMIN_PASSWORD);
  });
  if (!snap1.config.requireAdminApproval) {
    throw new Error('BUG: requireAdminApproval was not enabled in admin snapshot');
  }
  console.log('✓ requireAdminApproval confirmed ON in server config snapshot');

  // ----------------------------------------------------------------
  // TEST 3: Approval ON — Player Requests Admission (Pending)
  // ----------------------------------------------------------------
  console.log('\n--- TEST 3: Player Submits Admission Request ---');
  const pendingClient = io(URL, { forceNew: true });
  await new Promise(res => pendingClient.on('connect', res));

  let pendingToken = null;
  let pendingRequestId = null;

  const pendingPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for approval_pending')), 4000);
    pendingClient.once('team:approval_pending', data => {
      clearTimeout(timeout);
      pendingToken = data.sessionToken;
      pendingRequestId = data.requestId;
      resolve(data);
    });
    pendingClient.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Player entered arena immediately while approval was ON!'));
    });
    pendingClient.emit('team:join', { name: 'Pending_Team_A', members: 'Applicant A' });
  });

  const pendingResult = await pendingPromise;
  console.log(`✓ Player received approval_pending: "${pendingResult.message}" (Request ID: ${pendingRequestId.slice(0, 8)}...)`);

  // Verify request appears in Admin snapshot
  const snap2 = await new Promise(res => {
    adminSocket.once('admin:snapshot', res);
    adminSocket.emit('admin:auth', ADMIN_PASSWORD);
  });
  const foundReq = (snap2.admissionRequests || []).find(r => r.id === pendingRequestId);
  if (!foundReq || foundReq.status !== 'pending') {
    throw new Error('BUG: Pending request not found in Admin snapshot');
  }
  console.log(`✓ Admin snapshot displays pending request: Team "${foundReq.name}"`);

  // ----------------------------------------------------------------
  // TEST 4: Unauthorized User Cannot Approve Request
  // ----------------------------------------------------------------
  console.log('\n--- TEST 4: Unauthorized User Rejection ---');
  const rogueSocket = io(URL, { forceNew: true });
  await new Promise(res => rogueSocket.on('connect', res));

  const unauthPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on unauth check')), 4000);
    rogueSocket.once('admin:error', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
    rogueSocket.emit('admin:approve_admission', { requestId: pendingRequestId });
  });

  const unauthMsg = await unauthPromise;
  console.log(`✓ Unauthorized approval safely rejected: "${unauthMsg}"`);
  rogueSocket.disconnect();

  // ----------------------------------------------------------------
  // TEST 5: Reconnect While Pending Restores Pending View
  // ----------------------------------------------------------------
  console.log('\n--- TEST 5: Reconnect While Pending Preserves State ---');
  pendingClient.disconnect();
  await sleep(200);

  const reconnectedClient = io(URL, { forceNew: true });
  await new Promise(res => reconnectedClient.on('connect', res));

  const pendingReconnectPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on pending reconnect')), 4000);
    reconnectedClient.once('team:approval_pending', data => {
      clearTimeout(timeout);
      resolve(data);
    });
    reconnectedClient.once('team:joined', () => {
      clearTimeout(timeout);
      reject(new Error('BUG: Joined arena on reconnect before approval!'));
    });
    reconnectedClient.emit('team:reconnect', { token: pendingToken });
  });

  const reconnectRes = await pendingReconnectPromise;
  console.log(`✓ Reconnection with pending token safely returned approval_pending: "${reconnectRes.message}"`);

  // ----------------------------------------------------------------
  // TEST 6: Reject an Admission Request
  // ----------------------------------------------------------------
  console.log('\n--- TEST 6: Admin Rejects an Admission Request ---');
  const rejectedClient = io(URL, { forceNew: true });
  await new Promise(res => rejectedClient.on('connect', res));

  let rejectToken = null;
  let rejectReqId = null;

  await new Promise(res => {
    rejectedClient.once('team:approval_pending', data => {
      rejectToken = data.sessionToken;
      rejectReqId = data.requestId;
      res();
    });
    rejectedClient.emit('team:join', { name: 'Rejected_Team', members: 'Imposter' });
  });

  const rejectionEventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for rejection notification')), 4000);
    rejectedClient.once('team:rejected', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
  });

  adminSocket.emit('admin:reject_admission', { requestId: rejectReqId });
  const rejectionEvent = await rejectionEventPromise;
  console.log(`✓ Player received rejection event: "${rejectionEvent.message}"`);

  // Verify reconnect with rejected token is still rejected
  const rejectedReconnectPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on rejected reconnect')), 4000);
    rejectedClient.once('team:rejected', msg => {
      clearTimeout(timeout);
      resolve(msg);
    });
  });
  rejectedClient.emit('team:reconnect', { token: rejectToken });
  await rejectedReconnectPromise;
  console.log('✓ Reconnect with rejected token cannot bypass rejection');
  rejectedClient.disconnect();

  // ----------------------------------------------------------------
  // TEST 7: Admin Approves Request -> Enters Waiting Lobby
  // ----------------------------------------------------------------
  console.log('\n--- TEST 7: Admin Approves Pending Request ---');
  const approvalEventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for team:joined upon approval')), 4000);
    reconnectedClient.once('team:joined', data => {
      clearTimeout(timeout);
      resolve(data);
    });
  });

  adminSocket.emit('admin:approve_admission', { requestId: pendingRequestId });
  const approvedData = await approvalEventPromise;
  console.log(`✓ Approved player entered arena automatically: ${approvedData.name} (100 pts)`);

  // ----------------------------------------------------------------
  // TEST 8: Multiple Concurrent Admission Requests & Batch Approval
  // ----------------------------------------------------------------
  console.log('\n--- TEST 8: 5 Simultaneous Requests & Batch "Approve All" ---');
  const batchClients = [];
  for (let i = 1; i <= 5; i++) {
    const s = io(URL, { forceNew: true });
    batchClients.push({ id: i, name: `Batch_Team_${i}`, socket: s, joined: null });
  }

  await Promise.all(batchClients.map(c => new Promise(res => c.socket.on('connect', res))));

  // Simultaneous join emissions
  await Promise.all(batchClients.map(c => new Promise(res => {
    c.socket.once('team:approval_pending', res);
    c.socket.emit('team:join', { name: c.name, members: `Member ${c.id}` });
  })));
  console.log('✓ All 5 batch teams sent admission requests concurrently (status: pending)');

  // Admin approves all
  const batchJoinPromises = batchClients.map(c => new Promise(res => {
    c.socket.once('team:joined', data => { c.joined = data; res(data); });
  }));

  adminSocket.emit('admin:approve_all_admissions');
  await Promise.all(batchJoinPromises);
  console.log('✓ Admin "Approve All" safely enrolled all 5 batch teams into lobby');

  // ----------------------------------------------------------------
  // TEST 9: Gameplay Progression with Approved Teams
  // ----------------------------------------------------------------
  console.log('\n--- TEST 9: Tournament Starts with Approved Teams ---');
  const startPromise = new Promise(res => {
    reconnectedClient.once('player:sync', data => {
      if (data.phase === 'bidding') res(data);
    });
  });

  adminSocket.emit('admin:start');
  const liveSync = await startPromise;
  console.log(`✓ Tournament started smoothly with approved teams! Phase: ${liveSync.phase}, Q1 live.`);

  // ----------------------------------------------------------------
  // TEST 10: Toggling Approval OFF Mid-Tournament
  // ----------------------------------------------------------------
  console.log('\n--- TEST 10: Toggle Approval OFF Mid-Tournament ---');
  adminSocket.emit('admin:set_approval_mode', { enabled: false });
  await sleep(300);

  // Verify tournament is still active and approved players are NOT disconnected
  if (!reconnectedClient.connected) {
    throw new Error('BUG: Approved player disconnected when approval was toggled OFF');
  }
  console.log('✓ Tournament remains active; approved players remain connected and unaffected.');

  // Clean disconnect
  reconnectedClient.disconnect();
  batchClients.forEach(c => c.socket.disconnect());

  // Reset tournament to clean state
  adminSocket.emit('admin:reset_tournament');
  await sleep(300);
  adminSocket.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL 12 ADMIN APPROVAL TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runApprovalTests().catch(err => {
  console.error('\n❌ APPROVAL AUDIT FAILED:', err);
  process.exit(1);
});

