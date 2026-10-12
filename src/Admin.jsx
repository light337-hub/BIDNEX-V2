import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const getSocketUrl = () => {
  const loc = window.location;
  if (loc.port === '5173' || loc.port === '4173') {
    return `${loc.protocol}//${loc.hostname}:5000`;
  }
  return loc.origin;
};

const socket = io(getSocketUrl(), {
  autoConnect: true,
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

export default function Admin() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('arena'); // arena, questions, rules, teams
  const [data, setData] = useState({
    phase: 'waiting',
    isPaused: false,
    rulesLocked: false,
    config: { bidChoices: [2, 4, 6, 9, 10, 13, 15], passPenalty: 5, biddingTime: 15, answerTime: 10 },
    question: null,
    questionNumber: 0,
    totalQuestions: 25,
    time: 0,
    totalTime: 0,
    teams: [],
    allQuestions: [],
    answerQueue: [],
    activeBidder: null,
    currentQuestionResult: null,
    results: []
  });

  const [notification, setNotification] = useState('');
  const [error, setError] = useState('');

  // Rules editor state
  const [bidChoicesInput, setBidChoicesInput] = useState('2, 4, 6, 9, 10, 13, 15');
  const [passPenaltyInput, setPassPenaltyInput] = useState('5');
  const [biddingTimeInput, setBiddingTimeInput] = useState('15');
  const [answerTimeInput, setAnswerTimeInput] = useState('10');

  // Question editing modal
  const [editingQuestion, setEditingQuestion] = useState(null);

  // Manual score adjustment modal
  const [scoreAdjustModal, setScoreAdjustModal] = useState(null); // { teamId, teamName, currentPoints }
  const [scoreAdjustmentDelta, setScoreAdjustmentDelta] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false); // show add-question form
  const [newQuestion, setNewQuestion] = useState({ question: '', options: ['', '', '', ''], answer: '', category: '', difficulty: 'easy', explanation: '' });
  const [livePenaltyInput, setLivePenaltyInput] = useState('');

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      setError('');
      const savedPass = sessionStorage.getItem('bidnex_admin_pass');
      if (savedPass) {
        socket.emit('admin:auth', savedPass);
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      setIsConnected(false);
      console.warn('Admin socket connection error:', err?.message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    if (socket.connected) {
      onConnect();
    }

    socket.on('admin:authenticated', () => {
      setAuthenticated(true);
      setError('');
    });

    socket.on('admin:error', (msg) => {
      setError(msg);
      if (String(msg).toLowerCase().includes('password') || String(msg).toLowerCase().includes('unauthorized')) {
        sessionStorage.removeItem('bidnex_admin_pass');
        setAuthenticated(false);
      }
      setTimeout(() => setError(''), 4000);
    });

    socket.on('admin:notification', (msg) => {
      setNotification(msg);
      setTimeout(() => setNotification(''), 4000);
    });

    socket.on('admin:snapshot', (snapshot) => {
      setData(snapshot);
      if (snapshot.config) {
        setBidChoicesInput(snapshot.config.bidChoices.join(', '));
        setPassPenaltyInput(String(snapshot.config.passPenalty));
        setBiddingTimeInput(String(snapshot.config.biddingTime));
        setAnswerTimeInput(String(snapshot.config.answerTime));
      }
    });

    socket.on('admin:timer', ({ time, totalTime, isPaused }) => {
      setData(prev => ({ ...prev, time, totalTime, isPaused: Boolean(isPaused) }));
    });

    socket.on('admin:violation_alert', ({ teamName, violationCount, isFinal }) => {
      const count = Math.min(3, Math.max(1, violationCount || 1));
      if (count >= 3 || isFinal) {
        setNotification(`🚨 FINAL VIOLATION 3/3: ${teamName} left page/tab — Admin action recommended`);
      } else {
        setNotification(`⚠️ VIOLATION: ${teamName} switched tabs/blurred (${count}/3 warnings)`);
      }
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('admin:authenticated');
      socket.off('admin:error');
      socket.off('admin:notification');
      socket.off('admin:snapshot');
      socket.off('admin:timer');
      socket.off('admin:violation_alert');
    };
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (!password) return;
    sessionStorage.setItem('bidnex_admin_pass', password);
    socket.emit('admin:auth', password);
  };

  const handleSaveRules = (e) => {
    e.preventDefault();
    const parsedChoices = bidChoicesInput
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n > 0);

    if (parsedChoices.length === 0) {
      setError('Please provide at least one valid bid number.');
      return;
    }

    socket.emit('admin:update_rules', {
      bidChoices: parsedChoices,
      passPenalty: Number(passPenaltyInput) || 5,
      biddingTime: Number(biddingTimeInput) || 15,
      answerTime: Number(answerTimeInput) || 10
    });
  };

  const handleSaveQuestion = (e) => {
    e.preventDefault();
    if (!editingQuestion) return;

    socket.emit('admin:update_question', {
      questionId: editingQuestion.id,
      updatedData: {
        question: editingQuestion.question,
        options: editingQuestion.options,
        answer: editingQuestion.answer,
        category: editingQuestion.category,
        difficulty: editingQuestion.difficulty,
        explanation: editingQuestion.explanation
      }
    });
    setEditingQuestion(null);
  };

  const handleMoveQuestion = (fromIdx, toIdx) => {
    socket.emit('admin:reorder_questions', { fromIndex: fromIdx, toIndex: toIdx });
  };

  const handleAdjustScoreSubmit = (e) => {
    e.preventDefault();
    if (!scoreAdjustModal) return;
    const delta = Number(scoreAdjustmentDelta);
    if (Number.isNaN(delta)) return;

    socket.emit('admin:adjust_score', {
      teamId: scoreAdjustModal.teamId,
      delta
    });
    setScoreAdjustModal(null);
    setScoreAdjustmentDelta('');
  };

  const handleAddQuestion = (e) => {
    e.preventDefault();
    const opts = newQuestion.options.filter(o => o.trim());
    if (opts.length < 2) return setError('Need at least 2 non-empty options.');
    if (!opts.includes(newQuestion.answer)) return setError('Correct answer must match one of the options.');
    socket.emit('admin:add_question', {
      question: newQuestion.question,
      options: opts,
      answer: newQuestion.answer,
      category: newQuestion.category || 'General',
      difficulty: newQuestion.difficulty || 'easy',
      explanation: newQuestion.explanation || ''
    });
    setAddingQuestion(false);
    setNewQuestion({ question: '', options: ['', '', '', ''], answer: '', category: '', difficulty: 'easy', explanation: '' });
  };

  const handleLivePenalty = (e) => {
    e.preventDefault();
    const v = Number(livePenaltyInput);
    if (!Number.isInteger(v) || v < 0) return setError('PASS penalty must be a non-negative integer.');
    socket.emit('admin:update_pass_penalty', { passPenalty: v });
    setLivePenaltyInput('');
  };

  // OPTIONAL FEATURE: Admission Approval Handlers
  const admissionRequests = data.admissionRequests || [];
  const pendingAdmissionCount = admissionRequests.filter(r => r.status === 'pending').length;
  const approvedAdmissionCount = admissionRequests.filter(r => r.status === 'approved').length;
  const rejectedAdmissionCount = admissionRequests.filter(r => r.status === 'rejected').length;
  const requireApproval = Boolean(data.config?.requireAdminApproval);

  const handleToggleApprovalMode = () => {
    socket.emit('admin:set_approval_mode', { enabled: !requireApproval });
  };

  const handleApproveAdmission = (requestId) => {
    socket.emit('admin:approve_admission', { requestId });
  };

  const handleRejectAdmission = (requestId) => {
    socket.emit('admin:reject_admission', { requestId });
  };

  const handleApproveAllAdmissions = () => {
    socket.emit('admin:approve_all_admissions');
  };

  const handleClearAdmissionHistory = () => {
    socket.emit('admin:clear_admission_history');
  };

  // Admin Login — Glassmorphism + Poster (matches player login)
  if (!authenticated) {
    return (
      <div className="login-arena">
        <div className="login-poster-bg" />
        <div className="login-poster-overlay" />
        <div className="login-glass-card">
          <div className="login-brand">COMMAND</div>
          <div className="login-subtitle">BIDNEX CONTROL ROOM AUTHORIZATION</div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="login-field">
              <label className="login-label">ENTER MASTER PASSWORD</label>
              <div className="login-pw-wrap">
                <input
                  className="login-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="login-pw-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <button type="submit" className="login-btn">
              ACCESS CONTROL CENTER <span className="login-btn-arrow">→</span>
            </button>
          </form>

          {error && <div className="login-error">{error}</div>}

          <div className="login-meta" style={{ justifyContent: 'center' }}>
            <span className="login-meta-item">
              <span className="login-meta-key">🛡️</span>
              <span className="login-meta-val green">ADMIN ACCESS ONLY</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const { phase, isPaused, rulesLocked, question, questionNumber, totalQuestions, time, totalTime, teams, allQuestions, answerQueue, activeBidder, currentQuestionResult } = data;
  const onlineTeams = teams.filter(t => t.online).length;
  const leader = teams[0];

  return (
    <div className="admin-shell">
      {/* Network Disconnection Notification */}
      {!isConnected && (
        <div className="global-disconnect-banner">
          <span>⚡</span> DISCONNECTED FROM SERVER — RECONNECTING...
        </div>
      )}

      {/* Pause Notification Banner */}
      {isPaused && (
        <div className="global-pause-banner" style={!isConnected ? { top: 42 } : {}}>
          <span>⏸</span> GAME FROZEN GLOBALLY — ALL PLAYER TIMERS AND INPUTS DISABLED
        </div>
      )}

      {/* Admin Header */}
      <header className="admin-header" style={(!isConnected && isPaused) ? { marginTop: 84 } : (!isConnected || isPaused) ? { marginTop: 42 } : {}}>
        <div className="admin-brand">
          <div className="admin-title">BIDNEX // MASTER</div>
          <span className="admin-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: isConnected ? '#052e16' : '#450a0a', color: isConnected ? '#4ade80' : '#f87171', border: isConnected ? '1px solid #166534' : '1px solid #991b1b' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? '#4ade80' : '#ef4444' }} />
            {isConnected ? 'ONLINE' : 'RECONNECTING'}
          </span>
          <span className="admin-tag">ROUND {Math.max(0, questionNumber)} / {totalQuestions}</span>
          <span className="admin-tag" style={{ background: phase === 'bidding' ? '#14351c' : phase === 'answering' ? '#3d2c0b' : '#1e293b' }}>
            {phase.toUpperCase()}
          </span>
        </div>

        {/* Global Controls */}
        <div className="admin-header-controls">
          {phase === 'waiting' && questionNumber === 0 && (
            <button className="admin-btn admin-btn-primary" onClick={() => socket.emit('admin:start')}>
              ▶ START TOURNAMENT
            </button>
          )}

          {/* 9. Global Pause / Resume */}
          {phase !== 'waiting' && phase !== 'finished' && (
            <>
              {isPaused ? (
                <button className="admin-btn admin-btn-resume" onClick={() => socket.emit('admin:resume')}>
                  ▶ RESUME GAME
                </button>
              ) : (
                <button className="admin-btn admin-btn-pause" onClick={() => socket.emit('admin:pause')}>
                  ⏸ PAUSE GAME
                </button>
              )}
            </>
          )}

          {phase === 'bidding' && (
            <button className="admin-btn admin-btn-secondary" onClick={() => socket.emit('admin:close_bidding_early')}>
              CLOSE BIDS NOW
            </button>
          )}

          <button className="admin-btn admin-btn-secondary" onClick={() => socket.emit('admin:next_question')} title="Force advance to next question">
            FORCE NEXT Q →
          </button>

          <button className="admin-btn admin-btn-secondary" onClick={() => socket.emit('admin:restart_current_question')} title="Restart current question from bidding">
            RESTART QUESTION
          </button>

          <button className="admin-btn admin-btn-danger" onClick={() => { if (window.confirm('WARNING: Resetting will clear all registered teams and force all players to register again. Current standings will be archived. Are you sure you want to reset the tournament?')) socket.emit('admin:reset_tournament'); }}>
            RESET TOURNAMENT
          </button>
        </div>
      </header>

      {/* Navigation sub-bar */}
      <div className="admin-subbar">
        <button className={`admin-nav-tab ${activeTab === 'arena' ? 'active' : ''}`} onClick={() => setActiveTab('arena')}>
          ARENA MONITOR
        </button>
        <button className={`admin-nav-tab ${activeTab === 'questions' ? 'active' : ''}`} onClick={() => setActiveTab('questions')}>
          QUESTION MANAGER ({allQuestions.length})
        </button>
        <button className={`admin-nav-tab ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
          RULES & BID CHOICES
        </button>
        <button className={`admin-nav-tab ${activeTab === 'teams' ? 'active' : ''}`} onClick={() => setActiveTab('teams')}>
          TEAMS & VIOLATIONS ({teams.length})
        </button>
        <button className={`admin-nav-tab ${activeTab === 'admissions' ? 'active' : ''}`} onClick={() => setActiveTab('admissions')}>
          ADMISSIONS {pendingAdmissionCount > 0 && <span className="admin-badge-count">{pendingAdmissionCount}</span>}
        </button>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 32px', fontSize: 13, fontWeight: 700, borderBottom: '1px solid #10b981' }}>
          ✓ {notification}
        </div>
      )}
      {error && (
        <div style={{ background: '#7f1d1d', color: '#fecdd3', padding: '10px 32px', fontSize: 13, fontWeight: 700, borderBottom: '1px solid #f43f5e' }}>
          ✕ {error}
        </div>
      )}

      {/* Main View Area */}
      <main className="admin-main-view">
        {/* Metric Cards Row */}
        <div className="admin-metrics-row">
          <div className="admin-metric-card">
            <div className="metric-label">CONNECTED TEAMS</div>
            <div className="metric-value">{onlineTeams} <span style={{ fontSize: 16, color: 'var(--text-sub)' }}>/ {teams.length}</span></div>
            <div className="metric-sub">{teams.length === 0 ? 'Waiting for sign-ups' : 'Live in competition'}</div>
          </div>

          <div className="admin-metric-card">
            <div className="metric-label">CURRENT LEADER</div>
            <div className="metric-value">{leader ? leader.name : '—'}</div>
            <div className="metric-sub">{leader ? `${leader.points} points` : 'No teams yet'}</div>
          </div>

          <div className="admin-metric-card">
            <div className="metric-label">EVENT PROGRESS</div>
            <div className="metric-value">Q{Math.max(0, questionNumber)} <span style={{ fontSize: 16, color: 'var(--text-sub)' }}>/ {totalQuestions}</span></div>
            <div className="metric-sub">Continuous tournament flow</div>
          </div>

          <div className="admin-metric-card">
            <div className="metric-label">ROUND TIMER</div>
            <div className="metric-value">{time}s</div>
            <div className="metric-sub">{phase === 'bidding' ? 'Bidding Window' : phase === 'answering' ? 'Answer Cascade' : 'Ready'}</div>
          </div>
        </div>

        {/* TAB 1: ARENA MONITOR */}
        {activeTab === 'arena' && (
          <div className="admin-grid-2col">
            <div>
              {/* Question overview */}
              <div className="control-panel-box">
                <div className="panel-header-row">
                  <div className="panel-title">LIVE QUESTION</div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Q{questionNumber} / {totalQuestions}</div>
                </div>

                {phase === 'finished' ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--neon-green)', marginBottom: 8 }}>
                      🏁 COMPETITION COMPLETED
                    </div>
                    <p style={{ color: 'var(--text-sub)', fontSize: 13, marginBottom: 18 }}>
                      Tournament concluded. Player screens are viewing the ending video finale & final standings.
                    </p>
                    <button
                      className="admin-btn admin-btn-danger"
                      style={{ padding: '10px 22px', fontSize: 13, margin: '0 auto' }}
                      onClick={() => {
                        if (window.confirm('WARNING: Resetting will clear all registered teams and force all players to register again. Current standings will be archived. Are you sure you want to reset the tournament?')) {
                          socket.emit('admin:reset_tournament');
                        }
                      }}
                    >
                      🔄 RESET TOURNAMENT FOR NEXT ROUND
                    </button>
                  </div>
                ) : question ? (
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 750, color: '#fff', marginBottom: 16, whiteSpace: 'pre-line' }}>{question.question}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                      {question.options?.map((opt, i) => (
                        <div key={opt} style={{ padding: '10px 14px', borderRadius: 10, background: opt === question.answer ? 'rgba(16,185,129,0.15)' : '#07160d', border: opt === question.answer ? '1px solid var(--neon-green)' : '1px solid #142e1a', color: opt === question.answer ? 'var(--neon-green)' : '#cbd5e1', fontSize: 13 }}>
                          <strong>{['A', 'B', 'C', 'D'][i]}:</strong> {opt} {opt === question.answer && '✓ (Correct)'}
                        </div>
                      ))}
                    </div>
                    {question.explanation && (
                      <div style={{ fontSize: 12, color: 'var(--text-sub)', background: '#050d07', padding: '10px 14px', borderRadius: 8 }}>
                        <strong>Explanation:</strong> {question.explanation}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-sub)' }}>
                    Tournament waiting to start. Click "START TOURNAMENT" above to launch Q1.
                  </div>
                )}
              </div>

              {/* Cascade Answer Queue */}
              <div className="control-panel-box">
                <div className="panel-header-row">
                  <div className="panel-title">BIDDING RANKING & CASCADE QUEUE</div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Highest Bidder First · Tie: Earliest Submission</span>
                </div>

                {answerQueue.length > 0 ? (
                  <div className="admin-table-container">
                    <table className="admin-data-table">
                      <thead>
                        <tr>
                          <th>RANK</th>
                          <th>TEAM</th>
                          <th>BID</th>
                          <th>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {answerQueue.map((item, idx) => {
                          const isCurrentActive = activeBidder && activeBidder.teamId === item.teamId;
                          return (
                            <tr key={item.teamId} style={isCurrentActive ? { background: 'rgba(0,255,136,0.08)' } : {}}>
                              <td style={{ fontWeight: 900, color: idx === 0 ? 'var(--gold)' : '#fff' }}>#{idx + 1}</td>
                              <td><strong>{item.teamName}</strong></td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--neon-green)' }}>{item.bid} pts</td>
                              <td>
                                {isCurrentActive ? (
                                  <span style={{ background: '#f59e0b', color: '#000', padding: '4px 8px', borderRadius: 6, fontWeight: 900, fontSize: 10 }}>ANSWERING NOW</span>
                                ) : (
                                  <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>In Queue</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 13 }}>
                    {phase === 'bidding' ? 'Waiting for teams to lock bids or pass...' : 'No active bids for this question.'}
                  </div>
                )}
              </div>
            </div>

            {/* Live Leaderboard */}
            <div>
              <div className="control-panel-box">
                <div className="panel-header-row">
                  <div className="panel-title">LIVE LEADERBOARD</div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Server Authoritative</span>
                </div>

                <div className="admin-table-container">
                  <table className="admin-data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>TEAM</th>
                        <th>SCORE</th>
                        <th>BID</th>
                        <th>VIOLATIONS</th>
                        <th>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map((t, idx) => (
                        <tr key={t.id}>
                          <td style={{ fontWeight: 900, color: idx === 0 ? 'var(--gold)' : idx === 1 ? 'var(--silver)' : idx === 2 ? 'var(--bronze)' : 'inherit' }}>
                            {idx + 1}
                          </td>
                          <td>
                            <strong>{t.name}</strong>
                            <div style={{ marginTop: 2 }}>
                              <span className={t.online ? 'status-badge-online' : 'status-badge-offline'}>
                                {t.online ? 'ONLINE' : 'OFFLINE'}
                              </span>
                              {t.disqualified && <span style={{ marginLeft: 6, background: 'var(--crimson)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 800 }}>DQ</span>}
                              {t.locked && <span style={{ marginLeft: 6, background: '#eab308', color: '#000', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 800 }}>LOCKED</span>}
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 900, color: 'var(--neon-green)' }}>
                            {t.points}
                          </td>
                          <td>
                            {t.passed ? <span style={{ color: '#fca5a5', fontWeight: 800 }}>PASS</span> : (t.bid !== null ? <span style={{ color: 'var(--neon-green)', fontWeight: 800 }}>{t.bid}</span> : '—')}
                          </td>
                          <td>
                            <span className={`violation-pill ${t.violations === 0 ? 'clean' : t.violations >= 3 ? 'danger' : 'warn'}`}>
                              {t.violations >= 3 ? '3/3 Final Violation' : `${t.violations}/3`}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => { setScoreAdjustModal({ teamId: t.id, teamName: t.name, currentPoints: t.points }); setScoreAdjustmentDelta(''); }}
                              style={{ padding: '4px 8px', borderRadius: 6, background: '#13351d', border: '1px solid #1c4524', color: '#a7f3d0', fontSize: 11, cursor: 'pointer' }}
                            >
                              ADJUST
                            </button>
                          </td>
                        </tr>
                      ))}
                      {teams.length === 0 && (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-sub)' }}>
                            No teams have registered yet. Share the participant link with contestants.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: QUESTION MANAGER (Dynamic) */}
        {activeTab === 'questions' && (
          <div className="control-panel-box">
            <div className="panel-header-row">
              <div>
                <div className="panel-title">QUESTION MANAGER — {allQuestions.length} QUESTIONS</div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>
                  {rulesLocked ? 'Tournament running. Completed & current questions locked. Upcoming questions and additions are allowed.' : 'Add, edit, delete, or reorder questions freely before the tournament starts.'}
                </div>
              </div>
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => { setAddingQuestion(true); setNewQuestion({ question: '', options: ['', '', '', ''], answer: '', category: '', difficulty: 'easy', explanation: '' }); }}
                style={{ flexShrink: 0 }}
              >
                + ADD QUESTION
              </button>
            </div>

            <div className="qm-list">
              {allQuestions.map((q, idx) => {
                const canEdit = !rulesLocked || q.isUpcoming;
                const canDelete = !rulesLocked || (rulesLocked && q.isUpcoming);
                return (
                  <div key={q.id} className={`qm-item ${q.isCurrent ? 'active' : ''} ${q.isCompleted ? 'completed' : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                      <div className="qm-order-controls">
                        <button
                          className="qm-order-btn"
                          disabled={!canEdit || idx === 0 || (rulesLocked && idx - 1 <= questionNumber - 1)}
                          onClick={() => handleMoveQuestion(idx, idx - 1)}
                        >
                          ▲
                        </button>
                        <button
                          className="qm-order-btn"
                          disabled={!canEdit || idx === allQuestions.length - 1}
                          onClick={() => handleMoveQuestion(idx, idx + 1)}
                        >
                          ▼
                        </button>
                      </div>

                      <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0e2415', border: '1px solid #16361d', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, color: 'var(--neon-green)' }}>
                        Q{idx + 1}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{q.question}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>
                          Category: <strong>{q.category}</strong> · Difficulty: <strong>{q.difficulty}</strong> · Correct: <strong style={{ color: 'var(--neon-green)' }}>{q.answer}</strong>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                      <button
                        className="admin-btn admin-btn-secondary"
                        disabled={!canEdit}
                        onClick={() => setEditingQuestion({ ...q, options: [...q.options] })}
                      >
                        {canEdit ? 'EDIT' : 'LOCKED'}
                      </button>
                      <button
                        className="admin-btn admin-btn-danger"
                        disabled={!canDelete}
                        onClick={() => {
                          if (window.confirm(`Delete Q${idx + 1}?\n"${q.question.substring(0, 80)}..."?\n\nThis cannot be undone.`)) {
                            socket.emit('admin:delete_question', { questionId: q.id });
                          }
                        }}
                        style={{ padding: '8px 12px', fontSize: 11 }}
                        title={canDelete ? 'Delete this question' : 'Cannot delete current/past questions'}
                      >
                        DEL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: RULES & CONFIGURATION */}
        {activeTab === 'rules' && (
          <div className="control-panel-box" style={{ maxWidth: 700 }}>
            <div className="panel-header-row">
              <div>
                <div className="panel-title">COMPETITION RULES & BID OPTIONS</div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>
                  Configure values before the competition starts. Locked once Q1 begins.
                </div>
              </div>
              {rulesLocked && (
                <span style={{ background: '#7f1d1d', color: '#fecdd3', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>
                  LOCKED
                </span>
              )}
            </div>

            {/* LIVE PASS PENALTY CONTROL — works even during active tournament */}
            <div style={{ background: '#071410', border: '1px solid rgba(0,255,136,0.2)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#a7f3d0', marginBottom: 6, letterSpacing: '0.08em' }}>
                ⚡ LIVE PASS PENALTY CONTROL
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 14 }}>
                {rulesLocked
                  ? <>Active penalty: <strong style={{ color: 'var(--neon-green)' }}>−{data.config?.passPenalty ?? 5} pts</strong>
                    {data.config?.pendingPassPenalty !== null && data.config?.pendingPassPenalty !== undefined
                      ? <> · <span style={{ color: '#fbbf24' }}>Pending next question: −{data.config.pendingPassPenalty} pts</span></>
                      : null}
                    <br />Setting a new value queues it for the <em>next question</em> — the current question is unaffected.</>
                  : <>Set the PASS penalty. Applies immediately before the tournament starts.</>
                }
              </div>
              <form onSubmit={handleLivePenalty} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="number"
                  value={livePenaltyInput}
                  onChange={(e) => setLivePenaltyInput(e.target.value)}
                  placeholder={String(data.config?.passPenalty ?? 5)}
                  min="0"
                  style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,255,136,0.25)', background: '#050d07', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 15, width: 100, outline: 'none' }}
                />
                <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>pts deducted on PASS</span>
                <button type="submit" className="admin-btn admin-btn-primary" style={{ marginLeft: 'auto' }}>
                  {rulesLocked ? 'SCHEDULE PENALTY' : 'APPLY PENALTY'}
                </button>
              </form>
            </div>

            {/* OPTIONAL FEATURE: Admission Approval Toggle */}
            <div style={{ background: '#071410', border: '1px solid rgba(0,255,136,0.2)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#a7f3d0', letterSpacing: '0.08em' }}>
                    🛡️ REQUIRE ADMIN APPROVAL FOR PLAYER ADMISSION
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>
                    When enabled, player registrations enter a pending queue until approved by an administrator.
                  </div>
                </div>
                <button
                  type="button"
                  className={`admin-btn ${requireApproval ? 'admin-btn-resume' : 'admin-btn-secondary'}`}
                  style={{ minWidth: 130, textAlign: 'center' }}
                  onClick={handleToggleApprovalMode}
                >
                  {requireApproval ? 'ON (ACTIVE)' : 'OFF (DISABLED)'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveRules}>
              <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 14, fontStyle: 'italic' }}>
                The fields below are locked once the tournament starts. Use the panel above to change PASS penalty mid-game.
              </div>
              <div className="form-field">
                <label>AVAILABLE BID BUTTON VALUES (Comma-separated)</label>
                <input
                  type="text"
                  value={bidChoicesInput}
                  disabled={rulesLocked}
                  onChange={(e) => setBidChoicesInput(e.target.value)}
                  placeholder="2, 4, 6, 9, 10, 13, 15"
                />
                <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                  Players will only see these tactile buttons. Example: "5, 10, 15, 20"
                </div>
              </div>

              <div className="form-field">
                <label>BIDDING TIMER (Seconds)</label>
                <input
                  type="number"
                  value={biddingTimeInput}
                  disabled={rulesLocked}
                  onChange={(e) => setBiddingTimeInput(e.target.value)}
                  placeholder="15"
                  min="5"
                />
              </div>

              <div className="form-field">
                <label>ANSWER TIMER PER BIDDER (Seconds)</label>
                <input
                  type="number"
                  value={answerTimeInput}
                  disabled={rulesLocked}
                  onChange={(e) => setAnswerTimeInput(e.target.value)}
                  placeholder="10"
                  min="3"
                />
              </div>

              <button type="submit" className="admin-btn admin-btn-primary" disabled={rulesLocked} style={{ marginTop: 14 }}>
                UPDATE & SAVE PRE-TOURNAMENT RULES
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: TEAMS & VIOLATIONS */}
        {activeTab === 'teams' && (
          <div className="control-panel-box">
            <div className="panel-header-row">
              <div className="panel-title">TEAM ROSTER & ANTI-CHEAT VIOLATION MANAGEMENT</div>
              <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                Page blur / Tab leaving tracking (1/3, 2/3, 3/3 warnings)
              </div>
            </div>

            <div className="admin-table-container">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>TEAM NAME</th>
                    <th>STATUS</th>
                    <th>SCORE</th>
                    <th>VIOLATIONS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(t => (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong></td>
                      <td>
                        <span className={t.online ? 'status-badge-online' : 'status-badge-offline'}>
                          {t.online ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16 }}>{t.points} pts</td>
                      <td>
                        <span className={`violation-pill ${t.violations === 0 ? 'clean' : t.violations >= 3 ? 'danger' : 'warn'}`}>
                          {t.violations >= 3 ? '3/3 Final Violation' : `${t.violations}/3 Warnings`}
                        </span>
                      </td>
                      <td style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="admin-btn admin-btn-secondary"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          onClick={() => socket.emit('admin:toggle_lock_team', { teamId: t.id })}
                        >
                          {t.locked ? 'UNLOCK' : 'LOCK'}
                        </button>
                        <button
                          className="admin-btn admin-btn-danger"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          onClick={() => { if (window.confirm(`Disqualify team ${t.name}?`)) socket.emit('admin:disqualify_team', { teamId: t.id }); }}
                        >
                          DISQUALIFY
                        </button>
                        <button
                          className="admin-btn admin-btn-secondary"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          onClick={() => socket.emit('admin:clear_violations', { teamId: t.id })}
                        >
                          CLEAR WARN
                        </button>
                        <button
                          className="admin-btn admin-btn-danger"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          onClick={() => { if (window.confirm(`Kick ${t.name} from competition?`)) socket.emit('admin:kick_team', { teamId: t.id }); }}
                        >
                          KICK
                        </button>
                      </td>
                    </tr>
                  ))}
                  {teams.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-sub)' }}>
                        No teams registered.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* OPTIONAL FEATURE: Admissions Management Tab */}
        {activeTab === 'admissions' && (
          <div className="control-panel-box admissions-panel">
            <div className="panel-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <div className="panel-title" style={{ fontSize: 16 }}>PLAYER ADMISSION APPROVAL</div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>
                  Review, approve, or reject participant team access requests in real-time.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`admin-btn ${requireApproval ? 'admin-btn-resume' : 'admin-btn-secondary'}`}
                  style={{ minWidth: 160 }}
                  onClick={handleToggleApprovalMode}
                >
                  REQUIRE APPROVAL: <strong>{requireApproval ? 'ON' : 'OFF'}</strong>
                </button>
                {pendingAdmissionCount > 0 && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    onClick={handleApproveAllAdmissions}
                  >
                    ✓ APPROVE ALL ({pendingAdmissionCount})
                  </button>
                )}
                {(approvedAdmissionCount > 0 || rejectedAdmissionCount > 0) && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={handleClearAdmissionHistory}
                  >
                    CLEAR HISTORY
                  </button>
                )}
              </div>
            </div>

            {/* Status Summary Cards */}
            <div className="admissions-summary-grid">
              <div className="admissions-card pending">
                <div className="admissions-card-header">
                  <span className="admissions-card-dot pending" />
                  <span className="admissions-card-title">PENDING APPROVAL</span>
                </div>
                <div className="admissions-card-value">{pendingAdmissionCount}</div>
                <div className="admissions-card-sub">Waiting for decision</div>
              </div>

              <div className="admissions-card approved">
                <div className="admissions-card-header">
                  <span className="admissions-card-dot approved" />
                  <span className="admissions-card-title">APPROVED TEAMS</span>
                </div>
                <div className="admissions-card-value">{approvedAdmissionCount}</div>
                <div className="admissions-card-sub">Admitted to competition</div>
              </div>

              <div className="admissions-card rejected">
                <div className="admissions-card-header">
                  <span className="admissions-card-dot rejected" />
                  <span className="admissions-card-title">REJECTED REQUESTS</span>
                </div>
                <div className="admissions-card-value">{rejectedAdmissionCount}</div>
                <div className="admissions-card-sub">Access declined</div>
              </div>
            </div>

            {/* Admission Requests Table */}
            <div className="admin-table-container">
              <table className="admin-data-table admissions-data-table">
                <thead>
                  <tr>
                    <th style={{ width: '25%', minWidth: 170 }}>TEAM NAME</th>
                    <th style={{ width: '27%', minWidth: 180 }}>NAME / MEMBERS</th>
                    <th style={{ width: '18%', minWidth: 130 }}>REQUEST TIME</th>
                    <th style={{ width: '14%', minWidth: 120 }}>STATUS</th>
                    <th style={{ width: '16%', minWidth: 160, textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {admissionRequests.map((req) => (
                    <tr key={req.id}>
                      <td style={{ verticalAlign: 'middle' }}>
                        <strong style={{ color: '#ffffff', fontSize: 14, letterSpacing: '0.02em', display: 'block' }}>
                          {req.name}
                        </strong>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span style={{ color: '#94a3b8', fontSize: 13, wordBreak: 'break-word', display: 'block' }}>
                          {req.members || '—'}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span style={{ color: 'var(--text-sub)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                          {req.requestedAt ? new Date(req.requestedAt).toLocaleTimeString() : '—'}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span className={`admissions-status-pill status-${req.status}`}>
                          <span className={`status-indicator-dot ${req.status}`} />
                          {req.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                        {req.status === 'pending' ? (
                          <div style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              className="admin-btn admin-btn-primary"
                              style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800 }}
                              onClick={() => handleApproveAdmission(req.id)}
                            >
                              ✓ APPROVE
                            </button>
                            <button
                              className="admin-btn admin-btn-danger"
                              style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800 }}
                              onClick={() => handleRejectAdmission(req.id)}
                            >
                              ✕ REJECT
                            </button>
                          </div>
                        ) : req.status === 'approved' ? (
                          <span className="admissions-action-approved">
                            APPROVED ✓
                          </span>
                        ) : (
                          <span className="admissions-action-rejected">
                            REJECTED ✕
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {admissionRequests.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-sub)', fontSize: 13 }}>
                        No admission requests recorded. When players register with Admin Approval ON, requests will appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add Question Modal */}
      {addingQuestion && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-title">ADD NEW QUESTION (Q{allQuestions.length + 1})</div>
            <form onSubmit={handleAddQuestion}>
              <div className="form-field">
                <label>QUESTION PROMPT</label>
                <textarea
                  value={newQuestion.question}
                  onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                  placeholder="Type the question here..."
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-field">
                  <label>CATEGORY</label>
                  <input
                    type="text"
                    value={newQuestion.category}
                    onChange={(e) => setNewQuestion({ ...newQuestion, category: e.target.value })}
                    placeholder="e.g. Networking"
                  />
                </div>
                <div className="form-field">
                  <label>DIFFICULTY</label>
                  <select
                    value={newQuestion.difficulty}
                    onChange={(e) => setNewQuestion({ ...newQuestion, difficulty: e.target.value })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                OPTIONS (A, B, C, D) — at least 2 required
              </label>
              {newQuestion.options.map((opt, i) => (
                <div key={i} className="form-field" style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    value={opt}
                    placeholder={`Option ${['A','B','C','D'][i]}`}
                    onChange={(e) => {
                      const updated = [...newQuestion.options];
                      updated[i] = e.target.value;
                      setNewQuestion({ ...newQuestion, options: updated });
                    }}
                  />
                </div>
              ))}

              <div className="form-field">
                <label>CORRECT ANSWER</label>
                <select
                  value={newQuestion.answer}
                  onChange={(e) => setNewQuestion({ ...newQuestion, answer: e.target.value })}
                  required
                >
                  <option value="">-- Select correct answer --</option>
                  {newQuestion.options.filter(o => o.trim()).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>EXPLANATION (REVEALED AT RESOLUTION)</label>
                <textarea
                  value={newQuestion.explanation}
                  onChange={(e) => setNewQuestion({ ...newQuestion, explanation: e.target.value })}
                  placeholder="Optional explanation shown after answer..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setAddingQuestion(false)}>
                  CANCEL
                </button>
                <button type="submit" className="admin-btn admin-btn-primary">
                  ADD QUESTION
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestion && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-title">EDIT QUESTION #{editingQuestion.id}</div>
            <form onSubmit={handleSaveQuestion}>
              <div className="form-field">
                <label>QUESTION PROMPT</label>
                <textarea
                  value={editingQuestion.question}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, question: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-field">
                  <label>CATEGORY</label>
                  <input
                    type="text"
                    value={editingQuestion.category}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, category: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label>DIFFICULTY</label>
                  <select
                    value={editingQuestion.difficulty}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, difficulty: e.target.value })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                OPTIONS (A, B, C, D)
              </label>
              {editingQuestion.options.map((opt, i) => (
                <div key={i} className="form-field" style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const updated = [...editingQuestion.options];
                      updated[i] = e.target.value;
                      setEditingQuestion({ ...editingQuestion, options: updated });
                    }}
                    required
                  />
                </div>
              ))}

              <div className="form-field">
                <label>CORRECT ANSWER</label>
                <select
                  value={editingQuestion.answer}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, answer: e.target.value })}
                >
                  {editingQuestion.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>EXPLANATION (REVEALED AT RESOLUTION)</label>
                <textarea
                  value={editingQuestion.explanation || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, explanation: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditingQuestion(null)}>
                  CANCEL
                </button>
                <button type="submit" className="admin-btn admin-btn-primary">
                  SAVE QUESTION
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Score Adjustment Modal */}
      {scoreAdjustModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-title">ADJUST SCORE: {scoreAdjustModal.teamName}</div>
            <div style={{ fontSize: 14, color: 'var(--text-sub)', marginBottom: 16 }}>
              Current Points: <strong style={{ color: 'var(--neon-green)' }}>{scoreAdjustModal.currentPoints}</strong>
            </div>
            <form onSubmit={handleAdjustScoreSubmit}>
              <div className="form-field">
                <label>POINT DELTA (+/-)</label>
                <input
                  type="number"
                  placeholder="e.g. 10 or -15"
                  value={scoreAdjustmentDelta}
                  onChange={(e) => setScoreAdjustmentDelta(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setScoreAdjustModal(null)}>
                  CANCEL
                </button>
                <button type="submit" className="admin-btn admin-btn-primary">
                  APPLY ADJUSTMENT
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
