// ═══════════════════════════════════════════════════════════════
// Cricket Scorer PWA — Firebase + Undo + Retired Hurt + Name Edit
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

// ── React ────────────────────────────────────────────────────────
const { useState, useEffect, useRef, useCallback } = React;

// ── Constants ────────────────────────────────────────────────────
const EXTRAS    = ["Wide", "No Ball", "Bye", "Leg Bye"];
const HOW_OUT   = ["Bowled", "Caught", "LBW", "Run Out", "Stumped", "Hit Wicket"];
const RET_HURT  = "Retired Hurt";
const LOCAL_KEY = "cricket-v5";
const HIST_KEY  = "cricket-history-v1";
const MAX_HIST  = 30;

// ── Firebase ─────────────────────────────────────────────────────
var _fbApp = null, _fbDB = null;
function initFB() {
  if (_fbApp) return true;
  try {
    _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    _fbDB  = firebase.database();
    return true;
  } catch(e) { console.warn("Firebase:", e); return false; }
}
function genCode() {
  var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
  for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random()*c.length)];
  return s;
}

// ── Factories ────────────────────────────────────────────────────
const mkP = n => ({ name:n||"Player", runs:0, balls:0, fours:0, sixes:0, out:false, retired:false, howOut:"", dismissedBy:"" });
const mkB = n => ({ name:n||"Bowler", overs:0, balls:0, maidens:0, runs:0, wickets:0 });

const blankSetup = () => ({
  step:0, overs:20,
  teamAName:"Team A", teamBName:"Team B",
  teamAPlayers: Array.from({length:11},(_,i)=>"Player "+(i+1)),
  teamBPlayers: Array.from({length:11},(_,i)=>"Player "+(i+1)),
  teamABowlers: Array.from({length:6}, (_,i)=>"Bowler "+(i+1)),
  teamBBowlers: Array.from({length:6}, (_,i)=>"Bowler "+(i+1)),
  teamACount:11, teamBCount:11,
  teamABowlerCount:6, teamBBowlerCount:6,
});

const blankMatch = (setup, code) => ({
  matchCode: code, createdAt: Date.now(),
  totalOvers: setup.overs,
  batting:0, striker:0,
  currentBatsmen:[0,1], currentBowler:0,
  runs:[0,0], wickets:[0,0], overs:[0,0], balls:[0,0],
  extras:[0,0],
  extrasBreakdown:[{wide:0,noBall:0,bye:0,legBye:0},{wide:0,noBall:0,bye:0,legBye:0}],
  ballLog:[[],[]],
  inningsOver:[false,false],
  numPlayers:[setup.teamACount||11, setup.teamBCount||11],
  teamA:{ name:setup.teamAName||"Team A",
    players:setup.teamAPlayers.slice(0,setup.teamACount||11).map(n=>mkP(n)),
    bowlers:setup.teamABowlers.slice(0,setup.teamABowlerCount||6).map(n=>mkB(n)) },
  teamB:{ name:setup.teamBName||"Team B",
    players:setup.teamBPlayers.slice(0,setup.teamBCount||11).map(n=>mkP(n)),
    bowlers:setup.teamBBowlers.slice(0,setup.teamBBowlerCount||6).map(n=>mkB(n)) },
});

// ── Helpers ──────────────────────────────────────────────────────
const srFn  = p => (!p||p.balls===0)?"-":((p.runs/p.balls)*100).toFixed(1);
const ecoFn = b => { var o=b.overs+b.balls/6; return o===0?"-":(b.runs/o).toFixed(2); };
const bBg   = b => b.retired?"#0891b2":b.wicket?"#ef4444":b.r===6?"#f59e0b":b.r===4?"#3b82f6":b.extra?"#7c3aed":"#334155";
const bTxt  = b => b.retired?"RH":b.wicket?"W":b.extra?(b.r+b.extra[0]):String(b.r);
// Max wickets before innings ends = numPlayers (last man bats alone, innings ends when last man out)
const maxWkts = (m, bt) => (m.numPlayers ? m.numPlayers[bt] : 11);
// Check if 2nd innings chase is won
const chaseWon = (m) => m.batting===1 && m.runs[1] > m.runs[0];

