// ═══════════════════════════════════════════════════════════════
// Cricket Scorer PWA — 6-Player Edition
// ═══════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBi1W7fjSMiCHrrHYqllfSvWDQKEgsM44g",
  authDomain:        "cricket-scoring-6f92e.firebaseapp.com",
  databaseURL:       "https://cricket-scoring-6f92e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "cricket-scoring-6f92e",
  storageBucket:     "cricket-scoring-6f92e.firebasestorage.app",
  messagingSenderId: "354837174850",
  appId:             "1:354837174850:android:1421db6ff936310af7abdb"
};

const { useState, useEffect, useRef, useCallback } = React;

const POOL_KEY = "cricket-player-pool-v1";
const MIN_PLAYERS = 6;

// ── Theme & Styles ──────────────────────────────────────────────
const SP = {
  bg: "#0f172a",
  card: "#1e293b",
  accent: "#fbbf24",
  text: "#f8fafc",
  textDim: "#94a3b8",
  primary: "#38bdf8",
  tertiary: "#ef4444",
  inputBg: "rgba(255,255,255,0.05)",
};

const STYLES = `
  body { margin:0; font-family: 'Inter', sans-serif; background:${SP.bg}; color:${SP.text}; }
  .btn { border:none; border-radius:8px; padding:12px; font-weight:600; cursor:pointer; transition:0.2s; display:flex; align-items:center; justify-content:center; }
  .btn-primary { background:${SP.accent}; color:${SP.bg}; }
  .btn-outline { background:transparent; border:1px solid ${SP.textDim}; color:${SP.text}; }
  .btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .card { background:${SP.card}; border-radius:16px; padding:16px; box-shadow:0 4px 6px rgba(0,0,0,0.3); }
  .input { background:${SP.inputBg}; border:1px solid rgba(255,255,255,0.1); color:white; padding:12px; border-radius:8px; width:100%; outline:none; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.9); display:flex; align-items:center; justify-content:center; padding:20px; z-index:1000; }
  .player-chip { padding:8px 12px; border-radius:20px; font-size:13px; cursor:pointer; border:1px solid rgba(255,255,255,0.1); transition: 0.2s; }
`;

// ── Components ───────────────────────────────────────────────────

function App() {
  const [matchData, setMatchData] = useState(null);
  const [view, setView] = useState('setup'); // 'setup' or 'match'
  const [playerPool, setPlayerPool] = useState(() => {
    const saved = localStorage.getItem(POOL_KEY);
    return saved ? JSON.parse(saved) : ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
  });

  useEffect(() => {
    localStorage.setItem(POOL_KEY, JSON.stringify(playerPool));
  }, [playerPool]);

  if (view === 'setup') {
    return (
      <SetupScreen 
        pool={playerPool} 
        setPool={setPlayerPool} 
        onStart={(config) => {
          setMatchData(config);
          setView('match');
        }} 
      />
    );
  }

  return <MatchScreen data={matchData} onExit={() => setView('setup')} />;
}

function SetupScreen({ pool, setPool, onStart }) {
  const [teamA, setTeamA] = useState({ name: "Team 1", players: [] });
  const [teamB, setTeamB] = useState({ name: "Team 2", players: [] });
  const [newName, setNewName] = useState("");

  const togglePlayer = (name, team) => {
    const target = team === 'A' ? teamA : teamB;
    const setter = team === 'A' ? setTeamA : setTeamB;
    
    if (target.players.includes(name)) {
      setter({ ...target, players: target.players.filter(p => p !== name) });
    } else {
      if (target.players.length < 11) {
        setter({ ...target, players: [...target.players, name] });
      }
    }
  };

  const addNewPlayer = () => {
    if (newName.trim() && !pool.includes(newName.trim())) {
      setPool([...pool, newName.trim()]);
      setNewName("");
    }
  };

  const canStart = teamA.players.length >= MIN_PLAYERS && teamB.players.length >= MIN_PLAYERS;

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: 'auto' }}>
      <h2 style={{ color: SP.accent }}>Match Setup</h2>
      
      {/* Team Selection UI */}
      {['A', 'B'].map(t => {
        const team = t === 'A' ? teamA : teamB;
        const setTeam = t === 'A' ? setTeamA : setTeamB;
        return (
          <div key={t} className="card" style={{ marginBottom: 20 }}>
            <input 
              className="input" 
              style={{ marginBottom: 15, fontWeight: 'bold' }} 
              value={team.name} 
              onChange={e => setTeam({...team, name: e.target.value})} 
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pool.map(p => {
                const isSelected = team.players.includes(p);
                const isDisabled = !isSelected && (teamA.players.includes(p) || teamB.players.includes(p));
                return (
                  <div 
                    key={p} 
                    className="player-chip"
                    onClick={() => !isDisabled && togglePlayer(p, t)}
                    style={{ 
                      background: isSelected ? (t === 'A' ? SP.primary : SP.accent) : 'transparent',
                      color: isSelected ? SP.bg : (isDisabled ? '#444' : SP.text),
                      opacity: isDisabled ? 0.5 : 1
                    }}
                  >
                    {p}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: SP.textDim }}>
              Selected: {team.players.length} (Min {MIN_PLAYERS})
            </div>
          </div>
        );
      })}

      {/* Add New Player */}
      <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <input 
          className="input" 
          placeholder="New player name..." 
          value={newName} 
          onChange={e => setNewName(e.target.value)} 
        />
        <button onClick={addNewPlayer} className="btn btn-primary" style={{ padding: '0 20px' }}>+</button>
      </div>

      <button 
        className="btn btn-primary" 
        style={{ width: '100%', padding: 18 }} 
        disabled={!canStart}
        onClick={() => onStart({ teamA, teamB })}
      >
        START MATCH
      </button>
    </div>
  );
}

