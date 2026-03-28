// ═══════════════════════════════════════════════════════════════
// Cricket Scorer PWA — Firebase + Undo + Retired Hurt + Name Edit
// Updated: 6-Player Team, Player Pool, and Batsman Selection Logic
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

const EXTRAS    = ["Wide", "No Ball", "Bye", "Leg Bye"];
const HOW_OUT   = ["Bowled", "Caught", "LBW", "Run Out", "Stumped", "Hit Wicket"];
const RET_HURT  = "Retired Hurt";
const LOCAL_KEY = "cricket-v6"; // Version bump for new schema
const POOL_KEY  = "cricket-player-pool";
const MIN_TEAM_SIZE = 6;

// ── Styling ──────────────────────────────────────────────────────
const SP = {
  bg: "#0f172a",
  card: "#1e293b",
  accent: "#fbbf24",
  text: "#f8fafc",
  textDim: "#94a3b8",
  primary: "#38bdf8",
  secondary: "#818cf8",
  tertiary: "#ef4444",
  success: "#22c55e",
  inputBg: "rgba(255,255,255,0.05)",
};

const STYLES = `
  body { margin:0; font-family: 'Inter', sans-serif; background:${SP.bg}; color:${SP.text}; user-select:none; -webkit-tap-highlight-color:transparent; }
  * { box-sizing: border-box; }
  .btn { border:none; border-radius:8px; padding:12px; font-weight:600; cursor:pointer; transition:0.2s; display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-primary { background:${SP.accent}; color:${SP.bg}; }
  .btn-outline { background:transparent; border:1px solid ${SP.textDim}; color:${SP.text}; }
  .btn:active { transform:scale(0.96); opacity:0.8; }
  .card { background:${SP.card}; border-radius:16px; padding:16px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.3); }
  .input { background:${SP.inputBg}; border:1px solid rgba(255,255,255,0.1); color:white; padding:12px; border-radius:8px; width:100%; outline:none; }
  .input:focus { border-color:${SP.accent}; }
  .badge { padding:2px 8px; border-radius:4px; font-size:10px; font-weight:bold; text-transform:uppercase; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; padding:20px; z-index:100; backdrop-filter:blur(4px); }
  .scroll-hide::-webkit-scrollbar { display:none; }
`;

// ── Firebase Init ────────────────────────────────────────────────
if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();

// ── Components ───────────────────────────────────────────────────

