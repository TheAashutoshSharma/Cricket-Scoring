// ═══════════════════════════════════════════════════════════════
// Cricket Scorer PWA — 6-Player Persistent Edition
// ═══════════════════════════════════════════════════════════════

const { useState, useEffect, useRef } = React;

const POOL_KEY = "cricket_player_pool_v2";
const MIN_PLAYERS = 6;

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
  .btn { border:none; border-radius:8px; padding:12px; font-weight:600; cursor:pointer; transition:0.2s; display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-primary { background:${SP.accent}; color:${SP.bg}; }
  .btn-outline { background:transparent; border:1px solid ${SP.textDim}; color:${SP.text}; }
  .btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .card { background:${SP.card}; border-radius:16px; padding:16px; box-shadow:0 4px 6px rgba(0,0,0,0.3); }
  .input { background:${SP.inputBg}; border:1px solid rgba(255,255,255,0.1); color:white; padding:12px; border-radius:8px; width:100%; outline:none; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.95); display:flex; align-items:center; justify-content:center; padding:20px; z-index:1000; }
  .player-chip { padding:8px 14px; border-radius:10px; font-size:13px; cursor:pointer; border:1px solid rgba(255,255,255,0.1); transition: 0.2s; text-align:center; }
`;

function App() {
  const [view, setView] = useState('setup'); // 'setup' or 'match'
  const [matchData, setMatchData] = useState(null);
  const [playerPool, setPlayerPool] = useState(() => {
    const saved = localStorage.getItem(POOL_KEY);
    return saved ? JSON.parse(saved) : ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
  });

  // Save pool whenever it changes
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

  return <MatchScreen config={matchData} onExit={() => setView('setup')} />;
}

function SetupScreen({ pool, setPool, onStart }) {
  const [teamA, setTeamA] = useState({ name: "Team 1", players: [] });
  const [teamB, setTeamB] = useState({ name: "Team 2", players: [] });
  const [newName, setNewName] = useState("");

  const toggleSelection = (name, team) => {
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
      setPool([newName.trim(), ...pool]);
      setNewName("");
    }
  };

  const isReady = teamA.players.length >= MIN_PLAYERS && teamB.players.length >= MIN_PLAYERS;

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: 'auto' }}>
      <h2 style={{ color: SP.accent, marginBottom: 5 }}>Match Setup</h2>
      <p style={{ color: SP.textDim, fontSize: 13, marginBottom: 20 }}>Select min {MIN_PLAYERS} players per team</p>

      {/* Team Selection Cards */}
      {[ {id: 'A', data: teamA, set: setTeamA, color: SP.primary}, 
         {id: 'B', data: teamB, set: setTeamB, color: SP.accent} ].map(t => (
        <div key={t.id} className="card" style={{ marginBottom: 15 }}>
          <input className="input" style={{ marginBottom: 12, borderBottom: `2px solid ${t.color}` }} 
            value={t.data.name} onChange={e => t.set({...t.data, name: e.target.value})} />
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {pool.map(p => {
              const selected = t.data.players.includes(p);
              const otherSelected = (t.id === 'A' ? teamB : teamA).players.includes(p);
              return (
                <div key={p} className="player-chip"
                  onClick={() => !otherSelected && toggleSelection(p, t.id)}
                  style={{ 
                    background: selected ? t.color : 'transparent',
                    color: selected ? SP.bg : (otherSelected ? '#334155' : SP.text),
                    opacity: otherSelected ? 0.4 : 1,
                    borderColor: selected ? t.color : 'rgba(255,255,255,0.1)'
                  }}>{p}</div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: SP.textDim }}>Players: {t.data.players.length}/11</div>
        </div>
      ))}

      {/* Add New Player Button */}
      <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Add New Player..." value={newName} onChange={e => setNewName(e.target.value)} />
        <button onClick={addNewPlayer} className="btn btn-primary" style={{ fontSize: 20, width: 60 }}>+</button>
      </div>

      <button className="btn btn-primary" style={{ width: '100%', padding: 18 }} disabled={!isReady}
        onClick={() => onStart({ teamA, teamB })}>START MATCH</button>
    </div>
  );
}

function MatchScreen({ config, onExit }) {
  const [score, setScore] = useState({ runs: 0, wickets: 0, balls: 0 });
  const [battingSquad, setBattingSquad] = useState(config.teamA.players.map(p => ({ name: p, status: 'yet_to_bat' })));
  const [striker, setStriker] = useState(null);
  const [nonStriker, setNonStriker] = useState(null);
  const [selectionMode, setSelectionMode] = useState('OPENERS'); // OPENERS or NEXT_BATSMAN

  const handleSelection = (names) => {
    if (selectionMode === 'OPENERS') {
      setStriker(names[0]);
      setNonStriker(names[1]);
      setBattingSquad(prev => prev.map(p => 
        (p.name === names[0] || p.name === names[1]) ? { ...p, status: 'batting' } : p
      ));
    } else {
      setStriker(names[0]);
      setBattingSquad(prev => prev.map(p => 
        p.name === names[0] ? { ...p, status: 'batting' } : p
      ));
    }
    setSelectionMode(null);
  };

  const handleWicket = () => {
    setBattingSquad(prev => prev.map(p => p.name === striker ? { ...p, status: 'out' } : p));
    setScore(s => ({ ...s, wickets: s.wickets + 1, balls: s.balls + 1 }));
    
    // Check if team is all out (n-1 because one must be stranded)
    if (score.wickets + 1 < config.teamA.players.length - 1) {
      setSelectionMode('NEXT_BATSMAN');
    } else {
      alert("Innings Complete!");
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: 'auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h3 style={{ margin: 0, color: SP.textDim }}>{config.teamA.name}</h3>
        <h1 style={{ fontSize: 48, margin: '10px 0', color: SP.accent }}>{score.runs} - {score.wickets}</h1>
        <div style={{ fontSize: 18, color: SP.textDim }}>Over: {Math.floor(score.balls / 6)}.{score.balls % 6}</div>
        
        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 25, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20 }}>
          <div><div style={{ fontSize: 11, color: SP.textDim }}>STRIKER</div><div style={{ fontWeight: 'bold' }}>{striker || '—'}*</div></div>
          <div><div style={{ fontSize: 11, color: SP.textDim }}>NON-STRIKER</div><div style={{ fontWeight: 'bold' }}>{nonStriker || '—'}</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
        <button className="btn btn-outline" onClick={() => setScore(s => ({...s, runs: s.runs + 1, balls: s.balls + 1}))}>+1 Run</button>
        <button className="btn btn-outline" onClick={() => setScore(s => ({...s, runs: s.runs + 4, balls: s.balls + 1}))}>+4 Runs</button>
        <button className="btn" style={{ background: SP.tertiary }} onClick={handleWicket}>WICKET / HURT</button>
        <button className="btn btn-outline" onClick={onExit}>EXIT MATCH</button>
      </div>

      {selectionMode && (
        <SelectionModal 
          mode={selectionMode} 
          players={battingSquad.filter(p => p.status === 'yet_to_bat')} 
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
      <div className="card" style={{ width: '100%', maxWidth: 320 }}>
        <h3 style={{ marginTop: 0 }}>{mode === 'OPENERS' ? 'Pick 2 Openers' : 'Pick Next Batsman'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '20px 0' }}>
          {players.map(p => (
            <div key={p.name} onClick={() => toggle(p.name)}
              style={{ 
                padding: 12, borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                background: chosen.includes(p.name) ? SP.accent : 'rgba(255,255,255,0.05)',
                color: chosen.includes(p.name) ? SP.bg : SP.text,
                border: chosen.includes(p.name) ? `1px solid ${SP.accent}` : '1px solid transparent'
              }}>{p.name}</div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={chosen.length < limit}
          onClick={() => onConfirm(chosen)}>CONFIRM SELECTION</button>
      </div>
    </div>
  );
}

// ── Root Management (Fixes Error #299) ───────────────────────────
const container = document.getElementById("root");
if (container) {
  const styleTag = document.createElement("style");
  styleTag.innerHTML = STYLES;
  document.head.appendChild(styleTag);

  // Check if root already exists to prevent re-initialization error
  if (!window.reactRoot) {
    window.reactRoot = ReactDOM.createRoot(container);
  }
  window.reactRoot.render(<App />);
}