// ── EditModal — top-level so it never remounts on App re-render ──
function EditModal({editing, editVal, setEditVal, onCommit, onCancel}) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (editing && inputRef.current) {
      setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 30);
    }
  }, [editing]);
  if (!editing) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={onCancel}>
      <div style={{background:"#1e293b",borderRadius:16,padding:24,width:"100%",maxWidth:340,border:"1px solid #334155"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{color:"#94a3b8",fontSize:11,letterSpacing:2,marginBottom:12}}>
          EDIT {editing.type==="player"?"BATTER":"BOWLER"} NAME
        </div>
        <input
          ref={inputRef}
          value={editVal}
          onChange={e=>setEditVal(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")onCommit();if(e.key==="Escape")onCancel();}}
          style={{width:"100%",background:"#0f172a",border:"2px solid #fbbf24",borderRadius:10,padding:"12px 14px",color:"#f1f5f9",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif",marginBottom:14}}
        />
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel}
            style={{flex:1,padding:"11px 0",background:"#0f172a",border:"1px solid #334155",borderRadius:10,color:"#94a3b8",fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14}}>
            Cancel
          </button>
          <button onClick={onCommit}
            style={{flex:2,padding:"11px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14}}>
            ✓ Save Name
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PendingExtraModal — pick runs after Wide or No Ball ──────────
function PendingExtraModal({extra, onConfirm, onCancel}) {
  if (!extra) return null;
  var isNB = extra==="No Ball";
  // For No Ball: show 0-6 for batter runs (total = batter + 1 penalty)
  // For Wide: show 1-7 (all extras)
  var runs = isNB ? [0,1,2,3,4,5,6] : [1,2,3,4,5,6,7];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#1e293b",borderRadius:16,padding:22,width:"100%",maxWidth:340,border:"1px solid #334155"}}>
        <div style={{color:"#a78bfa",fontSize:11,letterSpacing:2,marginBottom:4}}>{extra.toUpperCase()}</div>
        <div style={{color:"#f1f5f9",fontSize:15,marginBottom:16}}>
          {isNB ? "How many runs did the batter score?" : "How many wides were called?"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:16}}>
          {runs.map(r=>(
            <button key={r} onClick={()=>onConfirm(r)}
              style={{padding:"14px 0",borderRadius:10,border:r===4?"2px solid #3b82f6":r===6?"2px solid #f59e0b":"1px solid #4c1d95",background:r===4?"rgba(59,130,246,.12)":r===6?"rgba(245,158,11,.12)":"rgba(109,40,217,.12)",color:r===4?"#60a5fa":r===6?"#fbbf24":"#a78bfa",fontWeight:"bold",fontSize:18,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              {r}
            </button>
          ))}
        </div>
        {isNB && <div style={{color:"#64748b",fontSize:11,marginBottom:14,textAlign:"center"}}>+1 penalty run added automatically</div>}
        <button onClick={onCancel}
          style={{width:"100%",padding:"10px 0",background:"#0f172a",border:"1px solid #334155",borderRadius:10,color:"#94a3b8",fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── RecallPromptModal — offer to bring back retired hurt players ──
function RecallPromptModal({match, onRecall, onDecline}) {
  if (!match) return null;
  var bt = match.batting;
  var bTeam = bt===0 ? match.teamA : match.teamB;
  var retiredPlayers = bTeam.players.map((p,i)=>({...p,i})).filter(p=>p.retired);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#1e293b",borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid #0e7490",borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:28,marginBottom:6}}>🩹</div>
          <div style={{color:"#67e8f9",fontSize:14,fontWeight:"bold",letterSpacing:1,marginBottom:4}}>LAST WICKET FALLEN</div>
          <div style={{color:"#94a3b8",fontSize:13}}>Retired hurt player(s) can come back to bat</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {retiredPlayers.map(p=>(
            <button key={p.i} onClick={()=>onRecall(p.i)}
              style={{padding:"13px 16px",borderRadius:12,border:"1px solid #0e7490",background:"rgba(8,145,178,.12)",color:"#67e8f9",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:"bold"}}>{p.name}</span>
              <span style={{color:"#0891b2",fontSize:12}}>{p.runs} runs off {p.balls} balls · Recall →</span>
            </button>
          ))}
        </div>
        <button onClick={onDecline}
          style={{width:"100%",padding:"12px 0",background:"#0f172a",border:"1px solid #7f1d1d",borderRadius:12,color:"#fca5a5",fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14}}>
          End Innings
        </button>
      </div>
    </div>
  );
}

// ── OverCompleteModal — must pick new bowler after each over ──────
function OverCompleteModal({match, onSelect}) {
  if (!match) return null;
  var bt = match.batting;
  var wTeam = bt===0 ? match.teamB : match.teamA;
  var prevBowler = match.currentBowler;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0 0"}}>
      <div style={{background:"#1e293b",borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid #334155",borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{color:"#fbbf24",fontSize:13,fontWeight:"bold",letterSpacing:2,marginBottom:4}}>OVER COMPLETE</div>
          <div style={{color:"#94a3b8",fontSize:13}}>Select the next bowler</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {wTeam.bowlers.map((b,i)=>{
            var isPrev = i===prevBowler;
            return (
              <button key={i} onClick={()=>!isPrev&&onSelect(i)} disabled={isPrev}
                style={{padding:"13px 16px",borderRadius:12,border:isPrev?"1px solid #1e293b":"1px solid #334155",background:isPrev?"#0f172a":"#0f172a",color:isPrev?"#334155":"#e2e8f0",fontSize:15,cursor:isPrev?"not-allowed":"pointer",fontFamily:"Georgia,serif",display:"flex",justifyContent:"space-between",alignItems:"center",opacity:isPrev?0.4:1}}>
                <span>{b.name}</span>
                <span style={{color:"#475569",fontSize:12}}>{b.overs}.{b.balls} ov · {b.runs} runs · {b.wickets}w {isPrev?"· (just bowled)":""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────
const S = {
  card:  { margin:"0 0 10px", background:"#1e293b", borderRadius:14, padding:"14px 16px", border:"1px solid #334155" },
  lbl:   { color:"#475569", fontSize:10, marginBottom:10, letterSpacing:2, textTransform:"uppercase" },
  btnSm: { background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", padding:"6px 11px",
           borderRadius:8, cursor:"pointer", fontSize:12, fontFamily:"Georgia,serif", whiteSpace:"nowrap" },
  page:  { minHeight:"100dvh", background:"#0c1220", fontFamily:"Georgia,serif", paddingBottom:40 },
  wrap:  { maxWidth:480, margin:"0 auto" },
};

// ════════════════════════════════════════════════════════════════
// ── AdminPanel — live index management + history clear ────────────
function AdminPanel({matchHistory, setMatchHistory, onDone}) {
  const [liveEntries, setLiveEntries] = React.useState(null); // null=not loaded
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  function loadLiveIndex() {
    if (!_fbDB) { setMsg("Firebase not connected"); return; }
    setLoading(true); setMsg("");
    _fbDB.ref("liveIndex").once("value", snap => {
      var val = snap.val();
      setLiveEntries(val ? Object.values(val) : []);
      setLoading(false);
    }, err => { setMsg("Error: "+err.message); setLoading(false); });
  }

  function deleteEntry(code) {
    if (!_fbDB) return;
    _fbDB.ref("liveIndex/"+code).remove()
      .then(()=>{ setLiveEntries(e=>e.filter(x=>x.code!==code)); setMsg("Removed "+code); })
      .catch(err=>setMsg("Error: "+err.message));
  }

  function clearAllLive() {
    if (!_fbDB || !confirm("Remove all live index entries?")) return;
    _fbDB.ref("liveIndex").remove()
      .then(()=>{ setLiveEntries([]); setMsg("Live index cleared"); })
      .catch(err=>setMsg("Error: "+err.message));
  }

  function fmtAge(ts) {
    if (!ts) return "unknown age";
    var mins = Math.round((Date.now()-ts)/60000);
    if (mins < 60) return mins+"m ago";
    return Math.round(mins/60)+"h ago";
  }

  return (
    <div style={{paddingBottom:24}}>
      <div style={{color:"#4ade80",fontSize:13,marginBottom:20,textAlign:"center"}}>✓ Authenticated</div>

      {/* Local match history */}
      <div style={{background:"#1e293b",borderRadius:14,padding:18,border:"1px solid #334155",marginBottom:12}}>
        <div style={{color:"#94a3b8",fontSize:13,marginBottom:12}}>
          Local Match History: <b style={{color:"#e2e8f0"}}>{matchHistory.length} matches</b>
        </div>
        <button onClick={()=>{
          if(confirm("Permanently delete all local match history?")) {
            localStorage.removeItem(HIST_KEY);
            setMatchHistory([]);
            setMsg("Local history cleared");
          }
        }}
          style={{width:"100%",padding:"11px 0",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:10,color:"#fca5a5",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
          🗑 Clear All Local History
        </button>
      </div>

      {/* Firebase live index */}
      <div style={{background:"#1e293b",borderRadius:14,padding:18,border:"1px solid #334155",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{color:"#94a3b8",fontSize:13}}>🔴 Live Index (Firebase)</div>
          <button onClick={loadLiveIndex} disabled={loading}
            style={{padding:"5px 12px",background:"transparent",border:"1px solid #334155",borderRadius:8,color:"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            {loading?"…":liveEntries===null?"Load":"Refresh"}
          </button>
        </div>
        {liveEntries===null&&!loading&&(
          <div style={{color:"#475569",fontSize:12,textAlign:"center",padding:"8px 0"}}>Tap Load to fetch from Firebase</div>
        )}
        {liveEntries!==null&&liveEntries.length===0&&(
          <div style={{color:"#475569",fontSize:12,textAlign:"center",padding:"8px 0"}}>No entries in live index</div>
        )}
        {liveEntries!==null&&liveEntries.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {liveEntries.map(e=>(
              <div key={e.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0f172a",borderRadius:10,padding:"10px 12px",border:"1px solid #334155"}}>
                <div>
                  <div style={{color:"#e2e8f0",fontSize:13}}>{e.teamA} vs {e.teamB}</div>
                  <div style={{color:"#475569",fontSize:11}}>{e.code} · {fmtAge(e.updatedAt||e.createdAt)}</div>
                </div>
                <button onClick={()=>deleteEntry(e.code)}
                  style={{padding:"6px 12px",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:8,color:"#fca5a5",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                  Remove
                </button>
              </div>
            ))}
            <button onClick={clearAllLive}
              style={{width:"100%",padding:"10px 0",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:10,color:"#fca5a5",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",marginTop:4}}>
              🗑 Clear All Live Entries
            </button>
          </div>
        )}
      </div>

      {msg&&<div style={{color:"#4ade80",fontSize:12,textAlign:"center",marginBottom:12}}>{msg}</div>}

      <button onClick={onDone}
        style={{width:"100%",padding:"11px 0",background:"transparent",border:"1px solid #334155",borderRadius:10,color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
        Done
      </button>
    </div>
  );
}

function App() {
  const [screen,    setScreen]   = useState("home");
  const [setup,     setSetup]    = useState(blankSetup);
  const [match,     setMatch]    = useState(null);
  const [history,   setHistory]  = useState([]);
  const [fbReady,   setFbReady]  = useState(false);
  const [syncing,   setSyncing]  = useState(false);

  const [isViewer,  setIsViewer] = useState(false);
  // Inline editing state
  const [editing,   setEditing]  = useState(null);
  const [editVal,   setEditVal]  = useState("");
  // Pending extra: waiting for batter runs after Wide/No Ball
  const [pendingExtra, setPendingExtra] = useState(null); // "Wide" | "No Ball"
  // Over complete: waiting for new bowler selection
  const [overComplete, setOverComplete] = useState(false);
  // Recall prompt: retired hurt players available when last batter falls
  const [recallPrompt, setRecallPrompt] = useState(false);
  // Match history
  const [matchHistory, setMatchHistory] = useState([]);
  // Admin
  const [adminPin, setAdminPin] = useState("");
  // Live matches list for viewer
  const [liveMatches, setLiveMatches] = useState(null); // null=not loaded, []=empty
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError,   setLiveError]   = useState("");
  const listRef = useRef(null);

  // Init Firebase
  useEffect(() => { setFbReady(initFB()); }, []);

  // Load match history
  useEffect(() => {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      if (raw) setMatchHistory(JSON.parse(raw));
    } catch(e) {}
  }, []);

  // Restore saved match
  useEffect(() => {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.match) {
        setMatch(d.match);
        setIsViewer(!!d.isViewer);
        setScreen(d.isViewer ? "viewer" : "match");
        if (d.isViewer && d.match.matchCode) attachListener(d.match.matchCode);
      }
    } catch(e) {}
  }, []);

  // Show bowler picker whenever an over completes
  useEffect(() => {
    if (match && match.needsBowler && !isViewer) {
      setOverComplete(true);
    }
  }, [match ? match.needsBowler : null]);

  // Show recall prompt when retired players available after last wicket
  useEffect(() => {
    if (match && match.needsRecall && !isViewer) {
      setRecallPrompt(true);
    }
  }, [match ? match.needsRecall : null]);

  // Persist locally
  useEffect(() => {
    try {
      if (match) localStorage.setItem(LOCAL_KEY, JSON.stringify({match, isViewer}));
      else localStorage.removeItem(LOCAL_KEY);
    } catch(e) {}
  }, [match, isViewer]);

  // Sync to Firebase (scorer only)
  useEffect(() => {
    if (!match || isViewer || !fbReady || !match.matchCode || match.matchCode==="LOCAL") return;
    setSyncing(true);
    var code = match.matchCode;
    // Write full match data
    _fbDB.ref("matches/"+code).set(match)
      .then(()=>setSyncing(false))
      .catch(()=>setSyncing(false));
    // Write/update live index entry (small summary for listing)
    var bothOver = match.inningsOver && match.inningsOver[0] && match.inningsOver[1];
    if (bothOver) {
      // Remove from live index when match is complete
      _fbDB.ref("liveIndex/"+code).remove();
    } else {
      var bt = match.batting||0;
      _fbDB.ref("liveIndex/"+code).set({
        code,
        teamA: match.teamA.name,
        teamB: match.teamB.name,
        runs:  match.runs,
        wickets: match.wickets,
        overs: match.overs,
        balls: match.balls,
        batting: bt,
        totalOvers: match.totalOvers,
        inningsOver: match.inningsOver,
        createdAt: match.createdAt,
        updatedAt: Date.now(),
      });
    }
  }, [match]);

  function attachListener(code) {
    if (listRef.current) listRef.current.off();
    if (!_fbDB) return;
    var ref = _fbDB.ref("matches/"+code);
    listRef.current = ref;
    ref.on("value", snap => {
      var v = snap.val();
      if (v) { setMatch(v); setIsViewer(true); setScreen("viewer"); }
    }, err => console.warn("FB listener error:", err.message));
  }

  function detach() { if (listRef.current) { listRef.current.off(); listRef.current=null; } }

  // ── Match start ──────────────────────────────────────────────
  function startMatch() {
    var code = fbReady ? genCode() : "LOCAL";
    var m = blankMatch(setup, code);
    setMatch(m);
    setHistory([]);
    setIsViewer(false);
    setScreen("match");
    // Immediately register in liveIndex so it appears in viewer list
    if (fbReady && code !== "LOCAL" && _fbDB) {
      _fbDB.ref("liveIndex/"+code).set({
        code,
        teamA: m.teamA.name,
        teamB: m.teamB.name,
        runs: m.runs,
        wickets: m.wickets,
        overs: m.overs,
        balls: m.balls,
        batting: 0,
        totalOvers: m.totalOvers,
        inningsOver: m.inningsOver,
        createdAt: m.createdAt,
        updatedAt: Date.now(),
      });
    }
  }

  function saveToHistory(m) {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var hist = raw ? JSON.parse(raw) : [];
      var entry = {
        id: Date.now(),
        date: new Date().toISOString(),
        teamA: m.teamA.name, teamB: m.teamB.name,
        runsA: m.runs[0], wicketsA: m.wickets[0], oversA: m.overs[0], ballsA: m.balls[0],
        runsB: m.runs[1], wicketsB: m.wickets[1], oversB: m.overs[1], ballsB: m.balls[1],
        totalOvers: m.totalOvers,
        snapshot: m
      };
      hist.unshift(entry); // newest first
      if (hist.length > 50) hist = hist.slice(0, 50);
      localStorage.setItem(HIST_KEY, JSON.stringify(hist));
      setMatchHistory(hist);
    } catch(e) {}
  }

  function resetAll() {
    if (!confirm("Start a new match? This will clear everything.")) return;
    detach();
    setMatch(null); setHistory([]); setSetup(blankSetup());
    setIsViewer(false); setScreen("home");
  }

  function fetchLiveMatches() {
    var db = _fbDB;
    if (!db) {
      var ok = initFB();
      db = _fbDB;
      if (!ok || !db) { setLiveError("Firebase not connected — check your internet connection"); return; }
    }
    setLoadingLive(true);
    setLiveError("");
    db.ref("liveIndex").once("value", snap => {
      var val = snap.val();
      if (!val) { setLiveMatches([]); setLoadingLive(false); return; }
      var now = Date.now();
      var list = Object.values(val).filter(m => {
        var fresh = !m.createdAt || (now - m.createdAt) < 24*60*60*1000;
        var ongoing = !(m.inningsOver && m.inningsOver[0] && m.inningsOver[1]);
        return fresh && ongoing && m.teamA && m.teamB && m.code;
      });
      list.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
      setLiveMatches(list);
      setLoadingLive(false);
    }, err => {
      setLiveError("Permission denied — add this to Firebase rules:\n liveIndex: { \".read\": true, \".write\": true }");
      setLoadingLive(false);
    });
  }

  function joinByCode(code) {
    if (!fbReady) return;
    attachListener(code);
  }

  // ── History / Undo ───────────────────────────────────────────
  function pushHist(m) {
    setHistory(h => {
      var next = h.concat([JSON.parse(JSON.stringify(m))]);
      return next.length > MAX_HIST ? next.slice(next.length-MAX_HIST) : next;
    });
  }
  function undo() {
    if (!history.length) return;
    setMatch(history[history.length-1]);
    setHistory(h => h.slice(0,-1));
  }

  // ── Runtime name editing ─────────────────────────────────────
  function startEdit(team, type, idx, currentName) {
    setEditVal(currentName);
    setEditing({team, type, idx});
  }

  function confirmExtra(batterRuns) {
    var ex = pendingExtra;
    setPendingExtra(null);
    if (ex==="No Ball") {
      addRuns(batterRuns + 1, "No Ball"); // total = batter runs + 1 penalty
    } else {
      addRuns(batterRuns, "Wide"); // total wides
    }
  }

  function selectNewBowler(i) {
    setMatch(m=>({...m, currentBowler:i, needsBowler:false}));
    setOverComplete(false);
  }
  function commitEdit() {
    if (!editing || !match) { setEditing(null); return; }
    var newName = editVal.trim() || (editing.type==="player"?"Player":"Bowler");
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      var teamKey = editing.team==="A" ? "teamA" : "teamB";
      if (editing.type==="player") m[teamKey].players[editing.idx].name = newName;
      else                         m[teamKey].bowlers[editing.idx].name = newName;
      return m;
    });
    setEditing(null);
  }
  function cancelEdit() { setEditing(null); }

  // ── Scoring ──────────────────────────────────────────────────
  function addRuns(r, extra) {
    extra = extra || null;
    setMatch(prev => {
      pushHist(prev);
      var m = JSON.parse(JSON.stringify(prev));
      m.needsBowler = false;
      var bt=m.batting, b1=m.currentBatsmen[m.striker], bi=m.currentBowler;
      var bT=bt===0?m.teamA:m.teamB, wT=bt===0?m.teamB:m.teamA;
      var dead = extra==="Wide"||extra==="No Ball";

      m.runs[bt]+=r;
      if (!extra) {
        bT.players[b1].runs+=r; bT.players[b1].balls++;
        if(r===4)bT.players[b1].fours++; if(r===6)bT.players[b1].sixes++;
        wT.bowlers[bi].runs+=r;
      } else if (extra==="No Ball") {
        m.extrasBreakdown[bt].noBall+=1;
        m.extras[bt]+=1;
        var batterRuns = r - 1;
        if (batterRuns > 0) {
          bT.players[b1].runs+=batterRuns;
          if(batterRuns===4)bT.players[b1].fours++;
          if(batterRuns===6)bT.players[b1].sixes++;
        }
        bT.players[b1].balls++;
        wT.bowlers[bi].runs+=r;
      } else if (extra==="Wide") {
        m.extrasBreakdown[bt].wide+=r;
        m.extras[bt]+=r;
        wT.bowlers[bi].runs+=r;
      } else if (extra==="Bye") {
        m.extrasBreakdown[bt].bye+=r;
        m.extras[bt]+=r;
        bT.players[b1].balls++;
        wT.bowlers[bi].runs+=r;
      } else if (extra==="Leg Bye") {
        m.extrasBreakdown[bt].legBye+=r;
        m.extras[bt]+=r;
        bT.players[b1].balls++;
        wT.bowlers[bi].runs+=r;
      }

      m.ballLog[bt].push({r, extra});

      if (!dead) {
        m.balls[bt]++; wT.bowlers[bi].balls++;
        if (m.balls[bt]===6) {
          m.overs[bt]++; m.balls[bt]=0;
          wT.bowlers[bi].overs++; wT.bowlers[bi].balls=0;
          m.striker=1-m.striker;
          if (!(m.overs[bt]>=m.totalOvers||m.wickets[bt]>=maxWkts(m,bt)||chaseWon(m))) m.needsBowler = true;
        }
        if (r%2!==0) m.striker=1-m.striker;
      } else if (extra==="No Ball") {
        var br2 = r - 1;
        if (br2%2!==0) m.striker=1-m.striker;
      }

      if (chaseWon(m) || m.overs[bt]>=m.totalOvers || m.wickets[bt]>=maxWkts(m,bt)) m.inningsOver[bt]=true;
      return m;
    });
  }

  function addWicket(how) {
    setMatch(prev => {
      pushHist(prev);
      var m = JSON.parse(JSON.stringify(prev));
      m.needsBowler = false;
      var bt=m.batting, b1=m.currentBatsmen[m.striker], bi=m.currentBowler;
      var bT=bt===0?m.teamA:m.teamB, wT=bt===0?m.teamB:m.teamA;
      bT.players[b1].out=false; bT.players[b1].retired=true; bT.players[b1].howOut=how;
      if (how===RET_HURT) {
        m.ballLog[bt].push({r:0,retired:true});
        var inUse = [m.currentBatsmen[0], m.currentBatsmen[1]];
        var nextRH = -1;
        for (var pi=0; pi<bT.players.length; pi++) {
          if (!bT.players[pi].out && !bT.players[pi].retired && inUse.indexOf(pi)===-1) { nextRH=pi; break; }
        }
        if (nextRH !== -1) m.currentBatsmen[m.striker] = nextRH;
        return m;
      }
      bT.players[b1].out=true; bT.players[b1].retired=false;
      bT.players[b1].balls++;
      bT.players[b1].dismissedBy = wT.bowlers[bi].name;
      wT.bowlers[bi].wickets++; wT.bowlers[bi].balls++;
      m.wickets[bt]++; m.balls[bt]++;
      if (m.balls[bt]===6) {
        m.overs[bt]++; m.balls[bt]=0;
        wT.bowlers[bi].overs++; wT.bowlers[bi].balls=0;
        if (!(m.wickets[bt]>=maxWkts(m,bt)||m.overs[bt]>=m.totalOvers||chaseWon(m))) m.needsBowler = true;
      }
      m.ballLog[bt].push({r:0,wicket:how});
      // Find next available batter (not out, not retired, not currently at crease)
      var inUse2 = [m.currentBatsmen[0], m.currentBatsmen[1]];
      var nextBatter = -1;
      for (var ni=0; ni<bT.players.length; ni++) {
        if (!bT.players[ni].out && !bT.players[ni].retired && inUse2.indexOf(ni)===-1) { nextBatter=ni; break; }
      }
      if (nextBatter !== -1) m.currentBatsmen[m.striker] = nextBatter;
      var noMoreBatters = nextBatter === -1;
      var hasRetired = bT.players.some(p=>p.retired);
      var mx = maxWkts(m, bt);
      // Innings over when all wickets gone
      var inningsNowOver = m.wickets[bt] >= mx;
      // Last man: penultimate wicket just fell — new batter bats alone
      var isLastManIn = !inningsNowOver && noMoreBatters && !hasRetired;
      if (isLastManIn) {
        // Point both slots at the surviving batter so they bat alone
        m.currentBatsmen[m.striker] = m.currentBatsmen[1-m.striker];
      }
      if (chaseWon(m) || m.overs[bt]>=m.totalOvers || inningsNowOver) {
        m.inningsOver[bt]=true;
      } else if (noMoreBatters && !isLastManIn) {
        if (hasRetired) {
          m.needsRecall = true;
        } else {
          m.inningsOver[bt]=true;
        }
      }
      return m;
    });
  }

  function recallRetired(playerIdx) {
    setMatch(prev => {
      pushHist(prev);
      var m = JSON.parse(JSON.stringify(prev));
      var bt = m.batting;
      var bT = bt===0 ? m.teamA : m.teamB;
      bT.players[playerIdx].retired = false;
      bT.players[playerIdx].howOut = "";
      m.currentBatsmen[m.striker] = playerIdx;
      m.needsRecall = false;
      return m;
    });
    setRecallPrompt(false);
  }

  function declineRecall() {
    // No retired player recalled — end the innings
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      m.inningsOver[m.batting] = true;
      m.needsRecall = false;
      return m;
    });
    setRecallPrompt(false);
  }


  if (screen==="home") return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(170deg,#0c1828,#0f172a)",display:"flex",flexDirection:"column",alignItems:"center",padding:"28px 16px 40px",fontFamily:"Georgia,serif",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:52}}>🏏</div>
          <h1 style={{color:"#fbbf24",fontSize:24,fontWeight:"bold",letterSpacing:3,margin:"10px 0 4px",textTransform:"uppercase"}}>Cricket Scorer</h1>
          <p style={{color:"#475569",fontSize:11,letterSpacing:2,margin:0}}>LIVE MATCH BROADCASTING</p>
          <div style={{marginTop:10}}>
            {fbReady
              ? <span style={{color:"#4ade80",fontSize:12}}>● Firebase connected</span>
              : <span style={{color:"#f59e0b",fontSize:12}}>⚠ Firebase offline</span>}
          </div>
        </div>

        {/* Create */}
        <div style={{background:"#1e293b",borderRadius:20,padding:24,border:"1px solid #334155",marginBottom:14,boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
          <div style={{color:"#64748b",fontSize:11,letterSpacing:2,marginBottom:8}}>SCORE A MATCH</div>
          <p style={{color:"#64748b",fontSize:13,marginBottom:16,lineHeight:1.6}}>
            Create a new match and score it live. {fbReady?"Viewers can find it in the live matches list.":"Firebase will sync when connected."}
          </p>
          <button onClick={()=>setScreen("setup")}
            style={{width:"100%",padding:"14px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",letterSpacing:1,fontFamily:"Georgia,serif"}}>
            🏏 Create New Match
          </button>
        </div>

        {/* History button */}
        {matchHistory.length > 0 && (
          <button onClick={()=>setScreen("history")}
            style={{width:"100%",marginBottom:14,padding:"12px 0",background:"transparent",border:"1px solid #334155",borderRadius:12,color:"#64748b",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:1}}>
            📚 Match History ({matchHistory.length})
          </button>
        )}

        {/* Watch Live */}
        <div style={{background:"#1e293b",borderRadius:20,padding:24,border:"1px solid #334155",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{color:"#64748b",fontSize:11,letterSpacing:2}}>WATCH LIVE</div>
            {liveMatches!==null&&(
              <button onClick={fetchLiveMatches} disabled={loadingLive}
                style={{padding:"5px 12px",background:"transparent",border:"1px solid #334155",borderRadius:8,color:"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                {loadingLive?"…":"🔄 Refresh"}
              </button>
            )}
          </div>
          {liveMatches===null&&(
            <button onClick={fetchLiveMatches} disabled={loadingLive}
              style={{width:"100%",padding:"13px 0",background:"linear-gradient(135deg,#1d4ed8,#1e40af)",borderRadius:12,border:"none",color:"#fff",fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              {loadingLive?"🔍 Searching…":"📡 Show Live Matches"}
            </button>
          )}
          {liveError&&(
            <div style={{background:"rgba(239,68,68,.1)",border:"1px solid #7f1d1d",borderRadius:10,padding:"10px 14px",marginTop:8}}>
              <div style={{color:"#fca5a5",fontSize:12,marginBottom:6}}>{liveError}</div>
              <div style={{color:"#64748b",fontSize:11}}>Check your Firebase rules allow reading <code style={{color:"#94a3b8"}}>liveIndex</code>:</div>
              <pre style={{color:"#4ade80",fontSize:10,marginTop:6,overflowX:"auto"}}>{"liveIndex: { \".read\": true, \".write\": true }"}</pre>
            </div>
          )}
          {liveMatches!==null&&liveMatches.length===0&&!loadingLive&&(
            <div style={{textAlign:"center",color:"#475569",fontSize:13,padding:"14px 0"}}>No live matches right now</div>
          )}
          {loadingLive&&liveMatches!==null&&(
            <div style={{textAlign:"center",color:"#475569",fontSize:13,padding:"10px 0"}}>Refreshing…</div>
          )}
          {liveMatches!==null&&liveMatches.length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {liveMatches.map(m=>{
                var bt=m.batting||0;
                var bName=bt===0?m.teamA:m.teamB;
                var r=(m.runs&&m.runs[bt])||0, w=(m.wickets&&m.wickets[bt])||0;
                var ov=(m.overs&&m.overs[bt])||0, bl=(m.balls&&m.balls[bt])||0;
                var inn1Done=m.inningsOver&&m.inningsOver[0];
                return (
                  <button key={m.code} onClick={()=>joinByCode(m.code)}
                    style={{width:"100%",background:"#0f172a",border:"1px solid #1d4ed8",borderRadius:12,padding:"12px 14px",cursor:"pointer",textAlign:"left",fontFamily:"Georgia,serif"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{color:"#ef4444",fontSize:11,fontWeight:"bold"}}>● LIVE</span>
                      <span style={{color:"#475569",fontSize:11}}>{m.totalOvers} overs</span>
                    </div>
                    <div style={{color:"#94a3b8",fontSize:12,marginBottom:6}}>{m.teamA} vs {m.teamB}</div>
                    {inn1Done&&<div style={{color:"#64748b",fontSize:11,marginBottom:2}}>{m.teamA}: {(m.runs&&m.runs[0])||0}/{(m.wickets&&m.wickets[0])||0}</div>}
                    <div style={{color:"#fbbf24",fontWeight:"bold",fontSize:16}}>{bName}: {r}/{w} <span style={{color:"#475569",fontSize:12,fontWeight:"normal"}}>({ov}.{bl} ov)</span></div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{textAlign:"center",marginTop:18}}>
          <button onClick={()=>setScreen("admin")}
            style={{background:"none",border:"none",color:"#1e293b",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            ···
          </button>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // HISTORY LIST
  if (screen==="history") {
    function fmtDate(iso) {
      var d = new Date(iso);
      return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
    }
    function matchResult(e) {
      if (!e.snapshot.inningsOver[1]) return "Incomplete";
      if (e.runsB > e.runsA) return e.teamB+" won";
      if (e.runsA > e.runsB) return e.teamA+" won";
      return "Tied";
    }
    function resultColor(e) {
      if (!e.snapshot.inningsOver[1]) return "#fbbf24";
      return "#86efac";
    }
    return (
      <div style={S.page}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>📚 MATCH HISTORY</h2>
            <button onClick={()=>setScreen("home")} style={S.btnSm}>← Back</button>
          </div>
          {matchHistory.length===0 ? (
            <div style={{textAlign:"center",color:"#475569",padding:40}}>No matches saved yet</div>
          ) : matchHistory.map((e)=>(
            <div key={e.id} onClick={()=>{setMatch(e.snapshot);setScreen("historycard");}}
              style={{background:"#1e293b",borderRadius:14,padding:"14px 16px",marginBottom:10,border:"1px solid #334155",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{color:"#94a3b8",fontSize:11}}>{fmtDate(e.date)}</div>
                <div style={{color:resultColor(e),fontSize:11,fontWeight:"bold"}}>{matchResult(e)}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"#e2e8f0",fontSize:14,fontWeight:"bold"}}>{e.teamA}</div>
                  <div style={{color:"#fbbf24",fontSize:16,fontWeight:"bold"}}>{e.runsA}/{e.wicketsA} <span style={{color:"#475569",fontSize:12}}>({e.oversA}.{e.ballsA})</span></div>
                </div>
                <div style={{color:"#475569",fontSize:13,fontWeight:"bold"}}>vs</div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:"#e2e8f0",fontSize:14,fontWeight:"bold"}}>{e.teamB}</div>
                  <div style={{color:"#fbbf24",fontSize:16,fontWeight:"bold"}}>{e.runsB}/{e.wicketsB} <span style={{color:"#475569",fontSize:12}}>({e.oversB}.{e.ballsB})</span></div>
                </div>
              </div>
            </div>
          ))}
          {matchHistory.length > 0 && (
            <button onClick={()=>setScreen("admin")}
              style={{width:"100%",marginTop:4,marginBottom:20,padding:"10px 0",background:"transparent",border:"1px solid #475569",borderRadius:10,color:"#64748b",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              🔒 Admin — Manage History
            </button>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // HISTORY SCORECARD
  if (screen==="historycard" && match) {
    function TCardH({team,inn,opp}) {
      return (
        <div style={{marginBottom:20}}>
          <div style={{background:"#1e293b",borderRadius:16,overflow:"hidden",border:"1px solid #334155"}}>
            <div style={{background:"#0f172a",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:15}}>{team.name}</span>
              <span style={{color:"#e2e8f0",fontWeight:"bold"}}>{match.runs[inn]}/{match.wickets[inn]} <span style={{color:"#475569",fontSize:12}}>({match.overs[inn]}.{match.balls[inn]})</span></span>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Batter","R","B","4s","6s","SR"].map(h=><th key={h} style={{padding:"5px 7px",color:"#475569",fontSize:11,textAlign:h==="Batter"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {team.players.filter(p=>p.balls>0||p.out||p.retired).map((p,pi)=>(
                  <tr key={pi} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",minWidth:110}}>
                      <div style={{color:p.out?"#64748b":p.retired?"#67e8f9":"#e2e8f0",fontSize:13}}>{p.name}</div>
                      {p.out&&<div style={{color:"#475569",fontSize:10}}>
                        {p.howOut==="Bowled"?`b ${p.dismissedBy}`:
                         p.howOut==="Caught"?`c & b ${p.dismissedBy}`:
                         p.howOut==="LBW"?`lbw b ${p.dismissedBy}`:
                         p.howOut==="Stumped"?`st b ${p.dismissedBy}`:
                         p.howOut==="Hit Wicket"?`hit wkt b ${p.dismissedBy}`:
                         p.howOut==="Run Out"?`run out`:p.howOut}
                      </div>}
                      {p.retired&&<div style={{color:"#0891b2",fontSize:10}}>Retired Hurt</div>}
                    </td>
                    <td style={{textAlign:"center",color:"#fbbf24",fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{p.runs}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{p.balls}</td>
                    <td style={{textAlign:"center",color:"#60a5fa",fontSize:13,padding:"7px 4px"}}>{p.fours}</td>
                    <td style={{textAlign:"center",color:"#f59e0b",fontSize:13,padding:"7px 4px"}}>{p.sixes}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:12,padding:"7px 4px"}}>{srFn(p)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"1px solid #334155"}}>
                  <td colSpan="6" style={{padding:"6px 8px"}}>
                    <span style={{color:"#94a3b8",fontSize:12}}>Extras: <b style={{color:"#e2e8f0"}}>{match.extras[inn]}</b></span>
                    <span style={{color:"#475569",fontSize:11,marginLeft:8}}>W:{match.extrasBreakdown[inn].wide} NB:{match.extrasBreakdown[inn].noBall} B:{match.extrasBreakdown[inn].bye} LB:{match.extrasBreakdown[inn].legBye}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={{width:"100%",borderCollapse:"collapse",borderTop:"2px solid #334155"}}>
              <thead><tr>{["Bowler","O","M","R","W","Eco"].map(h=><th key={h} style={{padding:"5px 7px",color:"#475569",fontSize:11,textAlign:h==="Bowler"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {opp.bowlers.filter(b=>b.overs>0||b.balls>0).map((b,bi)=>(
                  <tr key={bi} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",color:"#e2e8f0",fontSize:13,minWidth:110}}>{b.name}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.overs}.{b.balls}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.maidens}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.runs}</td>
                    <td style={{textAlign:"center",color:"#ef4444",fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{b.wickets}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:12,padding:"7px 4px"}}>{ecoFn(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div style={S.page}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>📋 SCORECARD</h2>
            <button onClick={()=>{setMatch(null);setScreen("history");}} style={S.btnSm}>← Back</button>
          </div>
          <TCardH team={match.teamA} inn={0} opp={match.teamB}/>
          {match.inningsOver[0]&&<TCardH team={match.teamB} inn={1} opp={match.teamA}/>}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // ADMIN
  if (screen==="admin") {
    const ADMIN_PIN = "1989";
    var pinOk = adminPin===ADMIN_PIN;
    return (
      <div style={S.page}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>🔒 ADMIN</h2>
            <button onClick={()=>{setScreen("home");setAdminPin("");}} style={S.btnSm}>← Back</button>
          </div>
          {!pinOk ? (
            <div style={{background:"#1e293b",borderRadius:14,padding:24,border:"1px solid #334155",textAlign:"center"}}>
              <div style={{color:"#94a3b8",fontSize:13,marginBottom:16}}>Enter admin PIN to continue</div>
              <input
                type="password" maxLength={8} value={adminPin}
                onChange={e=>setAdminPin(e.target.value)}
                placeholder="PIN"
                style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"14px",color:"#fbbf24",fontSize:24,textAlign:"center",outline:"none",boxSizing:"border-box",fontFamily:"monospace",letterSpacing:8}}
              />
              {adminPin.length>0&&!pinOk&&<div style={{color:"#f87171",fontSize:12,marginTop:10}}>Incorrect PIN</div>}
            </div>
          ) : (
            <AdminPanel matchHistory={matchHistory} setMatchHistory={setMatchHistory} onDone={()=>{setScreen("home");setAdminPin("");}}/>
          )}
        </div>
      </div>
    );
  }

  if (screen==="setup") {
    var s=setup;
    var STEPS=["Match Details",s.teamAName+" — Batters",s.teamAName+" — Bowlers",s.teamBName+" — Batters",s.teamBName+" — Bowlers"];
    function NList({names,ph,onUp,min,max}) {
      function addOne() { if(names.length<max) onUp([...names, ph+" "+(names.length+1)]); }
      function removeOne() { if(names.length>min) onUp(names.slice(0,-1)); }
      return (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <span style={{color:"#64748b",fontSize:11,letterSpacing:1}}>{names.length} {ph.toLowerCase()}s</span>
            <div style={{display:"flex",gap:6}}>
              <button onClick={removeOne} disabled={names.length<=min}
                style={{width:32,height:32,borderRadius:8,border:"1px solid #334155",background:"#0f172a",color:names.length<=min?"#1e293b":"#94a3b8",fontSize:20,cursor:names.length<=min?"not-allowed":"pointer",fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
              <button onClick={addOne} disabled={names.length>=max}
                style={{width:32,height:32,borderRadius:8,border:"1px solid #334155",background:"#0f172a",color:names.length>=max?"#1e293b":"#fbbf24",fontSize:20,cursor:names.length>=max?"not-allowed":"pointer",fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"46vh",overflowY:"auto"}}>
            {names.map((nm,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{color:"#475569",fontSize:13,minWidth:22,textAlign:"right"}}>{i+1}.</span>
                <input value={nm} placeholder={ph+" "+(i+1)}
                  onChange={e=>{var u=[...names];u[i]=e.target.value;onUp(u);}}
                  style={{flex:1,background:"#0f172a",border:"1px solid #334155",borderRadius:9,padding:"10px 12px",color:"#f1f5f9",fontSize:15,outline:"none",fontFamily:"Georgia,serif"}}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div style={{minHeight:"100dvh",background:"linear-gradient(170deg,#0c1828,#0f172a)",display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 16px 40px",fontFamily:"Georgia,serif"}}>
        <div style={{width:"100%",maxWidth:420}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
            <button onClick={()=>setScreen("home")} style={S.btnSm}>← Home</button>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#475569",fontSize:11}}>STEP {s.step+1}/{STEPS.length}</span>
                <span style={{color:"#fbbf24",fontSize:11}}>{STEPS[s.step]}</span>
              </div>
              <div style={{height:3,background:"#1e293b",borderRadius:2}}>
                <div style={{height:"100%",width:(s.step/(STEPS.length-1)*100)+"%",background:"linear-gradient(90deg,#fbbf24,#d97706)",borderRadius:2,transition:"width .3s"}}/>
              </div>
            </div>
          </div>
          <div style={{background:"#1e293b",borderRadius:20,padding:22,border:"1px solid #334155",boxShadow:"0 20px 60px rgba(0,0,0,.6)"}}>
            {s.step===0&&(
              <div>
                {[["TEAM 1 NAME","teamAName"],["TEAM 2 NAME","teamBName"]].map(([lbl,key])=>(
                  <div key={key} style={{marginBottom:14}}>
                    <label style={{color:"#64748b",fontSize:11,display:"block",marginBottom:6,letterSpacing:1}}>{lbl}</label>
                    <input value={s[key]} onChange={e=>{var v=e.target.value;setSetup(p=>({...p,[key]:v}));}}
                      style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"12px 14px",color:"#f1f5f9",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}
                    />
                  </div>
                ))}
                <label style={{color:"#64748b",fontSize:11,display:"block",marginBottom:10,letterSpacing:1}}>OVERS PER INNINGS</label>
                <div style={{display:"flex",alignItems:"center",gap:0,background:"#0f172a",borderRadius:12,border:"1px solid #334155",overflow:"hidden"}}>
                  <button
                    onClick={()=>setSetup(p=>({...p,overs:Math.max(1,p.overs-1)}))}
                    style={{width:48,height:52,background:"transparent",border:"none",color:"#94a3b8",fontSize:24,cursor:"pointer",fontFamily:"Georgia,serif",flexShrink:0,borderRight:"1px solid #334155"}}>
                    −
                  </button>
                  <input
                    type="number" min="1" max="100"
                    value={s.overs}
                    onChange={e=>{
                      var v=parseInt(e.target.value,10);
                      if(!isNaN(v)&&v>=1&&v<=100) setSetup(p=>({...p,overs:v}));
                      else if(e.target.value==="") setSetup(p=>({...p,overs:1}));
                    }}
                    style={{flex:1,background:"transparent",border:"none",color:"#fbbf24",fontSize:26,fontWeight:"bold",textAlign:"center",outline:"none",fontFamily:"Georgia,serif",padding:"0 4px"}}
                  />
                  <button
                    onClick={()=>setSetup(p=>({...p,overs:Math.min(100,p.overs+1)}))}
                    style={{width:48,height:52,background:"transparent",border:"none",color:"#94a3b8",fontSize:24,cursor:"pointer",fontFamily:"Georgia,serif",flexShrink:0,borderLeft:"1px solid #334155"}}>
                    +
                  </button>
                </div>
                <div style={{display:"flex",gap:6,marginTop:10}}>
                  {[5,10,20,50].map(o=>(
                    <button key={o} onClick={()=>setSetup(p=>({...p,overs:o}))}
                      style={{flex:1,padding:"8px 0",borderRadius:8,border:s.overs===o?"1px solid #fbbf24":"1px solid #334155",background:s.overs===o?"rgba(251,191,36,.12)":"transparent",color:s.overs===o?"#fbbf24":"#475569",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {s.step===1&&<NList names={s.teamAPlayers} ph="Player" min={2} max={11} onUp={v=>setSetup(p=>({...p,teamAPlayers:v,teamACount:v.length}))}/>}
            {s.step===2&&<NList names={s.teamABowlers} ph="Bowler" min={1} max={6}  onUp={v=>setSetup(p=>({...p,teamABowlers:v,teamABowlerCount:v.length}))}/>}
            {s.step===3&&<NList names={s.teamBPlayers} ph="Player" min={2} max={11} onUp={v=>setSetup(p=>({...p,teamBPlayers:v,teamBCount:v.length}))}/>}
            {s.step===4&&<NList names={s.teamBBowlers} ph="Bowler" min={1} max={6}  onUp={v=>setSetup(p=>({...p,teamBBowlers:v,teamBBowlerCount:v.length}))}/>}
            <div style={{display:"flex",gap:10,marginTop:22}}>
              {s.step>0&&<button onClick={()=>setSetup(p=>({...p,step:p.step-1}))}
                style={{flex:1,padding:"13px 0",background:"#0f172a",border:"1px solid #334155",borderRadius:12,color:"#94a3b8",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>← Back</button>}
              {s.step<STEPS.length-1
                ?<button onClick={()=>setSetup(p=>({...p,step:p.step+1}))}
                  style={{flex:2,padding:"13px 0",background:"linear-gradient(135deg,#1d4ed8,#1e40af)",borderRadius:12,border:"none",color:"#fff",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>Next →</button>
                :<button onClick={startMatch}
                  style={{flex:2,padding:"13px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:1}}>▶ Start Match</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!match) return null;

  // ── Derived match values ──────────────────────────────────────
  var bt       = match.batting;
  var bTeam    = bt===0?match.teamA:match.teamB;
  var wTeam    = bt===0?match.teamB:match.teamA;
  var bTeamKey = bt===0?"A":"B";
  var wTeamKey = bt===0?"B":"A";
  var striker    = bTeam.players[match.currentBatsmen[match.striker]];
  var nonStriker = bTeam.players[match.currentBatsmen[1-match.striker]];
  var bowler     = wTeam.bowlers[match.currentBowler];
  var target     = bt===1?match.runs[0]+1:null;
  var needed     = target?target-match.runs[1]:null;
  var ballsLeft  = (match.totalOvers-match.overs[bt])*6-match.balls[bt];
  var lastBalls  = match.ballLog[bt].slice(-12);

  // ── Shared UI blocks ──────────────────────────────────────────
  function ScoreHeader() {
    return (
      <div style={{margin:"10px 12px",background:"linear-gradient(135deg,#0f2d5a,#1a1a3e)",borderRadius:18,padding:"16px 18px",border:"1px solid rgba(29,78,216,.25)"}}>
        {match.matchCode&&match.matchCode!=="LOCAL"&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{color:"#475569",fontSize:10,letterSpacing:2}}>{isViewer?"🔴 LIVE":"📡 BROADCASTING"}</span>
            <div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.35)",borderRadius:8,padding:"4px 12px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{color:"#64748b",fontSize:10}}>CODE</span>
              <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:18,fontFamily:"monospace",letterSpacing:4}}>{match.matchCode}</span>
            </div>
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:target?10:0}}>
          <div>
            <div style={{color:"#60a5fa",fontSize:10,letterSpacing:2,marginBottom:4}}>BATTING</div>
            <div style={{color:"#fbbf24",fontWeight:"bold",fontSize:18}}>{bTeam.name}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{color:"#f1f5f9",fontSize:34,fontWeight:"bold",lineHeight:1}}>
              {match.runs[bt]}<span style={{color:"#475569",fontSize:22}}>/{match.wickets[bt]}</span>
            </div>
            <div style={{color:"#64748b",fontSize:13,marginTop:2}}>{match.overs[bt]}.{match.balls[bt]} / {match.totalOvers} ov</div>
          </div>
        </div>
        {target&&(
          <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:10,padding:"8px 14px",display:"flex",gap:16}}>
            <span style={{color:"#fca5a5",fontSize:13}}>Target: <b style={{color:"#fbbf24"}}>{target}</b></span>
            <span style={{color:"#fca5a5",fontSize:13}}>Need: <b style={{color:"#f1f5f9"}}>{needed}</b> off <b style={{color:"#f1f5f9"}}>{ballsLeft}</b> balls</span>
          </div>
        )}
      </div>
    );
  }

  // Batter card — edit icon appears on each row
  function BatterCard({editable}) {
    return (
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={S.lbl}>BATTERS</span>
          {editable&&<span style={{color:"#475569",fontSize:10}}>✏ tap name to edit</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 32px 32px 32px 32px 44px",gap:4,marginBottom:6}}>
          {["NAME","R","B","4s","6s","SR"].map(h=><span key={h} style={{color:"#334155",fontSize:10,textAlign:h==="NAME"?"left":"center"}}>{h}</span>)}
        </div>
        {[
          {p:striker,    si:match.currentBatsmen[match.striker],   isStriker:true},
          {p:nonStriker && match.currentBatsmen[0]!==match.currentBatsmen[1] ? nonStriker : null, si:match.currentBatsmen[1-match.striker], isStriker:false},
        ].map(({p,si,isStriker})=> p&&(
          <div key={si} style={{display:"grid",gridTemplateColumns:"1fr 32px 32px 32px 32px 44px",gap:4,padding:"7px 0",borderTop:"1px solid #0f172a",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden"}}>
              <span style={{fontSize:13,flexShrink:0}}>{isStriker?"🏏":"   "}</span>
              {editable
                ? <span onClick={()=>startEdit(bTeamKey,"player",si,p.name)}
                    style={{color:isStriker?"#f1f5f9":"#94a3b8",fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",borderBottom:"1px dashed #475569"}}>
                    {p.name}
                  </span>
                : <span style={{color:isStriker?"#f1f5f9":"#94a3b8",fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>}
            </div>
            <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:15,textAlign:"center"}}>{p.runs}</span>
            <span style={{color:"#94a3b8",fontSize:13,textAlign:"center"}}>{p.balls}</span>
            <span style={{color:"#60a5fa",fontSize:13,textAlign:"center"}}>{p.fours}</span>
            <span style={{color:"#f59e0b",fontSize:13,textAlign:"center"}}>{p.sixes}</span>
            <span style={{color:"#94a3b8",fontSize:12,textAlign:"center"}}>{srFn(p)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Bowler card — edit on bowler name
  function BowlerCard({editable}) {
    return (
      <div style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"#475569",fontSize:10,marginBottom:3,letterSpacing:1}}>BOWLING — {wTeam.name}</div>
          {editable
            ? <span onClick={()=>startEdit(wTeamKey,"bowler",match.currentBowler,bowler.name)}
                style={{color:"#e2e8f0",fontSize:15,cursor:"pointer",borderBottom:"1px dashed #475569"}}>
                {bowler?bowler.name:""}
              </span>
            : <span style={{color:"#e2e8f0",fontSize:15}}>{bowler?bowler.name:""}</span>}
        </div>
        <div style={{display:"flex",gap:14,flexShrink:0}}>
          {bowler&&[["O",bowler.overs+"."+bowler.balls],["R",bowler.runs],["W",bowler.wickets]].map(([l,v])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{color:"#475569",fontSize:10}}>{l}</div>
              <div style={{color:l==="W"?"#ef4444":"#e2e8f0",fontWeight:"bold",fontSize:16}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function BallLog() {
    if (!lastBalls.length) return null;
    return (
      <div style={{marginBottom:10,display:"flex",gap:6,flexWrap:"wrap"}}>
        {lastBalls.map((b,i)=>(
          <div key={i} style={{width:36,height:36,borderRadius:"50%",background:bBg(b),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:"bold"}}>
            {bTxt(b)}
          </div>
        ))}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // VIEWER
  if (screen==="viewer") return (
    <div style={S.page}>
      <EditModal editing={editing} editVal={editVal} setEditVal={setEditVal} onCommit={commitEdit} onCancel={cancelEdit}/>
      <div style={S.wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px 0"}}>
          <span style={{color:"#ef4444",fontSize:13}}>● LIVE</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setScreen("scorecard")} style={S.btnSm}>📋 Scorecard</button>
            <button onClick={()=>{
              if(confirm("Take over scoring? The previous scorer will lose control.")) {
                setIsViewer(false);
                setScreen("match");
              }
            }} style={{...S.btnSm,borderColor:"#d97706",color:"#fbbf24"}}>🏏 Score</button>
            <button onClick={resetAll} style={S.btnSm}>✕ Leave</button>
          </div>
        </div>
        <ScoreHeader/>
        <div style={{padding:"0 12px"}}>
          <BatterCard editable={false}/>
          <BowlerCard editable={false}/>
          <BallLog/>
        </div>
        {match.inningsOver[0]&&bt===0&&(
          <div style={{margin:"0 12px 12px",background:"#14532d",borderRadius:14,padding:18,textAlign:"center",border:"1px solid #16a34a"}}>
            <div style={{color:"#86efac",fontWeight:"bold",fontSize:15}}>1st Innings Complete</div>
            <div style={{color:"#e2e8f0",fontSize:13,marginTop:4}}>{match.teamA.name}: {match.runs[0]}/{match.wickets[0]}</div>
          </div>
        )}
        {match.inningsOver[1]&&bt===1&&(
          <div style={{margin:"0 12px 12px",background:"linear-gradient(135deg,#0f2d5a,#1a1a3e)",borderRadius:14,padding:20,textAlign:"center",border:"1px solid #1d4ed8"}}>
            <div style={{fontSize:30,marginBottom:6}}>🏆</div>
            <div style={{color:"#fbbf24",fontWeight:"bold",fontSize:18,marginBottom:4}}>Match Over!</div>
            {match.runs[1]>match.runs[0]?<div style={{color:"#86efac",fontSize:14}}>{match.teamB.name} wins by {10-match.wickets[1]} wickets!</div>
             :match.runs[1]<match.runs[0]?<div style={{color:"#fca5a5",fontSize:14}}>{match.teamA.name} wins by {match.runs[0]-match.runs[1]} runs!</div>
             :<div style={{color:"#fbbf24",fontSize:14}}>Match Tied!</div>}
          </div>
        )}
        <div style={{textAlign:"center",padding:"14px 0",color:"#334155",fontSize:11}}>Updates every ball automatically</div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // SCORECARD
  if (screen==="scorecard") {
    var prev = isViewer?"viewer":"match";
    function TCard({team,inn,opp}) {
      return (
        <div style={{marginBottom:20}}>
          <div style={{background:"#1e293b",borderRadius:16,overflow:"hidden",border:"1px solid #334155"}}>
            <div style={{background:"#0f172a",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:15}}>{team.name}</span>
              <span style={{color:"#e2e8f0",fontWeight:"bold"}}>{match.runs[inn]}/{match.wickets[inn]} <span style={{color:"#475569",fontSize:12}}>({match.overs[inn]}.{match.balls[inn]})</span></span>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Batter","R","B","4s","6s","SR"].map(h=><th key={h} style={{padding:"5px 7px",color:"#475569",fontSize:11,textAlign:h==="Batter"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {team.players.filter(p=>p.balls>0||p.out||p.retired).map((p,i)=>(
                  <tr key={i} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",minWidth:110}}>
                      <div style={{color:p.out?"#64748b":p.retired?"#67e8f9":"#e2e8f0",fontSize:13}}>{p.name}</div>
                      {p.out&&<div style={{color:"#475569",fontSize:10}}>
                        {p.howOut==="Bowled"   ? `b ${p.dismissedBy}` :
                         p.howOut==="Caught"   ? `c & b ${p.dismissedBy}` :
                         p.howOut==="LBW"      ? `lbw b ${p.dismissedBy}` :
                         p.howOut==="Stumped"  ? `st b ${p.dismissedBy}` :
                         p.howOut==="Hit Wicket"? `hit wkt b ${p.dismissedBy}` :
                         p.howOut==="Run Out"  ? `run out` :
                         p.howOut}
                      </div>}
                      {p.retired&&<div style={{color:"#0891b2",fontSize:10}}>Retired Hurt</div>}
                    </td>
                    <td style={{textAlign:"center",color:"#fbbf24",fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{p.runs}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{p.balls}</td>
                    <td style={{textAlign:"center",color:"#60a5fa",fontSize:13,padding:"7px 4px"}}>{p.fours}</td>
                    <td style={{textAlign:"center",color:"#f59e0b",fontSize:13,padding:"7px 4px"}}>{p.sixes}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:12,padding:"7px 4px"}}>{srFn(p)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"1px solid #334155"}}>
                  <td colSpan="6" style={{padding:"6px 8px"}}>
                    <span style={{color:"#94a3b8",fontSize:12}}>Extras: <b style={{color:"#e2e8f0"}}>{match.extras[inn]}</b></span>
                    <span style={{color:"#475569",fontSize:11,marginLeft:8}}>W:{match.extrasBreakdown[inn].wide} NB:{match.extrasBreakdown[inn].noBall} B:{match.extrasBreakdown[inn].bye} LB:{match.extrasBreakdown[inn].legBye}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={{width:"100%",borderCollapse:"collapse",borderTop:"2px solid #334155"}}>
              <thead><tr>{["Bowler","O","M","R","W","Eco"].map(h=><th key={h} style={{padding:"5px 7px",color:"#475569",fontSize:11,textAlign:h==="Bowler"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {opp.bowlers.filter(b=>b.overs>0||b.balls>0).map((b,i)=>(
                  <tr key={i} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",color:"#e2e8f0",fontSize:13,minWidth:110}}>{b.name}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.overs}.{b.balls}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.maidens}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:13,padding:"7px 4px"}}>{b.runs}</td>
                    <td style={{textAlign:"center",color:"#ef4444",fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{b.wickets}</td>
                    <td style={{textAlign:"center",color:"#94a3b8",fontSize:12,padding:"7px 4px"}}>{ecoFn(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div style={S.page}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>📋 SCORECARD</h2>
            <button onClick={()=>setScreen(prev)} style={S.btnSm}>← Back</button>
          </div>
          <TCard team={match.teamA} inn={0} opp={match.teamB}/>
          {(match.batting===1||match.inningsOver[0])&&<TCard team={match.teamB} inn={1} opp={match.teamA}/>}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // SCORER / MATCH SCREEN
  return (
    <div style={S.page}>
      <EditModal editing={editing} editVal={editVal} setEditVal={setEditVal} onCommit={commitEdit} onCancel={cancelEdit}/>
      <PendingExtraModal extra={pendingExtra} onConfirm={confirmExtra} onCancel={()=>setPendingExtra(null)}/>
      {overComplete && <OverCompleteModal match={match} onSelect={selectNewBowler}/>}
      {recallPrompt && <RecallPromptModal match={match} onRecall={recallRetired} onDecline={declineRecall}/>}
      <div style={S.wrap}>

        {/* Top bar */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px 0",gap:6}}>
          <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:13,letterSpacing:1,flexShrink:0}}>
            🏏 SCORER
            {syncing&&<span style={{color:"#60a5fa",fontSize:10,marginLeft:6}}>↑ sync</span>}
          </span>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <button onClick={undo} disabled={!history.length}
              style={{...S.btnSm,opacity:history.length?1:0.3,color:"#fb923c",borderColor:history.length?"#fb923c":"#334155"}}>
              ↩ Undo
            </button>
            <button onClick={()=>setScreen("scorecard")} style={S.btnSm}>📋</button>
            <button onClick={resetAll} style={S.btnSm}>🔄 New</button>
          </div>
        </div>

        <ScoreHeader/>

        <div style={{padding:"0 12px"}}>
          <BatterCard editable={true}/>
          <BowlerCard editable={true}/>
          <BallLog/>
        </div>

        {/* Innings done */}
        {match.inningsOver[0]&&bt===0&&(
          <div style={{margin:"0 12px 12px",background:"#14532d",borderRadius:14,padding:20,textAlign:"center",border:"1px solid #16a34a"}}>
            <div style={{color:"#86efac",fontWeight:"bold",fontSize:16,marginBottom:6}}>Innings Complete!</div>
            <div style={{color:"#e2e8f0",fontSize:14,marginBottom:14}}>{match.teamA.name}: {match.runs[0]}/{match.wickets[0]}</div>
            <button onClick={()=>setMatch(m=>({...m,batting:1,currentBatsmen:[0,1],currentBowler:0,striker:0}))}
              style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:10,padding:"12px 28px",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              Start 2nd Innings →
            </button>
          </div>
        )}

        {/* Match over */}
        {match.inningsOver[1]&&bt===1&&(
          <div style={{margin:"0 12px 12px",background:"linear-gradient(135deg,#0f2d5a,#1a1a3e)",borderRadius:14,padding:20,textAlign:"center",border:"1px solid #1d4ed8"}}>
            <div style={{fontSize:30,marginBottom:6}}>🏆</div>
            <div style={{color:"#fbbf24",fontWeight:"bold",fontSize:18,marginBottom:6}}>Match Over!</div>
            {match.runs[1]>match.runs[0]?<div style={{color:"#86efac",fontSize:14}}>{match.teamB.name} wins by {10-match.wickets[1]} wickets!</div>
             :match.runs[1]<match.runs[0]?<div style={{color:"#fca5a5",fontSize:14}}>{match.teamA.name} wins by {match.runs[0]-match.runs[1]} runs!</div>
             :<div style={{color:"#fbbf24",fontSize:14}}>Match Tied!</div>}
            <button onClick={()=>{saveToHistory(match);resetAll();}}
              style={{marginTop:14,padding:"10px 24px",background:"#fbbf24",color:"#0f172a",border:"none",borderRadius:10,fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              Save & New Match
            </button>
          </div>
        )}

        {/* Scoring buttons */}
        {!match.inningsOver[bt]&&(
          <div style={{padding:"0 12px"}}>

            {/* RUNS */}
            <div style={S.card}>
              <div style={S.lbl}>RUNS</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
                {[0,1,2,3,4,5,6].map(r=>(
                  <button key={r} onClick={()=>addRuns(r)}
                    style={{padding:"14px 0",borderRadius:10,border:r===4?"2px solid #3b82f6":r===6?"2px solid #f59e0b":"1px solid #334155",background:r===4?"rgba(59,130,246,.12)":r===6?"rgba(245,158,11,.12)":"#0f172a",color:r===4?"#60a5fa":r===6?"#fbbf24":"#e2e8f0",fontWeight:"bold",fontSize:18,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif"}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* EXTRAS */}
            <div style={S.card}>
              <div style={S.lbl}>EXTRAS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                {["Wide","No Ball"].map(ex=>(
                  <button key={ex} onClick={()=>setPendingExtra(ex)}
                    style={{padding:"12px 0",borderRadius:10,border:"1px solid #4c1d95",background:"rgba(109,40,217,.12)",color:"#a78bfa",fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif"}}>
                    {ex} ›
                  </button>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {["Bye","Leg Bye"].map(ex=>(
                  <button key={ex} onClick={()=>addRuns(1,ex)}
                    style={{padding:"12px 0",borderRadius:10,border:"1px solid #334155",background:"rgba(51,65,85,.3)",color:"#94a3b8",fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif"}}>
                    {ex} +1
                  </button>
                ))}
              </div>
            </div>

            {/* WICKET */}
            <div style={S.card}>
              <div style={S.lbl}>WICKET</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                {HOW_OUT.map(how=>(
                  <button key={how} onClick={()=>addWicket(how)}
                    style={{padding:"12px 0",borderRadius:10,border:"1px solid #7f1d1d",background:"rgba(127,29,29,.2)",color:"#fca5a5",fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif"}}>
                    {how}
                  </button>
                ))}
                {/* Retired Hurt — full width, distinct teal */}
                <button onClick={()=>addWicket(RET_HURT)}
                  style={{padding:"13px 0",borderRadius:10,border:"2px solid #0e7490",background:"rgba(8,145,178,.18)",color:"#67e8f9",fontWeight:"bold",fontSize:13,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif",gridColumn:"span 3",marginTop:4}}>
                  🩹 Retired Hurt
                </button>
              </div>
              {/* Recall retired players */}
              {bTeam.players.some(p=>p.retired) && (
                <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1e3a5a"}}>
                  <div style={{color:"#0891b2",fontSize:10,letterSpacing:2,marginBottom:8}}>RECALL RETIRED</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {bTeam.players.map((p,i)=>p.retired?(
                      <button key={i} onClick={()=>recallRetired(i)}
                        style={{padding:"10px 14px",borderRadius:10,border:"1px solid #0e7490",background:"rgba(8,145,178,.1)",color:"#67e8f9",fontWeight:"bold",fontSize:13,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span>{p.name}</span>
                        <span style={{color:"#0891b2",fontSize:11}}>{p.runs} runs · recall →</span>
                      </button>
                    ):null)}
                  </div>
                </div>
              )}
            </div>

            {/* CHANGE BOWLER */}
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={S.lbl}>CHANGE BOWLER</span>
                <span style={{color:"#475569",fontSize:10}}>✏ tap name to edit</span>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {wTeam.bowlers.map((b,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:0}}>
                    <button onClick={()=>setMatch(m=>({...m,currentBowler:i}))}
                      style={{padding:"8px 10px",borderRadius:"8px 0 0 8px",border:match.currentBowler===i?"2px solid #fbbf24":"1px solid #334155",borderRight:"none",background:match.currentBowler===i?"rgba(251,191,36,.12)":"#0f172a",color:match.currentBowler===i?"#fbbf24":"#64748b",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Georgia,serif"}}>
                      {b.name}
                    </button>
                    <button onClick={()=>startEdit(wTeamKey,"bowler",i,b.name)}
                      title="Edit name"
                      style={{padding:"8px 7px",borderRadius:"0 8px 8px 0",border:match.currentBowler===i?"2px solid #fbbf24":"1px solid #334155",borderLeft:"1px solid #334155",background:match.currentBowler===i?"rgba(251,191,36,.08)":"#0f172a",color:"#475569",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                      ✏
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* END INNINGS */}
            <div style={{marginTop:4,marginBottom:8}}>
              <button onClick={()=>{if(confirm("End innings now?"))setMatch(m=>{var n={...m};n.inningsOver=[...m.inningsOver];n.inningsOver[m.batting]=true;return n;})}}
                style={{width:"100%",padding:"11px 0",borderRadius:12,border:"1px solid #475569",background:"transparent",color:"#64748b",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:1}}>
                ⏹ End Innings
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(React.createElement(App));