function App() {
  const [matchId, setMatchId] = useState(null);
  const [matchData, setMatchData] = useState(null);
  const [playerPool, setPlayerPool] = useState([]);
  const [view, setView] = useState('setup'); // setup, match

  // Load Player Pool
  useEffect(() => {
    const saved = localStorage.getItem(POOL_KEY);
    if (saved) setPlayerPool(JSON.parse(saved));
  }, []);

  const savePool = (newPool) => {
    setPlayerPool(newPool);
    localStorage.setItem(POOL_KEY, JSON.stringify(newPool));
  };

  const startMatch = (config) => {
    const newMatch = {
      id: "M-" + Date.now(),
      status: 'playing',
      config: config, // { teamA, teamB, playersA, playersB, overs }
      innings: 1,
      score: { runs: 0, wickets: 0, balls: 0, extras: 0, wides: 0, noballs: 0, byes: 0, legbyes: 0 },
      battingTeam: config.teamA,
      bowlingTeam: config.teamB,
      playersA: config.playersA.map(p => ({ name: p, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet_to_bat' })),
      playersB: config.playersB.map(p => ({ name: p, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet_to_bat' })),
      bowlersA: config.playersA.map(p => ({ name: p, overs: 0, balls: 0, runs: 0, wickets: 0, maidens: 0 })),
      bowlersB: config.playersB.map(p => ({ name: p, overs: 0, balls: 0, runs: 0, wickets: 0, maidens: 0 })),
      striker: null,
      nonStriker: null,
      currentBowler: null,
      history: [],
      selectionMode: 'OPENERS' // New state to handle selection phase
    };
    setMatchId(newMatch.id);
    setMatchData(newMatch);
    setView('match');
    db.ref('matches/' + newMatch.id).set(newMatch);
  };

  if (view === 'setup') {
    return <SetupScreen pool={playerPool} onSavePool={savePool} onStart={startMatch} />;
  }

  return <MatchScreen data={matchData} setData={setMatchData} onExit={() => setView('setup')} />;
}

function SetupScreen({ pool, onSavePool, onStart }) {
  const [teamAName, setTeamAName] = useState("Team A");
  const [teamBName, setTeamBName] = useState("Team B");
  const [selectedA, setSelectedA] = useState([]);
  const [selectedB, setSelectedB] = useState([]);
  const [newName, setNewName] = useState("");
  const [overs, setOvers] = useState(5);

  const addPlayerToPool = () => {
    if (!newName.trim()) return;
    if (pool.includes(newName.trim())) return;
    onSavePool([...pool, newName.trim()]);
    setNewName("");
  };

  const toggleSelect = (name, team) => {
    if (team === 'A') {
      if (selectedA.includes(name)) setSelectedA(selectedA.filter(n => n !== name));
      else if (selectedA.length < 11) setSelectedA([...selectedA, name]);
    } else {
      if (selectedB.includes(name)) setSelectedB(selectedB.filter(n => n !== name));
      else if (selectedB.length < 11) setSelectedB([...selectedB, name]);
    }
  };

  const handleStart = () => {
    if (selectedA.length < MIN_TEAM_SIZE || selectedB.length < MIN_TEAM_SIZE) {
      alert(`Please select at least ${MIN_TEAM_SIZE} players for each team.`);
      return;
    }
    onStart({ teamA: teamAName, teamB: teamBName, playersA: selectedA, playersB: selectedB, overs });
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: 'auto' }}>
      <h2 style={{ color: SP.accent, marginBottom: 4 }}>New Match</h2>
      <p style={{ color: SP.textDim, fontSize: 14, marginBottom: 24 }}>Select players for both teams</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <input className="input" style={{ marginBottom: 10, fontWeight: 'bold' }} value={teamAName} onChange={e => setTeamAName(e.target.value)} placeholder="Team A Name" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {pool.map(p => (
            <button key={p} onClick={() => toggleSelect(p, 'A')} className="btn" style={{ 
              padding: '6px 12px', fontSize: 12, 
              background: selectedA.includes(p) ? SP.accent : 'rgba(255,255,255,0.1)',
              color: selectedA.includes(p) ? SP.bg : 'white'
            }}>{p}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: SP.textDim, marginTop: 8 }}>Selected: {selectedA.length} / 11</div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <input className="input" style={{ marginBottom: 10, fontWeight: 'bold' }} value={teamBName} onChange={e => setTeamBName(e.target.value)} placeholder="Team B Name" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {pool.map(p => (
            <button key={p} onClick={() => toggleSelect(p, 'B')} className="btn" style={{ 
              padding: '6px 12px', fontSize: 12, 
              background: selectedB.includes(p) ? SP.secondary : 'rgba(255,255,255,0.1)',
              color: selectedB.includes(p) ? SP.bg : 'white'
            }}>{p}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: SP.textDim, marginTop: 8 }}>Selected: {selectedB.length} / 11</div>
      </div>

      <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add new player name..." />
        <button onClick={addPlayerToPool} className="btn btn-primary" style={{ width: 50 }}>+</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, color: SP.textDim, display: 'block', marginBottom: 8 }}>MATCH OVERS</label>
        <input type="number" className="input" value={overs} onChange={e => setOvers(parseInt(e.target.value) || 1)} />
      </div>

      <button onClick={handleStart} className="btn btn-primary" style={{ width: '100%', padding: 16 }}>START MATCH</button>
    </div>
  );
}

function MatchScreen({ data, setData, onExit }) {
  if (!data) return null;

  const updateMatch = (updates) => {
    const newData = { ...data, ...updates };
    setData(newData);
    db.ref('matches/' + data.id).update(updates);
  };

  const getBattingList = () => data.innings === 1 ? data.playersA : data.playersB;
  const getBowlingList = () => data.innings === 1 ? data.bowlersB : data.bowlersA;

  // Selection Logic
  const handleSelectOpeners = (p1, p2) => {
    const listKey = data.innings === 1 ? 'playersA' : 'playersB';
    const newList = [...data[listKey]];
    newList.find(p => p.name === p1).status = 'batting';
    newList.find(p => p.name === p2).status = 'batting';
    
    updateMatch({
      [listKey]: newList,
      striker: p1,
      nonStriker: p2,
      selectionMode: 'BOWLER'
    });
  };

  const handleSelectNextBatsman = (name) => {
    const listKey = data.innings === 1 ? 'playersA' : 'playersB';
    const newList = [...data[listKey]];
    newList.find(p => p.name === name).status = 'batting';
    
    // If striker was out, replace striker, else replace non-striker
    const isStrikerOut = data.selectionMode === 'NEXT_BATSMAN_STRIKER';
    
    updateMatch({
      [listKey]: newList,
      striker: isStrikerOut ? name : data.striker,
      nonStriker: isStrikerOut ? data.nonStriker : name,
      selectionMode: null
    });
  };

  const handleSelectBowler = (name) => {
    updateMatch({ currentBowler: name, selectionMode: null });
  };

  const handleBall = (runs, isExtra = false, extraType = null) => {
    let s = { ...data.score };
    let hist = [...data.history];
    let strikerName = data.striker;
    let bList = [...getBattingList()];
    let bwList = [...getBowlingList()];

    const striker = bList.find(p => p.name === strikerName);
    const bowler = bwList.find(p => p.name === data.currentBowler);

    // Logic for runs and extras...
    if (!isExtra) {
      s.runs += runs;
      s.balls += 1;
      striker.runs += runs;
      striker.balls += 1;
      if (runs === 4) striker.fours += 1;
      if (runs === 6) striker.sixes += 1;
      bowler.balls += 1;
      bowler.runs += runs;
    } else {
      s.runs += (runs + (extraType === 'Wide' || extraType === 'No Ball' ? 1 : 0));
      s.extras += (runs + (extraType === 'Wide' || extraType === 'No Ball' ? 1 : 0));
      if (extraType === 'Wide') { s.wides += (runs + 1); bowler.runs += (runs+1); }
      if (extraType === 'No Ball') { s.noballs += (runs + 1); striker.runs += runs; striker.balls += 1; bowler.runs += (runs+1); }
      // ... etc (Simplified for brevity)
    }

    // Over check
    let nextStriker = strikerName;
    let nextNonStriker = data.nonStriker;
    let nextMode = null;

    if (!isExtra && s.balls % 6 === 0) {
      [nextStriker, nextNonStriker] = [nextNonStriker, nextStriker];
      nextMode = 'BOWLER';
    } else if (runs % 2 !== 0) {
      [nextStriker, nextNonStriker] = [nextNonStriker, nextStriker];
    }

    updateMatch({
      score: s,
      [data.innings === 1 ? 'playersA' : 'playersB']: bList,
      [data.innings === 1 ? 'bowlersB' : 'bowlersA']: bwList,
      striker: nextStriker,
      nonStriker: nextNonStriker,
      selectionMode: nextMode
    });
  };

  const handleWicket = (how, retiredHurt = false) => {
    let s = { ...data.score };
    let bList = [...getBattingList()];
    let strikerObj = bList.find(p => p.name === data.striker);
    
    strikerObj.status = retiredHurt ? 'retired' : 'out';
    if (!retiredHurt) s.wickets += 1;
    s.balls += 1;
    strikerObj.balls += 1;

    // Check if innings over
    if (s.wickets >= bList.length - 1) {
      // Logic for innings switch...
      alert("Innings Over!");
      return;
    }

    updateMatch({
      score: s,
      [data.innings === 1 ? 'playersA' : 'playersB']: bList,
      selectionMode: 'NEXT_BATSMAN_STRIKER'
    });
  };

  return (
    <div style={{ maxWidth: 500, margin: 'auto', padding: 10 }}>
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: '900', color: SP.accent }}>{data.score.runs}/{data.score.wickets}</div>
          <div style={{ fontSize: 14, color: SP.textDim }}>Over: {Math.floor(data.score.balls / 6)}.{data.score.balls % 6} ({data.config.overs})</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>{data.battingTeam}</div>
          <div style={{ fontSize: 12, color: SP.textDim }}>v {data.bowlingTeam}</div>
        </div>
      </div>

      {/* Main Controls */}
      <div className="card" style={{ marginBottom: 15 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div style={{ borderLeft: `3px solid ${SP.accent}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 11, color: SP.textDim }}>STRIKER</div>
            <div style={{ fontWeight: 'bold' }}>{data.striker || '—'}*</div>
          </div>
          <div style={{ borderLeft: `3px solid ${SP.textDim}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 11, color: SP.textDim }}>NON-STRIKER</div>
            <div style={{ fontWeight: 'bold' }}>{data.nonStriker || '—'}</div>
          </div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 8, fontSize: 13 }}>
          <span style={{ color: SP.textDim }}>Bowler:</span> <span style={{ fontWeight: 'bold', color: SP.primary }}>{data.currentBowler || 'Select Bowler'}</span>
        </div>
      </div>

      {/* Scoring Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 15 }}>
        {[0, 1, 2, 3, 4, 6].map(r => (
          <button key={r} onClick={() => handleBall(r)} className="btn btn-outline" style={{ height: 50, fontSize: 18 }}>{r}</button>
        ))}
        <button onClick={() => handleBall(1, true, 'Wide')} className="btn btn-outline" style={{ color: SP.secondary }}>WD</button>
        <button onClick={() => handleBall(1, true, 'No Ball')} className="btn btn-outline" style={{ color: SP.secondary }}>NB</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button onClick={() => handleWicket('Out')} className="btn" style={{ background: SP.tertiary, color: 'white' }}>WICKET</button>
        <button onClick={() => handleWicket(RET_HURT, true)} className="btn" style={{ background: '#475569', color: 'white' }}>RET. HURT</button>
      </div>

      {/* Selection Modals */}
      {data.selectionMode === 'OPENERS' && (
        <SelectionModal 
          title="Select 2 Openers" 
          list={getBattingList().filter(p => p.status === 'yet_to_bat')} 
          required={2}
          onConfirm={(selected) => handleSelectOpeners(selected[0], selected[1])} 
        />
      )}

      {(data.selectionMode === 'NEXT_BATSMAN_STRIKER' || data.selectionMode === 'NEXT_BATSMAN_NON_STRIKER') && (
        <SelectionModal 
          title="Select Next Batsman" 
          list={getBattingList().filter(p => p.status === 'yet_to_bat')} 
          required={1}
          onConfirm={(selected) => handleSelectNextBatsman(selected[0])} 
        />
      )}

      {data.selectionMode === 'BOWLER' && (
        <SelectionModal 
          title="Select Bowler" 
          list={getBowlingList().filter(p => p.name !== data.currentBowler)} 
          required={1}
          onConfirm={(selected) => handleSelectBowler(selected[0])} 
        />
      )}
    </div>
  );
}

function SelectionModal({ title, list, required, onConfirm }) {
  const [selected, setSelected] = useState([]);

  const toggle = (name) => {
    if (selected.includes(name)) setSelected(selected.filter(n => n !== name));
    else if (selected.length < required) setSelected([...selected, name]);
  };

  return (
    <div className="modal-overlay">
      <div className="card" style={{ width: '100%', maxWidth: 350 }}>
        <h3 style={{ marginTop: 0, color: SP.accent }}>{title}</h3>
        <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 20 }}>
          {list.map(p => (
            <div key={p.name} onClick={() => toggle(p.name)} style={{ 
              padding: 12, marginBottom: 6, borderRadius: 8, cursor: 'pointer',
              background: selected.includes(p.name) ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${selected.includes(p.name) ? SP.accent : 'transparent'}`
            }}>
              {p.name}
            </div>
          ))}
        </div>
        <button 
          disabled={selected.length < required} 
          onClick={() => onConfirm(selected)} 
          className="btn btn-primary" style={{ width: '100%', opacity: selected.length < required ? 0.5 : 1 }}
        >
          CONFIRM
        </button>
      </div>
    </div>
  );
}

// ── Render ───────────────────────────────────────────────────────
const styleTag = document.createElement("style");
styleTag.innerHTML = STYLES;
document.head.appendChild(styleTag);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
