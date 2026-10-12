import React, { useState, useEffect, useRef } from 'react';
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

export default function Participant() {
  const [isConnected, setIsConnected] = useState(socket.connected);
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
    config: { bidChoices: [2, 4, 6, 9, 10, 13, 15], passPenalty: 5 },
    finishedAt: null,
    winner: null,
    leaderboard: null
  });

  const [selectedBid, setSelectedBid] = useState(null);
  const [answerLocked, setAnswerLocked] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [violationNotice, setViolationNotice] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // OPTIONAL FEATURE: Admission Approval State
  const [admissionStatus, setAdmissionStatus] = useState(null); // null, 'pending', 'rejected'
  const [admissionMessage, setAdmissionMessage] = useState('');
  const [admissionTeamName, setAdmissionTeamName] = useState('');
  const [requireApprovalConfig, setRequireApprovalConfig] = useState(false);

  // Cinematic Ending Video State
  const [videoStage, setVideoStage] = useState('initial'); // 'initial', 'video', 'final', 'error'
  const [isMuted, setIsMuted] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const videoRef = useRef(null);
  const hasPlayedVideoRef = useRef(false);

  // Fetch initial config for approval mode
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(cfg => {
        if (cfg && cfg.requireAdminApproval !== undefined) {
          setRequireApprovalConfig(Boolean(cfg.requireAdminApproval));
        }
      })
      .catch(() => {});
  }, []);

  // 18. Tab Switch & Window Focus Anti-Cheating Detection with Transition Guard
  useEffect(() => {
    if (!team) return;

    let lastReportTime = 0;
    const REPORT_COOLDOWN_MS = 2000;

    const reportViolation = (type) => {
      // Ignore further counting if team has already reached the maximum limit
      if (team.violations >= 3) return;

      const now = Date.now();
      if (now - lastReportTime < REPORT_COOLDOWN_MS) {
        return; // Guard: suppress duplicate/burst events for a single switch incident
      }
      lastReportTime = now;
      socket.emit('team:violation', { type });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        reportViolation('tab_switch');
      }
    };

    const handleBlur = () => {
      // If the document is already hidden, visibilitychange has already handled this tab switch
      if (document.hidden) return;
      reportViolation('window_blur');
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
    const onConnect = () => {
      setIsConnected(true);
      setErrorMessage('');
      const savedToken = localStorage.getItem('bidnex_token');
      if (savedToken) {
        socket.emit('team:reconnect', { token: savedToken });
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      setIsConnected(false);
      console.warn('Participant socket connection error:', err?.message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    if (socket.connected) {
      onConnect();
    }

    socket.on('config:update', (cfg) => {
      if (cfg && cfg.requireAdminApproval !== undefined) {
        setRequireApprovalConfig(Boolean(cfg.requireAdminApproval));
      }
    });

    socket.on('team:approval_pending', (data) => {
      setAdmissionStatus('pending');
      setAdmissionMessage(data?.message || 'ACCESS REQUEST SENT — Waiting for Admin approval.');
      if (data?.teamName) setAdmissionTeamName(data.teamName);
      if (data?.sessionToken) localStorage.setItem('bidnex_token', data.sessionToken);
      setErrorMessage('');
    });

    socket.on('team:rejected', (data) => {
      setAdmissionStatus('rejected');
      setAdmissionMessage(data?.message || 'Access request was rejected by admin.');
      if (data?.teamName) setAdmissionTeamName(data.teamName);
      setErrorMessage('');
    });

    socket.on('team:joined', (teamData) => {
      setTeam(teamData);
      setAdmissionStatus(null);
      setAdmissionMessage('');
      setErrorMessage('');
      localStorage.setItem('bidnex_token', teamData.sessionToken);
    });

    socket.on('team:error', (msg) => {
      setErrorMessage(msg);
    });

    socket.on('team:session_expired', (msg) => {
      localStorage.removeItem('bidnex_token');
      setTeam(null);
      setAdmissionStatus(null);
      setAdmissionMessage('');
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
        config: data.config || prev.config,
        finishedAt: data.finishedAt !== undefined ? data.finishedAt : prev.finishedAt,
        winner: data.winner !== undefined ? data.winner : prev.winner,
        leaderboard: data.leaderboard !== undefined ? data.leaderboard : prev.leaderboard
      }));

      // Reset local answer locks on round change
      if (data.phase === 'bidding') {
        setAnswerLocked(false);
        setSelectedOption(null);
        setFeedback(null);
      }
    });

    socket.on('event:finished', (data) => {
      setSyncData(prev => ({
        ...prev,
        phase: 'finished',
        finishedAt: (data && data.finishedAt) ? data.finishedAt : (prev.finishedAt || Date.now()),
        winner: (data && data.winner) ? data.winner : prev.winner,
        leaderboard: (data && data.leaderboard) ? data.leaderboard : prev.leaderboard
      }));
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

    socket.on('event:reset', (payload) => {
      localStorage.removeItem('bidnex_token');
      setTeam(null);
      setSelectedBid(null);
      setAnswerLocked(false);
      setSelectedOption(null);
      setFeedback(null);
      setViolationNotice(null);
      setErrorMessage(payload?.message || 'Tournament reset by Admin. Please register your team again.');
      setVideoStage('initial');
      setAutoplayBlocked(false);
      hasPlayedVideoRef.current = false;
      setAdmissionStatus(null);
      setAdmissionMessage('');
      setAdmissionTeamName('');
      // Complete reset of tournament state back to lobby
      setSyncData(prev => ({
        ...prev,
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
        finishedAt: null,
        winner: null,
        leaderboard: null
      }));
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('config:update');
      socket.off('team:approval_pending');
      socket.off('team:rejected');
      socket.off('team:joined');
      socket.off('team:error');
      socket.off('team:session_expired');
      socket.off('bid:error');
      socket.off('player:error');
      socket.off('player:sync');
      socket.off('event:finished');
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
    if (!isConnected) return setErrorMessage('Connecting to game server... Please wait a moment.');
    if (!teamName.trim()) return setErrorMessage('Please enter your team name.');
    const savedToken = localStorage.getItem('bidnex_token');
    socket.emit('team:join', {
      name: teamName.trim(),
      members: teamMembers.trim(),
      token: savedToken || undefined
    });
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

  // Ending Video Orchestration: 5s delay -> Full-screen video -> Final state
  useEffect(() => {
    if (syncData.phase !== 'finished') {
      setVideoStage('initial');
      hasPlayedVideoRef.current = false;
      return;
    }

    if (hasPlayedVideoRef.current) {
      setVideoStage('final');
      return;
    }

    const finishedAt = syncData.finishedAt || Date.now();
    const elapsed = Date.now() - finishedAt;
    const remaining = Math.max(0, 5000 - elapsed);

    const timer = setTimeout(() => {
      setVideoStage(prev => (prev === 'initial' ? 'video' : prev));
    }, remaining);

    return () => clearTimeout(timer);
  }, [syncData.phase, syncData.finishedAt]);

  // Handle Autoplay & Playback when entering video stage
  useEffect(() => {
    if (videoStage === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Browser autoplay prevented video playback:', err);
          setAutoplayBlocked(true);
        });
      }
    }
  }, [videoStage]);

  const handleVideoEnded = () => {
    hasPlayedVideoRef.current = true;
    setVideoStage('final');
  };

  const handleVideoError = (e) => {
    console.warn('Ending video failed to load, falling back to competition screen:', e);
    setVideoStage('error');
  };

  // Registration Screen — Glassmorphism + Poster
  if (!team) {
    const passPenalty = syncData.config?.passPenalty ?? 5;

    // OPTIONAL FEATURE: Admission Pending Waiting Screen
    if (admissionStatus === 'pending') {
      return (
        <div className="login-arena">
          <div className="login-poster-bg" />
          <div className="login-poster-overlay" />
          <div className="login-glass-card admission-glass-card">
            <div className="login-brand">BIDNEX</div>
            <div className="login-subtitle">ADMISSION REQUEST PENDING</div>

            <div className="admission-pending-card">
              <div className="admission-pending-pulse">
                <span className="admission-pulse-ring" />
                <span className="admission-pulse-dot" />
              </div>

              <div className="admission-pending-title">ACCESS REQUEST SENT</div>
              <div className="admission-pending-subtitle">WAITING FOR ADMIN APPROVAL</div>

              {admissionTeamName && (
                <div className="admission-team-card">
                  <div className="admission-team-label">REGISTERED TEAM</div>
                  <div className="admission-team-name">{admissionTeamName}</div>
                </div>
              )}

              <p className="admission-pending-text">
                Your admission request has been sent to the competition administrators. Please keep this screen open — once approved, you will automatically enter the arena.
              </p>
            </div>

            <button
              type="button"
              className="admission-cancel-btn"
              onClick={() => {
                localStorage.removeItem('bidnex_token');
                setAdmissionStatus(null);
                setAdmissionTeamName('');
              }}
            >
              CANCEL REQUEST & CHANGE TEAM
            </button>
          </div>
        </div>
      );
    }

    // OPTIONAL FEATURE: Admission Rejected Screen
    if (admissionStatus === 'rejected') {
      return (
        <div className="login-arena">
          <div className="login-poster-bg" />
          <div className="login-poster-overlay" />
          <div className="login-glass-card admission-glass-card">
            <div className="login-brand">BIDNEX</div>
            <div className="login-subtitle" style={{ color: '#f87171' }}>ADMISSION REJECTED</div>

            <div className="admission-rejected-card">
              <div className="admission-rejected-icon">✕</div>
              <div className="admission-rejected-title">ACCESS REQUEST REJECTED</div>
              <div className="admission-rejected-subtitle">
                {admissionMessage || 'Access request was rejected by admin.'}
              </div>

              {admissionTeamName && (
                <div className="admission-team-card rejected">
                  <div className="admission-team-label">REQUESTED TEAM</div>
                  <div className="admission-team-name">{admissionTeamName}</div>
                </div>
              )}

              <p className="admission-pending-text">
                The competition administrator did not approve this team. You cannot participate with this team name. Please try another team.
              </p>
            </div>

            <button
              type="button"
              className="admission-retry-btn"
              onClick={() => {
                localStorage.removeItem('bidnex_token');
                setAdmissionStatus(null);
                setAdmissionTeamName('');
              }}
            >
              TRY ANOTHER TEAM
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="login-arena">
        <div className="login-poster-bg" />
        <div className="login-poster-overlay" />
        <div className="login-glass-card">
          <div className="login-brand">BIDNEX</div>
          <div className="login-subtitle">LIVE TECHNICAL COMPETITION</div>

          {!isConnected && (
            <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 13, textAlign: 'center', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              Connecting to game server... Please wait a moment.
            </div>
          )}

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
            <button type="submit" className="login-btn" disabled={!isConnected} style={!isConnected ? { opacity: 0.65, cursor: 'not-allowed' } : {}}>
              {isConnected ? (requireApprovalConfig ? 'REQUEST ADMIN APPROVAL' : 'ENTER THE ARENA') : 'CONNECTING...'} <span className="login-btn-arrow">→</span>
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

  // Competition Finished Views — 3-Stage Orchestration
  if (syncData.phase === 'finished') {
    const winner = syncData.winner;
    const isWinner = winner && (winner.id === team.id || winner.name === team.name);

    // Stage 1 & Fallback: Initial 5s Screen or Fallback on Video Load Error
    if (videoStage === 'initial' || videoStage === 'error') {
      return (
        <div className="player-shell ending-fade-in">
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
            {videoStage === 'initial' && (
              <div className="ending-transition-pill">
                <span className="ending-pulse-dot" /> PREPARING CINEMATIC FINALE...
              </div>
            )}
          </main>
        </div>
      );
    }

    // Stage 2: Full-Viewport Background Cinematic Video
    if (videoStage === 'video') {
      return (
        <div className="ending-video-viewport ending-fade-in">
          <video
            ref={videoRef}
            src="/ending-video.mp4"
            autoPlay
            muted={isMuted}
            playsInline
            loop={false}
            onEnded={handleVideoEnded}
            onError={handleVideoError}
            className="ending-video-bg"
          />
          <div className="ending-video-scrim" />

          {/* Floating Top Controls / Brand */}
          <div className="ending-top-overlay">
            <div className="player-brand-badge" style={{ background: 'rgba(7, 22, 13, 0.75)', backdropFilter: 'blur(12px)' }}>
              <span className="brand-dot" /> BIDNEX 2K26
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="player-team-pill" style={{ background: 'rgba(7, 22, 13, 0.75)', backdropFilter: 'blur(12px)' }}>
                {team.name}
              </div>
              <button
                type="button"
                className="ending-audio-toggle"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.muted = !isMuted;
                    setIsMuted(!isMuted);
                  }
                }}
                title={isMuted ? 'Unmute video audio' : 'Mute video audio'}
              >
                {isMuted ? '🔊 UNMUTE' : '🔇 MUTED'}
              </button>
            </div>
          </div>

          {/* Autoplay Blocked Manual Play Button */}
          {autoplayBlocked && (
            <div className="ending-blocked-prompt">
              <button
                type="button"
                className="ending-play-trigger-btn"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => {});
                  }
                }}
              >
                ▶ PLAY FINALE
              </button>
            </div>
          )}

          {/* Elegant HUD Overlay (Unobtrusive to keep video the primary visual focus) */}
          <div className="ending-bottom-hud">
            <div className="ending-hud-card">
              <div className="ending-hud-meta">
                <span className="ending-hud-tag">TOURNAMENT FINALE</span>
                {winner && (
                  <span className="ending-winner-pill">
                    🏆 CHAMPION: <strong>{winner.name}</strong> ({winner.points} PTS)
                  </span>
                )}
              </div>
              <div className="ending-hud-row">
                <div className="ending-team-info">
                  <div className="ending-label">YOUR TEAM</div>
                  <div className="ending-team-name">{team.name}</div>
                </div>
                <div className="ending-score-box">
                  <div className="ending-label">FINAL SCORE</div>
                  <div className="ending-score-val">
                    {team.points} <span className="ending-score-pts">PTS</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Stage 3: Polished Final State with Standings and Admin Restart Status
    if (videoStage === 'final') {
      return (
        <div className="player-shell ending-fade-in">
          <header className="player-topbar">
            <div className="player-brand-badge">
              <span className="brand-dot" /> BIDNEX
            </div>
            <div className="player-team-pill">{team.name}</div>
          </header>
          <main className="player-content" style={{ textAlign: 'center', padding: '40px 20px 60px' }}>
            <div className="final-stage-badge">
              <span className="final-badge-dot" /> TOURNAMENT CONCLUDED
            </div>
            <h1 style={{ fontSize: 42, fontWeight: 950, color: 'var(--neon-green)', letterSpacing: '0.08em', marginTop: 12 }}>
              FINAL STANDINGS
            </h1>
            <p style={{ color: 'var(--text-sub)', marginTop: 8, fontSize: 15 }}>
              Competition has concluded. Official final results recorded.
            </p>

            {/* Winner Celebration Banner */}
            {winner && (
              <div className={`final-champion-card ${isWinner ? 'champion-active' : ''}`}>
                <div className="champion-trophy">🏆</div>
                <div className="champion-details">
                  <div className="champion-title">TOURNAMENT CHAMPION</div>
                  <div className="champion-name">{winner.name}</div>
                  <div className="champion-pts">{winner.points} POINTS</div>
                </div>
              </div>
            )}

            {/* Team's Official Final Score Card */}
            <div style={{ margin: '24px auto', background: 'var(--surface-metallic)', border: '1px solid var(--border-glass)', borderRadius: 24, padding: '32px 24px', maxWidth: 440 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--text-dim)', marginBottom: 8 }}>
                {team.name.toUpperCase()} FINAL SCORE
              </div>
              <div style={{ fontSize: 60, fontWeight: 950, fontFamily: 'var(--font-mono)', color: 'var(--neon-green)' }}>
                {team.points}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 10 }}>
                Status: <strong style={{ color: '#a7f3d0' }}>Final Score Recorded</strong>
              </div>
            </div>

            {/* Leaderboard Table if available */}
            {syncData.leaderboard && syncData.leaderboard.length > 0 && (
              <div className="final-standings-box">
                <div className="final-standings-title">OFFICIAL LEADERBOARD</div>
                <div className="final-standings-table">
                  {syncData.leaderboard.map((item, idx) => (
                    <div
                      key={item.id || item.name}
                      className={`final-standing-row ${item.name === team.name ? 'is-self' : ''}`}
                    >
                      <span className="standing-rank">#{idx + 1}</span>
                      <span className="standing-name">{item.name}</span>
                      <span className="standing-pts">{item.points} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin-Controlled Restart Option / Status */}
            <div className="final-admin-note">
              <div className="final-admin-icon">⚡</div>
              <div className="final-admin-text">
                <strong>Admin Controlled Tournament</strong>
                <span>Waiting for Tournament Administrator to reset the arena for the next round.</span>
              </div>
            </div>
          </main>
        </div>
      );
    }
  }

  const { question, phase, isPaused, time, totalTime, myBid, myPassed, isActiveBidder, answerOptions, result, config } = syncData;
  const bidChoices = config?.bidChoices || [2, 4, 6, 9, 10, 13, 15];
  const passPenalty = config?.passPenalty ?? 5;
  const progressRatio = totalTime > 0 ? Math.max(0, time / totalTime) : 0;
  const strokeOffset = 175 - (175 * progressRatio);

  return (
    <div className="player-shell">
      {/* Network Disconnection Notification */}
      {!isConnected && (
        <div className="global-disconnect-banner">
          <span>⚡</span> NETWORK DISCONNECTED — RECONNECTING TO GAME SERVER...
        </div>
      )}

      {/* Global Server Pause Notification */}
      {isPaused && (
        <div className="global-pause-banner" style={!isConnected ? { top: 42 } : {}}>
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
      <header className="player-topbar" style={(!isConnected && isPaused) ? { marginTop: 84 } : (!isConnected || isPaused) ? { marginTop: 42 } : {}}>
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
