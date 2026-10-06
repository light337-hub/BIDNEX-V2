import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const getSocketUrl = () => {
  const loc = window.location;
  if (loc.port === '5173' || loc.port === '4173') {
    return `${loc.protocol}//${loc.hostname}:5000`;
  }
  return loc.origin;
};

const socket = io(getSocketUrl(), { autoConnect: true });

export default function Participant() {
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState('');
  const [team, setTeam] = useState(null);
  const [syncData, setSyncData] = useState({
    phase: 'waiting',
    isPaused: false,
    question: null,
    time: 0,
    totalTime: 0,
    myBid: null,
    myPassed: false,
    isActiveBidder: false,
    answerOptions: null,
    result: null,
    config: { bidChoices: [2, 4, 6, 9, 10, 13, 15], passPenalty: 5 }
  });

  const [selectedBid, setSelectedBid] = useState(null);
  const [answerLocked, setAnswerLocked] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [violationNotice, setViolationNotice] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // 18. Tab Switch & Window Focus Anti-Cheating Detection
  useEffect(() => {
    if (!team) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        socket.emit('team:violation', { type: 'tab_switch' });
      }
    };

    const handleBlur = () => {
      socket.emit('team:violation', { type: 'window_blur' });
    };

    const handleContextMenu = (e) => e.preventDefault();
    const handleKeyDown = (e) => {
      if (
        (e.ctrlKey && ['c', 'v', 'u', 'a'].includes(e.key.toLowerCase())) ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') ||
        e.key === 'F12'
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [team]);

  // Socket Listeners
  useEffect(() => {
    socket.on('team:joined', (teamData) => {
      setTeam(teamData);
      setErrorMessage('');
      localStorage.setItem('bidnex_token', teamData.sessionToken);
    });

    socket.on('team:error', (msg) => {
      setErrorMessage(msg);
    });

    socket.on('bid:error', (msg) => {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(''), 4000);
    });

    socket.on('player:error', (msg) => {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(''), 4000);
    });

    socket.on('player:sync', (data) => {
      if (data.team) setTeam(data.team);
      setSyncData(prev => ({
        ...prev,
        phase: data.phase,
        isPaused: data.isPaused,
        question: data.question,
        time: data.time,
        totalTime: data.totalTime,
        myBid: data.myBid,
        myPassed: data.myPassed,
        isActiveBidder: data.isActiveBidder,
        answerOptions: data.answerOptions,
        result: data.result,
        config: data.config || prev.config
      }));

      // Reset local answer locks on round change
      if (data.phase === 'bidding') {
        setAnswerLocked(false);
        setSelectedOption(null);
        setFeedback(null);
      }
    });

    socket.on('timer', ({ time, totalTime, isPaused }) => {
      setSyncData(prev => ({ ...prev, time, totalTime, isPaused: Boolean(isPaused) }));
    });

    socket.on('bid:locked', ({ bid }) => {
      setSelectedBid(bid);
      setErrorMessage('');
    });

    socket.on('pass:confirmed', ({ penalty, points }) => {
      setErrorMessage('');
      setFeedback({ type: 'pass', message: `PASS recorded (-${penalty} pts)` });
      setTeam(prev => prev ? { ...prev, points } : null);
    });

    socket.on('player:answer_feedback', (data) => {
      setFeedback(data);
      if (data.points !== undefined) {
        setTeam(prev => prev ? { ...prev, points: data.points } : null);
      }
    });

    socket.on('player:violation_warning', ({ violationCount, maxWarnings, isFinal }) => {
      if (violationCount >= 3 || isFinal) {
        setViolationNotice('FINAL VIOLATION 3/3 — Admin Notified');
      } else {
        setViolationNotice(`PAGE LEAVE WARNING ${violationCount}/${maxWarnings}`);
      }
      setTimeout(() => setViolationNotice(null), 5000);
    });

    socket.on('event:reset', () => {
      setTeam(null);
      setSelectedBid(null);
      setFeedback(null);
      setErrorMessage('');
      localStorage.removeItem('bidnex_token');
    });

    // Auto-reconnect session check
    const savedToken = localStorage.getItem('bidnex_token');
    if (savedToken) {
      socket.emit('team:reconnect', { token: savedToken });
    }

    return () => {
      socket.off('team:joined');
      socket.off('team:error');
      socket.off('bid:error');
      socket.off('player:error');
      socket.off('player:sync');
      socket.off('timer');
      socket.off('bid:locked');
      socket.off('pass:confirmed');
      socket.off('player:answer_feedback');
      socket.off('player:violation_warning');
      socket.off('event:reset');
    };
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!teamName.trim()) return setErrorMessage('Please enter your team name.');
    socket.emit('team:join', { name: teamName.trim(), members: teamMembers.trim() });
  };

  const handleLockBid = () => {
    if (selectedBid === null || syncData.isPaused) return;
    socket.emit('team:bid', selectedBid);
  };

  const handlePass = () => {
    if (syncData.isPaused) return;
    socket.emit('team:pass');
  };

  const handleSubmitAnswer = (opt) => {
    if (answerLocked || syncData.isPaused) return;
    setSelectedOption(opt);
    setAnswerLocked(true);
    socket.emit('team:answer', opt);
  };

  // Registration Screen — Glassmorphism + Poster
  if (!team) {
    const passPenalty = syncData.config?.passPenalty ?? 5;
    return (
      <div className="login-arena">
        <div className="login-poster-bg" />
        <div className="login-poster-overlay" />
        <div className="login-glass-card">
          <div className="login-brand">BIDNEX</div>
          <div className="login-subtitle">LIVE TECHNICAL COMPETITION</div>

          <form onSubmit={handleJoin} className="login-form">
            <div className="login-field">
              <label className="login-label">TEAM NAME</label>
              <input
                className="login-input"
                type="text"
                placeholder="e.g. CyberVanguard"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={30}
                autoFocus
                required
              />
            </div>
            <div className="login-field">
              <label className="login-label">TEAM MEMBERS</label>
              <input
                className="login-input"
                type="text"
                placeholder="e.g. Alex, Sam, Ryan"
                value={teamMembers}
                onChange={(e) => setTeamMembers(e.target.value)}
                maxLength={100}
              />
            </div>
            <button type="submit" className="login-btn">
              ENTER THE ARENA <span className="login-btn-arrow">→</span>
            </button>
          </form>

          {errorMessage && <div className="login-error">{errorMessage}</div>}

          <div className="login-meta">
            <span className="login-meta-item">
              <span className="login-meta-key">STARTING SCORE</span>
              <span className="login-meta-val green">100 PTS</span>
            </span>
            <span className="login-meta-sep">•</span>
            <span className="login-meta-item">
              <span className="login-meta-key">PASS PENALTY</span>
              <span className="login-meta-val red">-{passPenalty} PTS</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Final Results Screen
  if (syncData.phase === 'finished') {
    return (
      <div className="player-shell">
        <header className="player-topbar">
          <div className="player-brand-badge">
            <span className="brand-dot" /> BIDNEX
          </div>
          <div className="player-team-pill">{team.name}</div>
        </header>
        <main className="player-content" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h1 style={{ fontSize: 44, fontWeight: 950, color: 'var(--neon-green)', letterSpacing: '0.1em' }}>COMPETITION COMPLETED</h1>
          <p style={{ color: 'var(--text-sub)', marginTop: 8, fontSize: 16 }}>Final tournament standings recorded.</p>
          <div style={{ margin: '40px auto', background: 'var(--surface-metallic)', border: '1px solid var(--border-glass)', borderRadius: 24, padding: '40px 20px', maxWidth: 440 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--text-dim)', marginBottom: 8 }}>FINAL SCORE</div>
            <div style={{ fontSize: 64, fontWeight: 950, fontFamily: 'var(--font-mono)', color: 'var(--neon-green)' }}>{team.points}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 10 }}>Team: <strong>{team.name}</strong></div>
          </div>
        </main>
      </div>
    );
  }

  const { question, phase, isPaused, time, totalTime, myBid, myPassed, isActiveBidder, answerOptions, result, config } = syncData;
  const bidChoices = config?.bidChoices || [2, 4, 6, 9, 10, 13, 15];
  const passPenalty = config?.passPenalty ?? 5;
  const progressRatio = totalTime > 0 ? Math.max(0, time / totalTime) : 0;
  const strokeOffset = 175 - (175 * progressRatio);

  return (
    <div className="player-shell">
      {/* Global Server Pause Notification */}
      {isPaused && (
        <div className="global-pause-banner">
          <span>⏸</span> TOURNAMENT PAUSED BY ADMIN — TIMERS & CONTROLS FROZEN
        </div>
      )}

      {/* Violation Alert */}
      {violationNotice && (
        <div className="player-violation-toast">
          <span>⚠️</span> {violationNotice}
        </div>
      )}

      {/* Header */}
      <header className="player-topbar" style={isPaused ? { marginTop: 42 } : {}}>
        <div className="player-brand-badge">
          <span className="brand-dot" /> BIDNEX
        </div>
        <div className="player-team-pill">{team.name}</div>
        <div className="player-stats-cluster">
          <div className="player-stat-box">
            <span className="player-stat-label">SCORE</span>
            <span className="player-stat-val">{team.points}</span>
          </div>
        </div>
      </header>

      {/* Main Focus Game Area */}
      <main className="player-content">
        {/* Waiting State */}
        {phase === 'waiting' && (
          <div className="arena-waiting">
            <div className="waiting-orbit">
              <div className="orbit-core" />
            </div>
            <h2>Waiting for Host</h2>
            <p>The competition will begin shortly. Prepare your bidding strategy.</p>
          </div>
        )}

        {/* Live Question Presentation */}
        {question && phase !== 'waiting' && (
          <div className="player-card">
            {/* Header info & timer */}
            <div className="card-topbar-row">
              <div className="round-info-pill">
                <span className={`phase-tag ${phase}`}>
                  {phase === 'bidding' ? 'BIDDING' : phase === 'answering' ? (isActiveBidder ? 'YOUR TURN TO ANSWER' : 'QUESTION LIVE') : 'ROUND RESULT'}
                </span>
                <span className="q-meta">Q{question.questionNumber} / {question.totalQuestions} · {question.category}</span>
              </div>

              {/* Server-authoritative visual timer */}
              <div className="circular-timer">
                <svg className="timer-svg" viewBox="0 0 64 64">
                  <circle className="timer-bg" cx="32" cy="32" r="28" />
                  <circle
                    className={`timer-fg ${time <= 3 ? 'critical' : ''}`}
                    cx="32" cy="32" r="28"
                    style={{ strokeDashoffset: strokeOffset }}
                  />
                </svg>
                <div className="timer-num">{time}</div>
              </div>
            </div>

            {/* Question Text */}
            <div className="question-text-box">
              <div className="question-text-content">{question.question}</div>
            </div>

            {/* Error Notification */}
            {errorMessage && (
              <div style={{ color: 'var(--crimson)', background: 'rgba(244,63,94,0.1)', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 700 }}>
                {errorMessage}
              </div>
            )}

            {/* 14. BIDDING PHASE UI */}
            {phase === 'bidding' && (
              <div className="bidding-action-center">
                <div className="bidding-action-title">Select Bid Amount</div>
                <div className="bid-buttons-rack">
                  {bidChoices.map(val => {
                    const cannotAfford = val > team.points;
                    return (
                      <button
                        key={val}
                        className={`tactile-bid-btn ${selectedBid === val ? 'selected' : ''}`}
                        disabled={isPaused || myBid !== null || myPassed || cannotAfford}
                        onClick={() => setSelectedBid(val)}
                        title={cannotAfford ? 'Bid exceeds your current points' : ''}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>

                <div className="bid-action-buttons-row">
                  <button
                    className="btn-lock-bid"
                    disabled={isPaused || selectedBid === null || myBid !== null || myPassed}
                    onClick={handleLockBid}
                  >
                    {myBid !== null ? `BID LOCKED (${myBid})` : 'LOCK BID'}
                  </button>

                  <button
                    className="btn-pass-action"
                    disabled={isPaused || myBid !== null || myPassed}
                    onClick={handlePass}
                  >
                    {myPassed ? 'PASSED' : `PASS (-${passPenalty})`}
                  </button>
                </div>

                {myBid !== null && (
                  <div className="bid-status-confirmed">
                    ✓ Your bid of {myBid} points is confirmed.
                  </div>
                )}
                {myPassed && (
                  <div style={{ marginTop: 14, color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>
                    You passed this question (-{passPenalty} points).
                  </div>
                )}
              </div>
            )}

            {/* 15. ANSWER PHASE UI (When this team is the active bidder) */}
            {phase === 'answering' && isActiveBidder && answerOptions && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--neon-green)', letterSpacing: '0.12em', textAlign: 'center' }}>
                  ⚡ YOU WON THE BID! SELECT YOUR ANSWER:
                </div>
                <div className="answer-options-grid">
                  {answerOptions.map((opt, i) => (
                    <button
                      key={opt}
                      className="answer-option-btn"
                      disabled={isPaused || answerLocked}
                      onClick={() => handleSubmitAnswer(opt)}
                      style={selectedOption === opt ? { borderColor: 'var(--neon-green)', background: '#103819' } : {}}
                    >
                      <span className="answer-option-letter">{['A', 'B', 'C', 'D'][i] || i + 1}</span>
                      <span className="answer-option-text">{opt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 16. ANSWER PHASE UI (When other team / queue is answering) */}
            {phase === 'answering' && !isActiveBidder && (
              <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-sub)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#a7f3d0' }}>Evaluating bids & answers...</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Stand by for the cascade.</div>
              </div>
            )}

            {/* Immediate personal answer feedback */}
            {feedback && (
              <div style={{ marginTop: 20, textAlign: 'center', fontSize: 18, fontWeight: 900, color: feedback.type === 'correct' ? 'var(--neon-green)' : 'var(--crimson)' }}>
                {feedback.message}
              </div>
            )}

            {/* Question End Result */}
            {phase === 'question_result' && result && (
              <div className={`result-banner-card ${result.outcome === 'answered' ? 'correct' : 'unresolved'}`}>
                <div className="result-title-huge">
                  {result.outcome === 'answered' ? 'QUESTION RESOLVED' : 'QUESTION UNRESOLVED'}
                </div>
                <p style={{ color: '#fff', fontSize: 15, marginBottom: 12 }}>{result.summary}</p>
                {result.correctAnswer && (
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--neon-green)' }}>
                    Correct Answer: {result.correctAnswer}
                  </div>
                )}
                {result.explanation && (
                  <div className="result-explanation-box">
                    <strong>Explanation:</strong> {result.explanation}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