function MatchScreen({ data, onExit }) {
  const [score, setScore] = useState({ runs: 0, wickets: 0, balls: 0 });
  const [striker, setStriker] = useState(null);
  const [nonStriker, setNonStriker] = useState(null);
  const [selectionMode, setSelectionMode] = useState('OPENERS'); // OPENERS, NEXT_BATSMAN
  
  const squad = data.teamA.players.map(p => ({ name: p, status: 'yet_to_bat' }));
  const [battingOrder, setBattingOrder] = useState(squad);

  const handleSelection = (selected) => {
    if (selectionMode === 'OPENERS') {
      const [p1, p2] = selected;
      setStriker(p1);
      setNonStriker(p2);
      setBattingOrder(prev => prev.map(p => 
        (p.name === p1 || p.name === p2) ? { ...p, status: 'batting' } : p
      ));
      setSelectionMode(null);
    } else {
      const p1 = selected[0];
      setStriker(p1);
      setBattingOrder(prev => prev.map(p => 
        p.name === p1 ? { ...p, status: 'batting' } : p
      ));
      setSelectionMode(null);
    }
  };

  const triggerWicket = () => {
    setBattingOrder(prev => prev.map(p => p.name === striker ? { ...p, status: 'out' } : p));
    setScore(prev => ({ ...prev, wickets: prev.wickets + 1 }));
    setSelectionMode('NEXT_BATSMAN');
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: 'auto' }}>
      <div className="card">
        <h1 style={{ textAlign: 'center', margin: 0, color: SP.accent }}>
          {score.runs} / {score.wickets}
        </h1>
        <p style={{ textAlign: 'center', color: SP.textDim }}>
          Overs: {Math.floor(score.balls / 6)}.{score.balls % 6}
        </p>
        
        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: SP.textDim }}>STRIKER</div>
            <div style={{ fontWeight: 'bold' }}>{striker || '—'}*</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: SP.textDim }}>NON-STRIKER</div>
            <div style={{ fontWeight: 'bold' }}>{nonStriker || '—'}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
        <button className="btn btn-outline" onClick={() => setScore(s => ({...s, runs: s.runs + 1, balls: s.balls + 1}))}>+1 Run</button>
        <button className="btn btn-outline" onClick={() => setScore(s => ({...s, runs: s.runs + 4, balls: s.balls + 1}))}>+4 Runs</button>
        <button className="btn" style={{ background: SP.tertiary }} onClick={triggerWicket}>WICKET / RET. HURT</button>
        <button className="btn btn-outline" onClick={onExit}>EXIT</button>
      </div>

      {selectionMode && (
        <SelectionModal 
          mode={selectionMode} 
          players={battingOrder.filter(p => p.status === 'yet_to_bat')} 
          onConfirm={handleSelection} 
        />
      )}
    </div>
  );
}

function SelectionModal({ mode, players, onConfirm }) {
  const [chosen, setChosen] = useState([]);
  const limit = mode === 'OPENERS' ? 2 : 1;

  const toggle = (name) => {
    if (chosen.includes(name)) setChosen(chosen.filter(n => n !== name));
    else if (chosen.length < limit) setChosen([...chosen, name]);
  };

  return (
    <div className="modal-overlay">
      <div className="card" style={{ width: '100%', maxWidth: 300 }}>
        <h3>{mode === 'OPENERS' ? 'Select 2 Openers' : 'Select Next Batsman'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '20px 0' }}>
          {players.map(p => (
            <div 
              key={p.name} 
              onClick={() => toggle(p.name)}
              style={{ 
                padding: 12, borderRadius: 8, cursor: 'pointer',
                background: chosen.includes(p.name) ? SP.accent : 'rgba(255,255,255,0.05)',
                color: chosen.includes(p.name) ? SP.bg : SP.text
              }}
            >
              {p.name}
            </div>
          ))}
        </div>
        <button 
          className="btn btn-primary" 
          style={{ width: '100%' }} 
          disabled={chosen.length < limit}
          onClick={() => onConfirm(chosen)}
        >
          CONFIRM
        </button>
      </div>
    </div>
  );
}

// ── Root Initialization (Fixes Error #299) ──────────────────────
const container = document.getElementById("root");
if (container) {
  const styleTag = document.createElement("style");
  styleTag.innerHTML = STYLES;
  document.head.appendChild(styleTag);

  // Check if a root already exists to prevent Error #299
  if (!window.reactRoot) {
    window.reactRoot = ReactDOM.createRoot(container);
  }
  window.reactRoot.render(<App />);
}
