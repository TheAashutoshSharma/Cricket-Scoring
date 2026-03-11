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
const ADMIN_EMAILS = [
  "aashutosh.sharma@live.in",
  "aashuitdude@gmail.com",
  "aashutosh22@gmail.com",
];

// ── Firebase ─────────────────────────────────────────────────────
var _fbApp = null, _fbDB = null, _fbAuth = null;
function initFB() {
  if (_fbApp) return true;
  try {
    _fbApp  = firebase.initializeApp(FIREBASE_CONFIG);
    _fbDB   = firebase.database();
    _fbAuth = firebase.auth();
    return true;
  } catch(e) { console.warn("Firebase:", e); return false; }
}
function getAuth() { return _fbAuth; }
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
  teamAPlayerIds:[], teamBPlayerIds:[],
  teamABowlerIds:[], teamBBowlerIds:[],
});

const blankMatch = (setup, code) => {
  var aPIds  = setup.teamAPlayerIds  || [];
  var bPIds  = setup.teamBPlayerIds  || [];
  var aBIds  = setup.teamABowlerIds  || [];
  var bBIds  = setup.teamBBowlerIds  || [];
  var aPlayers = setup.teamAPlayers.slice(0,setup.teamACount||11).map((n,i)=>({...mkP(n), playerId: aPIds[i]||null}));
  var aBowlers = setup.teamABowlers.slice(0,setup.teamABowlerCount||6).map((n,i)=>({...mkB(n), playerId: aBIds[i]||null}));
  var bPlayers = setup.teamBPlayers.slice(0,setup.teamBCount||11).map((n,i)=>({...mkP(n), playerId: bPIds[i]||null}));
  var bBowlers = setup.teamBBowlers.slice(0,setup.teamBBowlerCount||6).map((n,i)=>({...mkB(n), playerId: bBIds[i]||null}));
  return {
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
    teamA:{ name:setup.teamAName||"Team A", players:aPlayers, bowlers:aBowlers },
    teamB:{ name:setup.teamBName||"Team B", players:bPlayers, bowlers:bBowlers },
  };
};

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

// ── NextBatterModal — pick the next batsman after wicket/retirement ──
function NextBatterModal({match, onSelect}) {
  if (!match) return null;
  var bt = match.batting;
  var bTeam = bt===0 ? match.teamA : match.teamB;
  var inUse = new Set(match.currentBatsmen);
  // Players available: not out, not retired, not currently at crease
  var available = bTeam.players.map((p,i)=>({...p,i})).filter(p=>!p.out && !p.retired && !inUse.has(p.i));
  var lastOut = bTeam.players[match.currentBatsmen[match.striker]];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#1e293b",borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid #334155",borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:26,marginBottom:6}}>🏏</div>
          <div style={{color:"#fbbf24",fontSize:14,fontWeight:"bold",letterSpacing:1,marginBottom:4}}>NEXT BATSMAN IN</div>
          {lastOut && (
            <div style={{color:"#64748b",fontSize:12,marginBottom:2}}>
              {lastOut.name} — {lastOut.out ? lastOut.howOut : "Retired"} · {lastOut.runs} ({lastOut.balls})
            </div>
          )}
          <div style={{color:"#94a3b8",fontSize:13}}>Select who comes in next</div>
        </div>
        {available.length === 0 ? (
          <div style={{color:"#475569",fontSize:13,textAlign:"center",padding:16}}>No batters available</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"50vh",overflowY:"auto"}}>
            {available.map(p=>{
              var sr = p.balls>0 ? ((p.runs/p.balls)*100).toFixed(0) : null;
              return (
                <button key={p.i} onClick={()=>onSelect(p.i)}
                  style={{padding:"13px 16px",borderRadius:12,border:"1px solid #334155",background:"#0f172a",color:"#e2e8f0",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                  <div>
                    <div style={{fontWeight:"bold",marginBottom:2}}>{p.name}</div>
                    {p.balls > 0 && <div style={{color:"#475569",fontSize:11}}>{p.runs} runs · {p.balls} balls · SR {sr}</div>}
                    {p.balls === 0 && <div style={{color:"#475569",fontSize:11}}>Yet to bat</div>}
                  </div>
                  <span style={{color:"#fbbf24",fontSize:18}}>→</span>
                </button>
              );
            })}
          </div>
        )}
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
function AdminPanel({matchHistory, setMatchHistory, onDone, currentUser}) {
  const [liveEntries,  setLiveEntries]  = React.useState(null);
  const [userMatches,  setUserMatches]  = React.useState(null); // {uid: {name, email, matches:[]}}
  const [loading,      setLoading]      = React.useState(false);
  const [loadingUM,    setLoadingUM]    = React.useState(false);
  const [msg,          setMsg]          = React.useState("");
  const [expandedUser, setExpandedUser] = React.useState(null);

  function loadLiveIndex() {
    if (!_fbDB) { setMsg("Firebase not connected"); return; }
    setLoading(true); setMsg("");
    _fbDB.ref("liveIndex").once("value", snap => {
      var val = snap.val();
      setLiveEntries(val ? Object.values(val) : []);
      setLoading(false);
    }, err => { setMsg("Error: "+err.message); setLoading(false); });
  }

  function loadUserMatches() {
    if (!_fbDB) { setMsg("Firebase not connected"); return; }
    setLoadingUM(true); setMsg("");
    Promise.all([
      _fbDB.ref("userMatches").once("value"),
      _fbDB.ref("users").once("value"),
    ]).then(([umSnap, usersSnap]) => {
      var umVal    = umSnap.val()    || {};
      var usersVal = usersSnap.val() || {};
      console.log("userMatches raw:", JSON.stringify(umVal));
      console.log("users raw:", JSON.stringify(usersVal));
      var grouped = {};
      Object.entries(umVal).forEach(([uid, matchMap]) => {
        if (!matchMap || typeof matchMap !== "object") return;
        var userInfo = usersVal[uid] || {};
        var matchList = Object.values(matchMap).filter(m => m && m.code);
        if (!matchList.length) return;
        grouped[uid] = {
          uid,
          name:    userInfo.name  || "Unknown",
          email:   userInfo.email || uid,
          matches: matchList.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),
        };
      });
      console.log("grouped:", JSON.stringify(Object.keys(grouped)));
      setUserMatches(grouped);
      setLoadingUM(false);
    }).catch(err => {
      setLoadingUM(false);
      console.error("loadUserMatches error:", err);
      if (err.code === "PERMISSION_DENIED" || err.message.includes("permission")) {
        setMsg("RULES_ERROR");
      } else {
        setMsg("Error: "+err.message);
      }
    });
  }

  function deleteUserMatch(uid, code) {
    if (!_fbDB) return;
    Promise.all([
      _fbDB.ref("userMatches/"+uid+"/"+code).remove(),
      _fbDB.ref("liveIndex/"+code).remove(),
      _fbDB.ref("matches/"+code).remove(),
    ]).then(() => {
      setUserMatches(prev => {
        var next = {...prev};
        next[uid] = {...next[uid], matches: next[uid].matches.filter(m=>m.code!==code)};
        if (!next[uid].matches.length) delete next[uid];
        return next;
      });
      setMsg("Match "+code+" deleted");
    }).catch(err => setMsg("Error: "+err.message));
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
    if (!ts) return "—";
    var mins = Math.round((Date.now()-ts)/60000);
    if (mins < 60) return mins+"m ago";
    if (mins < 1440) return Math.round(mins/60)+"h ago";
    return Math.round(mins/1440)+"d ago";
  }

  function fmtScore(m) {
    var bt = m.batting||0;
    if (!m.runs) return "—";
    return m.runs[0]+"/"+m.wickets[0]+" vs "+m.runs[1]+"/"+m.wickets[1];
  }

  return (
    <div style={{paddingBottom:24}}>
      <div style={{color:"#4ade80",fontSize:13,marginBottom:20,textAlign:"center"}}>
        ✓ Admin — {currentUser ? (currentUser.displayName||currentUser.email) : ""}
      </div>

      {/* ── Firebase Rules reminder ── */}
      <div style={{background:"rgba(251,191,36,.07)",borderRadius:14,padding:16,border:"1px solid rgba(251,191,36,.25)",marginBottom:12}}>
        <div style={{color:"#fbbf24",fontSize:12,fontWeight:"bold",marginBottom:8}}>⚙️ Required Firebase Rules</div>
        <pre style={{color:"#94a3b8",fontSize:10,lineHeight:1.7,margin:0,overflowX:"auto",whiteSpace:"pre-wrap"}}>{`{
  "rules": {
    "matches":     { "$c": { ".read": true, ".write": true } },
    "liveIndex":   { ".read": true, ".write": true },
    "userMatches": { ".read": true, ".write": true },
    "users":       { ".read": true, ".write": true },
    "players":     { ".read": true, ".write": true },
    "teams":       { ".read": true, ".write": true }
  }
}`}</pre>
        <div style={{color:"#64748b",fontSize:10,marginTop:8}}>Firebase Console → Realtime Database → Rules</div>
      </div>

      {/* ── Matches by User ── */}
      <div style={{background:"#1e293b",borderRadius:14,padding:18,border:"1px solid #334155",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{color:"#94a3b8",fontSize:13}}>👤 Matches by User</div>
          <button onClick={loadUserMatches} disabled={loadingUM}
            style={{padding:"5px 12px",background:"transparent",border:"1px solid #334155",borderRadius:8,color:"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            {loadingUM?"…":userMatches===null?"Load":"Refresh"}
          </button>
        </div>
        {msg==="RULES_ERROR" && (
          <div style={{color:"#fbbf24",fontSize:12,padding:"10px 12px",background:"rgba(251,191,36,.08)",borderRadius:8,marginBottom:10,lineHeight:1.6}}>
            ⚠️ Permission denied — update your Firebase Rules using the box above, then try again.
          </div>
        )}
        {msg&&msg!=="RULES_ERROR"&&<div style={{color:"#f87171",fontSize:12,marginBottom:8}}>{msg}</div>}
        {userMatches===null&&!loadingUM&&msg!=="RULES_ERROR"&&(
          <div style={{color:"#475569",fontSize:12,textAlign:"center",padding:"8px 0"}}>Tap Load to fetch all users' matches</div>
        )}
        {userMatches!==null&&Object.keys(userMatches).length===0&&(
          <div style={{color:"#475569",fontSize:12,textAlign:"center",padding:"10px 0",lineHeight:1.8}}>
            No matches found in Firebase.<br/>
            <span style={{color:"#334155",fontSize:11}}>Matches are saved when a scorer creates and starts a match while logged in. Check browser console (F12) for debug info.</span>
          </div>
        )}
        {userMatches!==null&&Object.values(userMatches).map(u=>(
          <div key={u.uid} style={{marginBottom:8,border:"1px solid #334155",borderRadius:10,overflow:"hidden"}}>
            {/* User header */}
            <div onClick={()=>setExpandedUser(expandedUser===u.uid?null:u.uid)}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#0f172a",cursor:"pointer"}}>
              <div>
                <div style={{color:"#e2e8f0",fontSize:13,fontWeight:"bold"}}>{u.name}</div>
                <div style={{color:"#475569",fontSize:11}}>{u.email} · {u.matches.length} match{u.matches.length!==1?"es":""}</div>
              </div>
              <div style={{color:"#475569",fontSize:14}}>{expandedUser===u.uid?"▲":"▼"}</div>
            </div>
            {/* Match list for this user */}
            {expandedUser===u.uid&&(
              <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
                {u.matches.map(m=>(
                  <div key={m.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1e293b",borderRadius:8,padding:"8px 10px",border:"1px solid #334155"}}>
                    <div>
                      <div style={{color:"#e2e8f0",fontSize:12}}>{m.teamA} vs {m.teamB}</div>
                      <div style={{color:"#475569",fontSize:10}}>
                        {m.code} · {fmtAge(m.updatedAt||m.createdAt)} · {m.complete?"✓ Complete":"🔴 Live"}
                      </div>
                      <div style={{color:"#64748b",fontSize:10}}>{fmtScore(m)}</div>
                    </div>
                    <button onClick={()=>{ if(confirm("Delete match "+m.code+"?")) deleteUserMatch(u.uid, m.code); }}
                      style={{padding:"5px 10px",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:8,color:"#fca5a5",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Local match history ── */}
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

      {/* ── Firebase live index ── */}
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
                  {e.createdBy&&<div style={{color:"#475569",fontSize:10}}>by {e.createdBy.name||e.createdBy.email}</div>}
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

      {msg&&msg!=="RULES_ERROR"&&<div style={{color:"#4ade80",fontSize:12,textAlign:"center",marginBottom:12}}>{msg}</div>}

      <button onClick={onDone}
        style={{width:"100%",padding:"11px 0",background:"transparent",border:"1px solid #334155",borderRadius:10,color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
        Done
      </button>
    </div>
  );
}

// ── NList — player/bowler name entry in setup wizard ─────────────
function NList({names, ids, ph, onUp, min, max}) {
  // ids: array of playerIds parallel to names (null if not from saved players)
  const [showPicker, setShowPicker] = React.useState(null); // index to pick for
  const [allPlayers, setAllPlayers] = React.useState(null); // null=not loaded
  const [pSearch,    setPSearch]    = React.useState("");

  function addOne() {
    if(names.length<max) {
      onUp([...names, ph+" "+(names.length+1)], [...(ids||[]), null]);
    }
  }
  function removeOne() {
    if(names.length>min) {
      onUp(names.slice(0,-1), (ids||[]).slice(0,-1));
    }
  }
  function updateName(i, val) {
    var u=[...names]; u[i]=val;
    var uid=[...(ids||Array(names.length).fill(null))]; uid[i]=null; // clear id if manually typed
    onUp(u, uid);
  }
  function openPicker(i) {
    setShowPicker(i);
    setPSearch("");
    if (!allPlayers && _fbDB) {
      _fbDB.ref("players").once("value", snap => {
        var val = snap.val()||{};
        setAllPlayers(Object.values(val).sort((a,b)=>a.name.localeCompare(b.name)));
      });
    }
  }
  function pickPlayer(i, p) {
    // Don't allow picking a player already selected at a different slot
    var curIds = ids || Array(names.length).fill(null);
    var alreadyAt = curIds.findIndex((id, idx) => id === p.id && idx !== i);
    if (alreadyAt !== -1) return; // already selected elsewhere, ignore
    var u=[...names]; u[i]=p.name;
    var uid=[...curIds]; uid[i]=p.id;
    onUp(u, uid);
    setShowPicker(null);
  }

  // Set of ids already used (excluding the slot being picked for)
  var usedIds = new Set((ids||[]).filter((id,idx) => id && idx !== showPicker));
  var filtered = allPlayers
    ? allPlayers.filter(p=>p.name.toLowerCase().includes(pSearch.toLowerCase()))
    : [];

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
        {names.map((nm,i)=>{
          var hasId = ids && ids[i];
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:"#475569",fontSize:13,minWidth:22,textAlign:"right"}}>{i+1}.</span>
              <input value={nm} placeholder={ph+" "+(i+1)}
                onChange={e=>updateName(i, e.target.value)}
                style={{flex:1,background:"#0f172a",border:hasId?"1px solid rgba(251,191,36,.4)":"1px solid #334155",borderRadius:9,padding:"10px 10px",color:hasId?"#fbbf24":"#f1f5f9",fontSize:14,outline:"none",fontFamily:"Georgia,serif"}}
              />
              <button onClick={()=>openPicker(i)}
                title="Pick from saved players"
                style={{width:32,height:38,borderRadius:8,border:"1px solid #334155",background:"#0f172a",color:"#475569",fontSize:14,cursor:"pointer",flexShrink:0,fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center"}}>
                👤
              </button>
            </div>
          );
        })}
      </div>

      {/* Player picker modal */}
      {showPicker !== null && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:3000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:"#1e293b",borderRadius:"20px 20px 0 0",padding:"20px 18px 36px",width:"100%",maxWidth:480,maxHeight:"70vh",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{color:"#fbbf24",fontSize:14,fontWeight:"bold"}}>Pick {ph} {showPicker+1}</div>
              <button onClick={()=>setShowPicker(null)} style={{background:"none",border:"1px solid #334155",borderRadius:8,padding:"4px 10px",color:"#64748b",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>✕</button>
            </div>
            <input value={pSearch} onChange={e=>setPSearch(e.target.value)} placeholder="Search players…" autoFocus
              style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:9,padding:"10px 12px",color:"#f1f5f9",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif",marginBottom:10}}/>
            <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:6}}>
              {!allPlayers && <div style={{color:"#475569",fontSize:13,textAlign:"center",padding:20}}>Loading…</div>}
              {allPlayers && filtered.length===0 && <div style={{color:"#475569",fontSize:13,textAlign:"center",padding:20}}>No players found</div>}
              {filtered.map(p=>{
                var taken = usedIds.has(p.id);
                return (
                  <div key={p.id} onClick={()=>!taken&&pickPlayer(showPicker, p)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:taken?"1px solid #1e293b":"1px solid #334155",background:taken?"#0a1120":"#0f172a",cursor:taken?"not-allowed":"pointer",opacity:taken?0.4:1}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:taken?"#1e293b":"linear-gradient(135deg,#fbbf24,#d97706)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:"bold",color:taken?"#475569":"#0f172a",flexShrink:0}}>
                      {p.name[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{color:taken?"#334155":"#e2e8f0",fontSize:14}}>{p.name}</div>
                      <div style={{color:"#475569",fontSize:11}}>{p.role}{taken?" · already selected":""}</div>
                    </div>
                    {taken && <span style={{color:"#334155",fontSize:11}}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AuthGate — register / login wall ─────────────────────────────
function AuthGate({children}) {
  // status: "loading" | "login" | "authed" | "guest"
  const [status,   setStatus]   = useState("loading");
  const [authUser, setAuthUser] = useState(null);
  const [view,     setView]     = useState("login");
  // Shared fields
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  // Registration type
  const [regType,  setRegType]  = useState("player"); // "player" | "viewer"
  // Player-only fields
  const [role,     setRole]     = useState("Batsman");
  const [batStyle, setBatStyle] = useState("Right-hand");
  const [bowlStyle,setBowlStyle]= useState("Right-arm Medium");
  const [dob,      setDob]      = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);

  const ROLES      = ["Batsman","Bowler","All-rounder","Wicket-keeper"];
  const BAT_STYLES = ["Right-hand","Left-hand"];
  const BOWL_STYLES= ["Right-arm Fast","Right-arm Medium","Right-arm Off-spin","Left-arm Fast","Left-arm Medium","Left-arm Spin","N/A"];

  useEffect(() => {
    initFB();
    if (!_fbAuth) { setStatus("login"); return; }
    var unsub = _fbAuth.onAuthStateChanged(u => {
      if (u) { setAuthUser(u); setStatus("authed"); }
      else   { setAuthUser(null); setStatus("login"); }
    });
    var t = setTimeout(() => setStatus(s => s === "loading" ? "login" : s), 5000);
    return () => { unsub(); clearTimeout(t); };
  }, []);

  function clearForm() { setErr(""); setInfo(""); }

  async function handleRegister() {
    clearForm();
    if (!name.trim())         return setErr("Please enter your name");
    if (!email.trim())        return setErr("Please enter your email");
    if (password.length < 6)  return setErr("Password must be at least 6 characters");
    if (password !== confirm)  return setErr("Passwords do not match");
    setBusy(true);
    try {
      var cred = await _fbAuth.createUserWithEmailAndPassword(email.trim(), password);
      await cred.user.updateProfile({ displayName: name.trim() });
      var uid = cred.user.uid;
      var now = Date.now();
      // Write user record
      var userRecord = {
        name: name.trim(), email: email.trim(),
        type: regType, createdAt: now,
      };
      await _fbDB.ref("users/"+uid).set(userRecord);
      // If registering as player, also create a player profile
      if (regType === "player") {
        var playerId = "P_" + now + "_" + Math.random().toString(36).slice(2,6);
        var playerRecord = {
          id: playerId, uid,
          name: name.trim(), role, batStyle, bowlStyle,
          dob: dob || null,
          createdBy: uid, createdAt: now,
          batting:  { matches:0, innings:0, runs:0, balls:0, outs:0, fours:0, sixes:0, highScore:0, fifties:0, hundreds:0 },
          bowling:  { overs:0, balls:0, runs:0, wickets:0, maidens:0, bestWickets:0, bestRuns:999 },
        };
        await _fbDB.ref("players/"+playerId).set(playerRecord);
        // Store playerId on user record for easy lookup
        await _fbDB.ref("users/"+uid+"/playerId").set(playerId);
      }
    } catch(e) {
      setErr(friendlyError(e.code));
    }
    setBusy(false);
  }

  async function handleLogin() {
    clearForm();
    if (!email.trim() || !password) return setErr("Please enter email and password");
    setBusy(true);
    try {
      await _fbAuth.signInWithEmailAndPassword(email.trim(), password);
    } catch(e) {
      setErr(friendlyError(e.code));
    }
    setBusy(false);
  }

  async function handleForgot() {
    clearForm();
    if (!email.trim()) return setErr("Enter your email address first");
    setBusy(true);
    try {
      await _fbAuth.sendPasswordResetEmail(email.trim());
      setInfo("Password reset email sent — check your inbox");
    } catch(e) {
      setErr(friendlyError(e.code));
    }
    setBusy(false);
  }

  function friendlyError(code) {
    var map = {
      "auth/email-already-in-use":    "An account with this email already exists",
      "auth/invalid-email":           "Invalid email address",
      "auth/weak-password":           "Password is too weak",
      "auth/user-not-found":          "No account found with this email",
      "auth/wrong-password":          "Incorrect password",
      "auth/invalid-credential":      "Incorrect email or password",
      "auth/too-many-requests":       "Too many attempts — try again later",
      "auth/network-request-failed":  "Network error — check your connection",
    };
    return map[code] || "Something went wrong. Please try again";
  }

  // Loading state
  if (status === "loading") return (
    <div style={{minHeight:"100dvh",background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"#475569",fontSize:14,fontFamily:"Georgia,serif"}}>Loading…</div>
    </div>
  );

  // Authenticated — show app
  if (status === "authed") return (
    <div>
      {React.cloneElement(children, { currentUser: authUser })}
    </div>
  );

  // Guest — show app with no user
  if (status === "guest") return (
    <div>
      {React.cloneElement(children, { currentUser: null })}
    </div>
  );

  // ── Shared styles ──
  var inputStyle = {width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"13px 14px",color:"#f1f5f9",fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"};
  var btnPrimary = {width:"100%",padding:"14px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:1,marginTop:4};
  var btnSecondary = {background:"none",border:"none",color:"#60a5fa",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",padding:"4px 0"};

  return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(170deg,#0c1828,#0f172a)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 16px 40px",fontFamily:"Georgia,serif"}}>
      <div style={{width:"100%",maxWidth:400}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:24}}>
          <img src="icons/icon-192.png" alt="Cricket Scorer" style={{width:110,height:110,borderRadius:24,marginBottom:10,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}/>
          <h1 style={{color:"#fbbf24",fontSize:22,fontWeight:"bold",letterSpacing:3,margin:"0 0 4px",textTransform:"uppercase"}}>Cricket Scorer</h1>
          <p style={{color:"#475569",fontSize:11,letterSpacing:2,margin:0}}>LIVE MATCH BROADCASTING</p>
        </div>

        {/* Card */}
        <div style={{background:"#1e293b",borderRadius:20,padding:26,border:"1px solid #334155",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>

          {/* Tab switcher */}
          <div style={{display:"flex",background:"#0f172a",borderRadius:10,padding:3,marginBottom:22,gap:3}}>
            {["login","register"].map(v=>(
              <button key={v} onClick={()=>{setView(v);clearForm();}}
                style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:view===v?"#1e293b":"transparent",color:view===v?"#fbbf24":"#475569",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all .2s",textTransform:"capitalize"}}>
                {v==="login"?"Sign In":"Register"}
              </button>
            ))}
          </div>

          {view==="forgot" ? (
            <div>
              <div style={{color:"#94a3b8",fontSize:13,marginBottom:16,lineHeight:1.6}}>Enter your email and we'll send a reset link.</div>
              <div style={{marginBottom:14}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>EMAIL</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="you@example.com" style={inputStyle}/>
              </div>
              {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
              {info&&<div style={{color:"#4ade80",fontSize:12,marginBottom:10,padding:"8px 12px",background:"rgba(74,222,128,.1)",borderRadius:8}}>{info}</div>}
              <button onClick={handleForgot} disabled={busy} style={btnPrimary}>{busy?"Sending…":"Send Reset Email"}</button>
              <div style={{textAlign:"center",marginTop:14}}>
                <button onClick={()=>{setView("login");clearForm();}} style={btnSecondary}>← Back to Sign In</button>
              </div>
            </div>
          ) : view==="register" ? (
            <div>
              {/* Player / Viewer toggle */}
              <div style={{marginBottom:18}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>I AM REGISTERING AS</label>
                <div style={{display:"flex",gap:8}}>
                  {[["player","🏏 Player"],["viewer","👁 Viewer"]].map(([t,lbl])=>(
                    <button key={t} onClick={()=>{setRegType(t);clearForm();}}
                      style={{flex:1,padding:"12px 0",borderRadius:12,border:regType===t?"2px solid #fbbf24":"1px solid #334155",background:regType===t?"rgba(251,191,36,.1)":"transparent",color:regType===t?"#fbbf24":"#64748b",fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div style={{color:"#334155",fontSize:11,marginTop:8,lineHeight:1.5,textAlign:"center"}}>
                  {regType==="player"
                    ? "Your profile will be linked to a player card with stats"
                    : "You can watch matches and manage scorecards"}
                </div>
              </div>

              {/* Common fields */}
              <div style={{marginBottom:12}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>{regType==="player"?"PLAYER NAME":"YOUR NAME"}</label>
                <input value={name} onChange={e=>{setName(e.target.value);clearForm();}} type="text" placeholder={regType==="player"?"e.g. Rohit Sharma":"e.g. Arjun Patel"} style={inputStyle}
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>

              {/* Player-only fields */}
              {regType==="player" && (
                <div>
                  <div style={{marginBottom:12}}>
                    <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>ROLE</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ROLES.map(r=>(
                        <button key={r} onClick={()=>setRole(r)}
                          style={{padding:"7px 12px",borderRadius:9,border:role===r?"1px solid #fbbf24":"1px solid #334155",background:role===r?"rgba(251,191,36,.1)":"transparent",color:role===r?"#fbbf24":"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    <div>
                      <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>BATTING</label>
                      <select value={batStyle} onChange={e=>setBatStyle(e.target.value)}
                        style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 10px",color:"#f1f5f9",fontSize:13,outline:"none",fontFamily:"Georgia,serif"}}>
                        {BAT_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>BOWLING</label>
                      <select value={bowlStyle} onChange={e=>setBowlStyle(e.target.value)}
                        style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 10px",color:"#f1f5f9",fontSize:13,outline:"none",fontFamily:"Georgia,serif"}}>
                        {BOWL_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>DATE OF BIRTH <span style={{color:"#334155"}}>(optional)</span></label>
                    <input value={dob} onChange={e=>setDob(e.target.value)} type="date"
                      style={{...inputStyle,colorScheme:"dark"}}/>
                  </div>
                </div>
              )}

              <div style={{marginBottom:12}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>EMAIL ADDRESS</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="you@example.com" style={inputStyle}
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>
              <div style={{marginBottom:12}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>PASSWORD</label>
                <div style={{position:"relative"}}>
                  <input value={password} onChange={e=>{setPassword(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="Min 6 characters" style={{...inputStyle,paddingRight:44}}
                    onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
                  <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",fontSize:16,cursor:"pointer",padding:0}}>{showPw?"🙈":"👁"}</button>
                </div>
              </div>
              <div style={{marginBottom:18}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>CONFIRM PASSWORD</label>
                <input value={confirm} onChange={e=>{setConfirm(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="Repeat password" style={inputStyle}
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>
              {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
              <button onClick={handleRegister} disabled={busy} style={btnPrimary}>
                {busy?"Creating account…":regType==="player"?"🏏 Register as Player":"👁 Register as Viewer"}
              </button>
            </div>
          ) : (
            <div>
              <div style={{marginBottom:14}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>EMAIL ADDRESS</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="you@example.com" style={inputStyle}
                  onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
              </div>
              <div style={{marginBottom:6}}>
                <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>PASSWORD</label>
                <div style={{position:"relative"}}>
                  <input value={password} onChange={e=>{setPassword(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="Your password" style={{...inputStyle,paddingRight:44}}
                    onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
                  <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",fontSize:16,cursor:"pointer",padding:0}}>{showPw?"🙈":"👁"}</button>
                </div>
              </div>
              <div style={{textAlign:"right",marginBottom:16}}>
                <button onClick={()=>{setView("forgot");clearForm();}} style={btnSecondary}>Forgot password?</button>
              </div>
              {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
              <button onClick={handleLogin} disabled={busy} style={btnPrimary}>{busy?"Signing in…":"Sign In"}</button>
            </div>
          )}
        </div>

        {/* Guest option */}
        <div style={{textAlign:"center",marginTop:20}}>
          <div style={{color:"#334155",fontSize:12,marginBottom:10}}>— or —</div>
          <button onClick={()=>setStatus("guest")}
            style={{background:"none",border:"1px solid #334155",borderRadius:10,padding:"11px 32px",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",width:"100%"}}>
            Continue as Guest
          </button>
          <p style={{color:"#475569",fontSize:11,marginTop:10,lineHeight:1.5}}>
            Guests can score & watch live matches.<br/>Register to track player stats &amp; teams.
          </p>
        </div>

      </div>
    </div>
  );
}

function App({ currentUser }) {
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
  // Next batter picker: shown after wicket or retirement
  const [nextBatterPick, setNextBatterPick] = useState(false);
  // Match history
  const [matchHistory, setMatchHistory] = useState([]);
  // Admin
  const [adminPin, setAdminPin] = useState("");
  // Live matches list for viewer
  const [liveMatches, setLiveMatches] = useState(null); // null=not loaded, []=empty
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError,   setLiveError]   = useState("");
  const listRef = useRef(null);
  // Players & Teams
  const [showPlayers,    setShowPlayers]    = useState(false);
  const [showTeams,      setShowTeams]      = useState(false);
  const [teamPickerSlot, setTeamPickerSlot] = useState(null); // "A"|"B"|null

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

  // Show next batter picker after wicket or retirement
  useEffect(() => {
    if (match && match.needsNextBatter && !isViewer) {
      setNextBatterPick(true);
    }
  }, [match ? match.needsNextBatter : null]);

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
    var bt = match.batting||0;
    var summary = {
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
      createdBy: match.createdBy || null,
    };
    if (bothOver) {
      _fbDB.ref("liveIndex/"+code).remove();
    } else {
      _fbDB.ref("liveIndex/"+code).set(summary);
    }
    // Always keep userMatches in sync — use uid from match.createdBy as fallback
    var uid = currentUser ? currentUser.uid : (match.createdBy ? match.createdBy.uid : null);
    if (uid) {
      _fbDB.ref("userMatches/"+uid+"/"+code).set({...summary, complete: !!bothOver});
    }
  }, [match, currentUser]);

  function attachListener(code) {
    if (listRef.current) listRef.current.off();
    if (!_fbDB) return;
    var ref = _fbDB.ref("matches/"+code);
    listRef.current = ref;
    // First value: set as viewer and navigate
    var first = true;
    ref.on("value", snap => {
      var v = snap.val();
      if (!v) return;
      if (first) {
        first = false;
        setMatch(v); setIsViewer(true); setScreen("viewer");
      } else {
        // Subsequent updates: only update match data, never touch isViewer or screen
        setMatch(v);
      }
    }, err => console.warn("FB listener error:", err.message));
  }

  function detach() { if (listRef.current) { listRef.current.off(); listRef.current=null; } }

  // ── Match start ──────────────────────────────────────────────
  function startMatch() {
    var code = fbReady ? genCode() : "LOCAL";
    var m = blankMatch(setup, code);
    // Tag match with creator info
    if (currentUser) {
      m.createdBy = { uid: currentUser.uid, name: currentUser.displayName||"", email: currentUser.email||"" };
    }
    setMatch(m);
    setHistory([]);
    setIsViewer(false);
    setScreen("match");
    // Immediately register in liveIndex so it appears in viewer list
    if (fbReady && code !== "LOCAL" && _fbDB) {
      var entry = {
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
        createdBy: m.createdBy || null,
      };
      _fbDB.ref("liveIndex/"+code).set(entry);
      // Also write to user-scoped path
      if (currentUser) _fbDB.ref("userMatches/"+currentUser.uid+"/"+code).set(entry);
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
      hist.unshift(entry);
      if (hist.length > 50) hist = hist.slice(0, 50);
      localStorage.setItem(HIST_KEY, JSON.stringify(hist));
      setMatchHistory(hist);
    } catch(e) {}
    // Also push player stats to Firebase
    updatePlayerStats(m);
  }

  function updatePlayerStats(m) {
    if (!_fbDB) return;
    // For each team, for each player/bowler that has a registered player id, update stats
    [0,1].forEach(ti => {
      var team = ti===0 ? m.teamA : m.teamB;
      var oppTeam = ti===0 ? m.teamB : m.teamA;
      // Batting stats
      (team.players||[]).forEach(p => {
        if (!p.playerId) return;
        var ref = _fbDB.ref("players/"+p.playerId);
        ref.once("value").then(snap => {
          var cur = snap.val();
          if (!cur) return;
          var bat = cur.batting || {};
          var isOut = p.out;
          var newRuns = (bat.runs||0) + (p.runs||0);
          var newBalls = (bat.balls||0) + (p.balls||0);
          var newOuts = (bat.outs||0) + (isOut?1:0);
          var newInnings = (bat.innings||0) + (p.balls>0||p.out?1:0);
          var newFours = (bat.fours||0) + (p.fours||0);
          var newSixes = (bat.sixes||0) + (p.sixes||0);
          var newHS = Math.max(bat.highScore||0, p.runs||0);
          var newFifties = (bat.fifties||0) + ((p.runs||0)>=50&&(p.runs||0)<100?1:0);
          var newHundreds = (bat.hundreds||0) + ((p.runs||0)>=100?1:0);
          var newMatches = (bat.matches||0) + 1;
          ref.update({ batting: {
            matches:newMatches, innings:newInnings, runs:newRuns, balls:newBalls,
            outs:newOuts, fours:newFours, sixes:newSixes,
            highScore:newHS, fifties:newFifties, hundreds:newHundreds
          }});
        }).catch(()=>{});
      });
      // Bowling stats — bowlers bowl against the opposing team's innings
      (oppTeam.bowlers||[]).forEach(b => {
        if (!b.playerId) return;
        var ref = _fbDB.ref("players/"+b.playerId);
        ref.once("value").then(snap => {
          var cur = snap.val();
          if (!cur) return;
          var bowl = cur.bowling || {};
          var newWkts = (bowl.wickets||0) + (b.wickets||0);
          var newRuns2 = (bowl.runs||0) + (b.runs||0);
          var newOvers2 = (bowl.overs||0) + (b.overs||0);
          var newBalls2 = (bowl.balls||0) + (b.balls||0);
          var newMaidens = (bowl.maidens||0) + (b.maidens||0);
          // Best bowling: most wickets, fewest runs for same wickets
          var curBestW = bowl.bestWickets||0, curBestR = bowl.bestRuns||999;
          var newBestW = curBestW, newBestR = curBestR;
          if ((b.wickets||0) > curBestW || ((b.wickets||0)===curBestW && (b.runs||0)<curBestR)) {
            newBestW = b.wickets||0; newBestR = b.runs||0;
          }
          ref.update({ bowling: {
            overs:newOvers2, balls:newBalls2, runs:newRuns2,
            wickets:newWkts, maidens:newMaidens,
            bestWickets:newBestW, bestRuns:newBestR
          }});
        }).catch(()=>{});
      });
    });
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
      var STALE = 24*60*60*1000; // 24 hours
      var list = [];
      var removes = [];
      Object.values(val).forEach(m => {
        if (!m.code) return;
        var age = now - (m.createdAt || now);
        var isStale = age >= STALE;
        var isOver  = m.inningsOver && m.inningsOver[0] && m.inningsOver[1];
        if (isStale || isOver) {
          // Mark as abandoned in Firebase then remove from liveIndex
          if (isStale && !isOver) {
            db.ref("matches/"+m.code+"/abandoned").set(true);
          }
          removes.push(db.ref("liveIndex/"+m.code).remove());
        } else if (m.teamA && m.teamB) {
          list.push(m);
        }
      });
      if (removes.length) Promise.all(removes).catch(()=>{});
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
        // Prompt to pick next batter rather than auto-select
        var inUse = [m.currentBatsmen[0], m.currentBatsmen[1]];
        var anyAvail = bT.players.some((p,pi) => !p.out && !p.retired && inUse.indexOf(pi)===-1);
        if (anyAvail) {
          m.needsNextBatter = true;
        } else {
          // No one left — last man or innings over
          var hasRetiredRH = bT.players.some(p=>p.retired);
          if (hasRetiredRH) m.needsRecall = true;
          else m.inningsOver[bt] = true;
        }
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
      // Check who is still available
      var inUse2 = [m.currentBatsmen[0], m.currentBatsmen[1]];
      var nextBatter = -1;
      for (var ni=0; ni<bT.players.length; ni++) {
        if (!bT.players[ni].out && !bT.players[ni].retired && inUse2.indexOf(ni)===-1) { nextBatter=ni; break; }
      }
      var noMoreBatters = nextBatter === -1;
      var hasRetired = bT.players.some(p=>p.retired);
      var mx = maxWkts(m, bt);
      var inningsNowOver = m.wickets[bt] >= mx;
      // Last man: penultimate wicket — surviving batter bats alone
      var isLastManIn = !inningsNowOver && noMoreBatters && !hasRetired;
      if (isLastManIn) {
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
      } else if (!inningsNowOver && !isLastManIn) {
        // Prompt scorer to pick next batter
        m.needsNextBatter = true;
      }
      return m;
    });
  }

  function selectNextBatter(playerIdx) {
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      m.currentBatsmen[m.striker] = playerIdx;
      m.needsNextBatter = false;
      return m;
    });
    setNextBatterPick(false);
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


  if (showPlayers) return <PlayersScreen currentUser={currentUser} onBack={()=>setShowPlayers(false)}/>;
  if (showTeams)   return <TeamsScreen   currentUser={currentUser} onBack={()=>setShowTeams(false)}/>;

  if (screen==="home") return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(170deg,#0c1828,#0f172a)",display:"flex",flexDirection:"column",alignItems:"center",padding:"28px 16px 40px",fontFamily:"Georgia,serif",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <img src="icons/icon-192.png" alt="Cricket Scorer" style={{width:100,height:100,borderRadius:22,marginBottom:10,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}/>
          <h1 style={{color:"#fbbf24",fontSize:24,fontWeight:"bold",letterSpacing:3,margin:"8px 0 4px",textTransform:"uppercase"}}>Cricket Scorer</h1>
          <p style={{color:"#475569",fontSize:11,letterSpacing:2,margin:"0 0 8px"}}>LIVE MATCH BROADCASTING</p>
          {currentUser ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginTop:6}}>
              <span style={{color:"#94a3b8",fontSize:13}}>👋 {currentUser.displayName || currentUser.email}</span>
              <button onClick={()=>{initFB();_fbAuth&&_fbAuth.signOut();}}
                style={{background:"none",border:"1px solid #334155",borderRadius:8,padding:"3px 10px",color:"#64748b",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Sign out
              </button>
            </div>
          ) : (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:8}}>
              <span style={{color:"#475569",fontSize:12}}>Browsing as guest</span>
              <button onClick={()=>{initFB();_fbAuth&&_fbAuth.signOut();window.location.reload();}}
                style={{background:"none",border:"1px solid rgba(251,191,36,.35)",borderRadius:8,padding:"4px 12px",color:"#fbbf24",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Sign In / Register
              </button>
            </div>
          )}
          <div style={{marginTop:8}}>
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

        {/* Players & Teams */}
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          <button onClick={()=>setShowPlayers(true)}
            style={{flex:1,padding:"12px 0",background:"#1e293b",border:"1px solid #334155",borderRadius:12,color:"#94a3b8",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            🏏 Players
          </button>
          <button onClick={()=>setShowTeams(true)}
            style={{flex:1,padding:"12px 0",background:"#1e293b",border:"1px solid #334155",borderRadius:12,color:"#94a3b8",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            👥 Teams
          </button>
        </div>

        {/* Watch Live — visible to all logged-in users */}
        <div style={{background:"#1e293b",borderRadius:20,padding:24,border:"1px solid #334155",boxShadow:"0 20px 60px rgba(0,0,0,.5)",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{color:"#64748b",fontSize:11,letterSpacing:2,marginBottom:2}}>WATCH LIVE</div>
              <div style={{color:"#94a3b8",fontSize:12}}>Join a match in progress</div>
            </div>
            <button onClick={fetchLiveMatches} disabled={loadingLive}
              style={{padding:"8px 16px",background:"rgba(251,191,36,.12)",border:"1px solid rgba(251,191,36,.3)",borderRadius:10,color:"#fbbf24",fontSize:13,cursor:loadingLive?"not-allowed":"pointer",fontFamily:"Georgia,serif",fontWeight:"bold"}}>
              {loadingLive ? "Loading…" : liveMatches===null ? "🔍 Find Matches" : "↻ Refresh"}
            </button>
          </div>

          {liveError && (
            <div style={{color:"#f87171",fontSize:12,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8,marginBottom:10,whiteSpace:"pre-wrap"}}>{liveError}</div>
          )}

          {liveMatches !== null && (
            liveMatches.length === 0
              ? <div style={{color:"#475569",fontSize:13,textAlign:"center",padding:"12px 0"}}>No live matches right now</div>
              : liveMatches.map(m => (
                <div key={m.code} onClick={()=>joinByCode(m.code)}
                  style={{background:"#0f172a",borderRadius:12,padding:"12px 14px",marginBottom:8,border:"1px solid #334155",cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{color:"#4ade80",fontSize:10,letterSpacing:1}}>● LIVE</span>
                    <span style={{color:"#475569",fontSize:11}}>{m.totalOvers} overs</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{color:m.batting===0?"#fbbf24":"#94a3b8",fontSize:14,fontWeight:"bold"}}>{m.teamA}</div>
                      <div style={{color:"#f1f5f9",fontSize:15,fontWeight:"bold"}}>{m.runs&&m.runs[0]!==undefined?m.runs[0]:0}/{m.wickets&&m.wickets[0]!==undefined?m.wickets[0]:0}</div>
                    </div>
                    <div style={{color:"#475569",fontSize:12}}>vs</div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:m.batting===1?"#fbbf24":"#94a3b8",fontSize:14,fontWeight:"bold"}}>{m.teamB}</div>
                      <div style={{color:"#f1f5f9",fontSize:15,fontWeight:"bold"}}>{m.runs&&m.runs[1]!==undefined?m.runs[1]:0}/{m.wickets&&m.wickets[1]!==undefined?m.wickets[1]:0}</div>
                    </div>
                  </div>
                </div>
              ))
          )}

          {/* Join by code */}
          <div style={{marginTop:liveMatches!==null?10:0,display:"flex",gap:8}}>
            <input id="join-code-input" placeholder="Have a match code? Enter it"
              style={{flex:1,background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 12px",color:"#f1f5f9",fontSize:14,outline:"none",fontFamily:"Georgia,serif",textTransform:"uppercase",letterSpacing:2}}
              onKeyDown={e=>{if(e.key==="Enter"){var v=e.target.value.trim().toUpperCase();if(v.length>=4)joinByCode(v);}}}
            />
            <button onClick={()=>{var el=document.getElementById("join-code-input");if(el&&el.value.trim().length>=4)joinByCode(el.value.trim().toUpperCase());}}
              style={{padding:"10px 16px",background:"#1e3a5f",border:"1px solid #1d4ed8",borderRadius:10,color:"#60a5fa",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              Join
            </button>
          </div>
        </div>

        {/* History button */}
        {matchHistory.length > 0 && (
          <button onClick={()=>setScreen("history")}
            style={{width:"100%",marginBottom:14,padding:"12px 0",background:"transparent",border:"1px solid #334155",borderRadius:12,color:"#64748b",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:1}}>
            📚 Match History ({matchHistory.length})
          </button>
        )}

        <div style={{textAlign:"center",marginTop:4}}>
          <button onClick={()=>setScreen("admin")}
            style={{background:"none",border:"none",color:currentUser&&ADMIN_EMAILS.includes(currentUser.email)?"#475569":"#1e293b",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
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
          {matchHistory.length > 0 && currentUser && ADMIN_EMAILS.includes(currentUser.email) && (
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
    var isAdminUser = currentUser && ADMIN_EMAILS.includes(currentUser.email);
    var pinOk = isAdminUser || adminPin===ADMIN_PIN;
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
            <AdminPanel matchHistory={matchHistory} setMatchHistory={setMatchHistory} currentUser={currentUser} onDone={()=>{setScreen("home");setAdminPin("");}}/>
          )}
        </div>
      </div>
    );
  }

  if (screen==="setup") {
    var s=setup;
    var STEPS=["Match Details",s.teamAName+" — Batters",s.teamAName+" — Bowlers",s.teamBName+" — Batters",s.teamBName+" — Bowlers"];
    return (
      <React.Fragment>
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
                {/* Quick team picker buttons */}
                <div style={{display:"flex",gap:8,marginBottom:16}}>
                  {["A","B"].map(slot=>(
                    <button key={slot} onClick={()=>setTeamPickerSlot(slot)}
                      style={{flex:1,padding:"9px 0",background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.25)",borderRadius:10,color:"#fbbf24",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:"bold"}}>
                      👥 Pick Team {slot} from Saved
                    </button>
                  ))}
                </div>
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
            {s.step===1&&<NList names={s.teamAPlayers} ids={s.teamAPlayerIds} ph="Player" min={2} max={25} onUp={(v,vids)=>setSetup(p=>({...p,teamAPlayers:v,teamACount:v.length,teamAPlayerIds:vids||p.teamAPlayerIds}))}/>}
            {s.step===2&&<NList names={s.teamABowlers} ids={s.teamABowlerIds} ph="Bowler" min={1} max={15} onUp={(v,vids)=>setSetup(p=>({...p,teamABowlers:v,teamABowlerCount:v.length,teamABowlerIds:vids||p.teamABowlerIds}))}/>}
            {s.step===3&&<NList names={s.teamBPlayers} ids={s.teamBPlayerIds} ph="Player" min={2} max={25} onUp={(v,vids)=>setSetup(p=>({...p,teamBPlayers:v,teamBCount:v.length,teamBPlayerIds:vids||p.teamBPlayerIds}))}/>}
            {s.step===4&&<NList names={s.teamBBowlers} ids={s.teamBBowlerIds} ph="Bowler" min={1} max={15} onUp={(v,vids)=>setSetup(p=>({...p,teamBBowlers:v,teamBBowlerCount:v.length,teamBBowlerIds:vids||p.teamBBowlerIds}))}/>}
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
      {/* Team Picker Modal */}
      {teamPickerSlot && (
        <TeamPickerModal
          slot={teamPickerSlot}
          onCancel={()=>setTeamPickerSlot(null)}
          onConfirm={picked => {
            var playerNames  = picked.players.map(p=>p.name);
            var playerIds    = picked.players.map(p=>p.id);
            var bowlerPool   = picked.players.filter(p=>p.role==="Bowler"||p.role==="All-rounder");
            if (bowlerPool.length===0) bowlerPool = picked.players.slice(0,Math.min(6,picked.players.length));
            var bowlerNames  = bowlerPool.map(p=>p.name);
            var bowlerIds    = bowlerPool.map(p=>p.id);
            if (teamPickerSlot==="A") {
              setSetup(p=>({...p,
                teamAName: picked.teamName,
                teamAPlayers: playerNames, teamACount: playerNames.length, teamAPlayerIds: playerIds,
                teamABowlers: bowlerNames, teamABowlerCount: bowlerNames.length, teamABowlerIds: bowlerIds,
              }));
            } else {
              setSetup(p=>({...p,
                teamBName: picked.teamName,
                teamBPlayers: playerNames, teamBCount: playerNames.length, teamBPlayerIds: playerIds,
                teamBBowlers: bowlerNames, teamBBowlerCount: bowlerNames.length, teamBBowlerIds: bowlerIds,
              }));
            }
            setTeamPickerSlot(null);
          }}
        />
      )}
      </React.Fragment>
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
                detach(); // stop receiving updates from old scorer
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
      {nextBatterPick && <NextBatterModal match={match} onSelect={selectNextBatter}/>}
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

// ════════════════════════════════════════════════════════════
// PLAYER & TEAM MANAGEMENT COMPONENTS
// ════════════════════════════════════════════════════════════

// ── PlayerStatsCard ──────────────────────────────────────────
function PlayerStatsCard({ p, onClick }) {
  var bat = p.batting || {};
  var bowl = p.bowling || {};
  var avg = bat.innings > 0 ? (bat.runs / Math.max(bat.outs,1)).toFixed(1) : "-";
  var sr  = bat.balls  > 0 ? ((bat.runs / bat.balls)*100).toFixed(1) : "-";
  var eco = (bowl.overs + (bowl.balls||0)/6) > 0 ? (bowl.runs / (bowl.overs + (bowl.balls||0)/6)).toFixed(2) : "-";
  var age = null;
  if (p.dob) {
    var diff = Date.now() - new Date(p.dob).getTime();
    age = Math.floor(diff / (365.25*24*3600*1000));
  }
  return (
    <div onClick={onClick} style={{background:"#1e293b",borderRadius:14,padding:"14px 16px",marginBottom:10,border:"1px solid #334155",cursor:onClick?"pointer":"default"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <div>
          <div style={{color:"#f1f5f9",fontSize:15,fontWeight:"bold"}}>{p.name}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:3}}>
            {p.role && <span style={{color:"#64748b",fontSize:11}}>{p.role}</span>}
            {p.batStyle && <span style={{color:"#475569",fontSize:11}}>· {p.batStyle} bat</span>}
            {p.bowlStyle && p.bowlStyle!=="N/A" && <span style={{color:"#475569",fontSize:11}}>· {p.bowlStyle}</span>}
            {age && <span style={{color:"#475569",fontSize:11}}>· Age {age}</span>}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.2)",borderRadius:8,padding:"2px 8px",color:"#fbbf24",fontSize:10}}>{bat.matches||0} matches</div>
          {p.uid && <div style={{background:"rgba(74,222,128,.08)",border:"1px solid rgba(74,222,128,.2)",borderRadius:8,padding:"2px 8px",color:"#4ade80",fontSize:10}}>✓ Registered</div>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{background:"#0f172a",borderRadius:10,padding:"10px 12px"}}>
          <div style={{color:"#64748b",fontSize:10,letterSpacing:1,marginBottom:6}}>BATTING</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Runs</span>
            <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:13}}>{bat.runs||0}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Avg</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{avg}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>SR</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{sr}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>50s/100s</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{bat.fifties||0}/{bat.hundreds||0}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"#94a3b8",fontSize:11}}>HS</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{bat.highScore||0}</span>
          </div>
        </div>
        <div style={{background:"#0f172a",borderRadius:10,padding:"10px 12px"}}>
          <div style={{color:"#64748b",fontSize:10,letterSpacing:1,marginBottom:6}}>BOWLING</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Wickets</span>
            <span style={{color:"#a78bfa",fontWeight:"bold",fontSize:13}}>{bowl.wickets||0}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Econ</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{eco}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Runs</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{bowl.runs||0}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Maidens</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{bowl.maidens||0}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{color:"#94a3b8",fontSize:11}}>Best</span>
            <span style={{color:"#e2e8f0",fontSize:12}}>{bowl.bestWickets||0}/{bowl.bestRuns||0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PlayersScreen — register/view players ────────────────────
function PlayersScreen({ currentUser, onBack }) {
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view,    setView]    = React.useState("list"); // list | add | detail
  const [sel,     setSel]     = React.useState(null);
  const [form,    setForm]    = React.useState({ name:"", role:"Batsman" });
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState("");
  const [search,  setSearch]  = React.useState("");
  const ROLES = ["Batsman","Bowler","All-rounder","Wicket-keeper"];

  React.useEffect(() => { loadPlayers(); }, []);

  function loadPlayers() {
    if (!_fbDB) return;
    setLoading(true);
    _fbDB.ref("players").once("value", snap => {
      var val = snap.val() || {};
      var list = Object.values(val).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
      setPlayers(list);
      setLoading(false);
    }, () => setLoading(false));
  }

  function savePlayer() {
    if (!form.name.trim()) return setErr("Name is required");
    setSaving(true); setErr("");
    var id = "P_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    var p = {
      id, name: form.name.trim(), role: form.role,
      createdBy: currentUser ? currentUser.uid : null,
      createdAt: Date.now(),
      batting:  { matches:0, innings:0, runs:0, balls:0, outs:0, fours:0, sixes:0, highScore:0, fifties:0, hundreds:0 },
      bowling:  { overs:0, balls:0, runs:0, wickets:0, maidens:0, bestWickets:0, bestRuns:999 },
    };
    _fbDB.ref("players/"+id).set(p).then(() => {
      setPlayers(ps => [...ps, p].sort((a,b)=>a.name.localeCompare(b.name)));
      setForm({ name:"", role:"Batsman" });
      setView("list");
      setSaving(false);
    }).catch(e => { setErr(e.message); setSaving(false); });
  }

  var filtered = players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  if (view === "add") return (
    <div style={{...S.page}}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setView("list");setErr("");}} style={S.btnSm}>← Back</button>
          <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>ADD PLAYER</h2>
        </div>
        <div style={{background:"#1e293b",borderRadius:16,padding:22,border:"1px solid #334155"}}>
          <div style={{marginBottom:14}}>
            <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>PLAYER NAME</label>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}
              placeholder="e.g. Rohit Sharma" autoFocus
              style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"12px 14px",color:"#f1f5f9",fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}
              onKeyDown={e=>{if(e.key==="Enter")savePlayer();}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>ROLE</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {ROLES.map(r=>(
                <button key={r} onClick={()=>setForm(f=>({...f,role:r}))}
                  style={{padding:"8px 14px",borderRadius:10,border:form.role===r?"1px solid #fbbf24":"1px solid #334155",background:form.role===r?"rgba(251,191,36,.12)":"transparent",color:form.role===r?"#fbbf24":"#94a3b8",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
          <button onClick={savePlayer} disabled={saving}
            style={{width:"100%",padding:"13px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            {saving ? "Saving…" : "Register Player"}
          </button>
        </div>
      </div>
    </div>
  );

  if (view === "detail" && sel) return (
    <div style={S.page}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setView("list")} style={S.btnSm}>← Back</button>
          <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>PLAYER PROFILE</h2>
        </div>
        <div style={{background:"#1e293b",borderRadius:16,padding:22,border:"1px solid #334155",textAlign:"center",marginBottom:14}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,#fbbf24,#d97706)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:"bold",color:"#0f172a",margin:"0 auto 12px"}}>
            {sel.name[0].toUpperCase()}
          </div>
          <div style={{color:"#f1f5f9",fontSize:20,fontWeight:"bold"}}>{sel.name}</div>
          <div style={{color:"#64748b",fontSize:12,marginTop:4}}>{sel.role}</div>
        </div>
        <PlayerStatsCard p={sel} />
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={S.btnSm}>← Back</button>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>🏏 PLAYERS</h2>
          </div>
          <button onClick={()=>setView("add")}
            style={{padding:"7px 14px",background:"linear-gradient(135deg,#fbbf24,#d97706)",border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            + Add
          </button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
          style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:10,padding:"10px 14px",color:"#f1f5f9",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif",marginBottom:14}}/>
        {loading && <div style={{color:"#475569",textAlign:"center",padding:40}}>Loading…</div>}
        {!loading && filtered.length===0 && (
          <div style={{color:"#475569",textAlign:"center",padding:40,lineHeight:1.8}}>
            No players registered yet.<br/><span style={{fontSize:12}}>Tap + Add to register a player.</span>
          </div>
        )}
        {filtered.map(p=>(
          <PlayerStatsCard key={p.id} p={p} onClick={()=>{setSel(p);setView("detail");}}/>
        ))}
      </div>
    </div>
  );
}

// ── TeamsScreen — create/manage teams ────────────────────────
function TeamsScreen({ currentUser, onBack }) {
  const [teams,   setTeams]   = React.useState([]);
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view,    setView]    = React.useState("list"); // list | create | detail
  const [sel,     setSel]     = React.useState(null);
  const [form,    setForm]    = React.useState({ name:"", playerIds:[] });
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState("");
  const [search,  setSearch]  = React.useState("");

  React.useEffect(() => {
    if (!_fbDB) return;
    setLoading(true);
    Promise.all([
      _fbDB.ref("teams").once("value"),
      _fbDB.ref("players").once("value"),
    ]).then(([tSnap, pSnap]) => {
      var tVal = tSnap.val() || {};
      var pVal = pSnap.val() || {};
      setTeams(Object.values(tVal).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
      setPlayers(Object.values(pVal).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  function togglePlayer(id) {
    setForm(f => ({
      ...f,
      playerIds: f.playerIds.includes(id) ? f.playerIds.filter(x=>x!==id) : [...f.playerIds, id]
    }));
  }

  function saveTeam() {
    if (!form.name.trim()) return setErr("Team name is required");
    if (form.playerIds.length < 2) return setErr("Add at least 2 players to the team");
    setSaving(true); setErr("");
    var id = "T_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    var t = {
      id, name: form.name.trim(),
      playerIds: form.playerIds,
      createdBy: currentUser ? currentUser.uid : null,
      createdAt: Date.now(),
    };
    _fbDB.ref("teams/"+id).set(t).then(() => {
      setTeams(ts => [...ts, t].sort((a,b)=>a.name.localeCompare(b.name)));
      setForm({ name:"", playerIds:[] });
      setView("list");
      setSaving(false);
    }).catch(e => { setErr(e.message); setSaving(false); });
  }

  var inputSt = {width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"12px 14px",color:"#f1f5f9",fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"};

  if (view === "create") return (
    <div style={S.page}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setView("list");setErr("");}} style={S.btnSm}>← Back</button>
          <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>CREATE TEAM</h2>
        </div>
        <div style={{background:"#1e293b",borderRadius:16,padding:22,border:"1px solid #334155",marginBottom:14}}>
          <div style={{marginBottom:18}}>
            <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>TEAM NAME</label>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Mumbai Warriors" style={inputSt}/>
          </div>
          <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:10}}>SELECT PLAYERS ({form.playerIds.length} selected)</label>
          {players.length===0 && <div style={{color:"#475569",fontSize:13,marginBottom:14}}>No players registered yet — add players first.</div>}
          <div style={{maxHeight:"40vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
            {players.map(p=>{
              var sel2 = form.playerIds.includes(p.id);
              return (
                <div key={p.id} onClick={()=>togglePlayer(p.id)}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:sel2?"1px solid #fbbf24":"1px solid #334155",background:sel2?"rgba(251,191,36,.08)":"#0f172a",cursor:"pointer"}}>
                  <div style={{width:20,height:20,borderRadius:5,border:sel2?"2px solid #fbbf24":"1px solid #475569",background:sel2?"#fbbf24":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {sel2&&<span style={{color:"#0f172a",fontSize:13,fontWeight:"bold"}}>✓</span>}
                  </div>
                  <div>
                    <div style={{color:sel2?"#fbbf24":"#e2e8f0",fontSize:14}}>{p.name}</div>
                    <div style={{color:"#475569",fontSize:11}}>{p.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
        <button onClick={saveTeam} disabled={saving}
          style={{width:"100%",padding:"13px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>
          {saving?"Saving…":"Save Team"}
        </button>
      </div>
    </div>
  );

  if (view==="detail" && sel) {
    var teamPlayers = players.filter(p=>sel.playerIds&&sel.playerIds.includes(p.id));
    return (
      <div style={S.page}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>setView("list")} style={S.btnSm}>← Back</button>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>{sel.name.toUpperCase()}</h2>
          </div>
          <div style={{color:"#64748b",fontSize:12,marginBottom:14}}>{teamPlayers.length} players</div>
          {teamPlayers.map(p=><PlayerStatsCard key={p.id} p={p}/>)}
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={S.btnSm}>← Back</button>
            <h2 style={{color:"#fbbf24",margin:0,fontSize:16,letterSpacing:2}}>👥 TEAMS</h2>
          </div>
          <button onClick={()=>setView("create")}
            style={{padding:"7px 14px",background:"linear-gradient(135deg,#fbbf24,#d97706)",border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            + Create
          </button>
        </div>
        {loading && <div style={{color:"#475569",textAlign:"center",padding:40}}>Loading…</div>}
        {!loading && teams.length===0 && (
          <div style={{color:"#475569",textAlign:"center",padding:40,lineHeight:1.8}}>
            No teams yet.<br/><span style={{fontSize:12}}>Create a team to save your squad.</span>
          </div>
        )}
        {teams.map(t=>(
          <div key={t.id} onClick={()=>{setSel(t);setView("detail");}}
            style={{background:"#1e293b",borderRadius:14,padding:"14px 16px",marginBottom:10,border:"1px solid #334155",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{color:"#f1f5f9",fontSize:15,fontWeight:"bold"}}>{t.name}</div>
              <div style={{color:"#64748b",fontSize:12,marginTop:3}}>{(t.playerIds||[]).length} players</div>
            </div>
            <span style={{color:"#475569",fontSize:18}}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TeamPickerModal — pick a saved team + select playing XI ──
function TeamPickerModal({ slot, onConfirm, onCancel }) {
  // slot: "A" | "B"
  const [teams,   setTeams]   = React.useState([]);
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [step,    setStep]    = React.useState("pick"); // pick | squad | name
  const [selTeam, setSelTeam] = React.useState(null);
  const [selIds,  setSelIds]  = React.useState([]);
  const [teamName, setTeamName] = React.useState("");
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (!_fbDB) { setLoading(false); return; }
    Promise.all([
      _fbDB.ref("teams").once("value"),
      _fbDB.ref("players").once("value"),
    ]).then(([tSnap, pSnap]) => {
      var tVal = tSnap.val() || {};
      var pVal = pSnap.val() || {};
      setTeams(Object.values(tVal).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
      setPlayers(Object.values(pVal).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  function pickTeam(t) {
    setSelTeam(t);
    setSelIds([...(t.playerIds||[])]);
    setTeamName(t.name);
    setStep("squad");
  }

  function toggleSel(id) {
    setSelIds(ids => ids.includes(id) ? ids.filter(x=>x!==id) : [...ids, id]);
  }

  function confirm() {
    if (selIds.length < 2) return setErr("Select at least 2 players");
    var squadPlayers = players.filter(p=>selIds.includes(p.id));
    // Return: teamName, list of {id, name} for batters AND bowlers
    onConfirm({
      teamName: teamName||selTeam?.name||"Team",
      players: squadPlayers.map(p=>({id:p.id, name:p.name, role:p.role})),
    });
  }

  var squadPool = selTeam ? players.filter(p=>(selTeam.playerIds||[]).includes(p.id)) : [];
  var ov = { position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center" };
  var box = { background:"#1e293b",borderRadius:"20px 20px 0 0",padding:"22px 20px 36px",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto" };

  if (loading) return <div style={ov}><div style={box}><div style={{color:"#475569",textAlign:"center",padding:30}}>Loading…</div></div></div>;

  if (step==="pick") return (
    <div style={ov}>
      <div style={box}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{color:"#fbbf24",fontSize:15,fontWeight:"bold"}}>Pick Team {slot}</div>
          <button onClick={onCancel} style={{...S.btnSm}}>✕ Cancel</button>
        </div>
        {teams.length===0 && <div style={{color:"#475569",fontSize:13,textAlign:"center",padding:20}}>No saved teams — enter names manually in the setup wizard.</div>}
        {teams.map(t=>(
          <div key={t.id} onClick={()=>pickTeam(t)}
            style={{background:"#0f172a",borderRadius:12,padding:"12px 14px",marginBottom:8,border:"1px solid #334155",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{color:"#e2e8f0",fontSize:14,fontWeight:"bold"}}>{t.name}</div>
              <div style={{color:"#475569",fontSize:12}}>{(t.playerIds||[]).length} players in squad</div>
            </div>
            <span style={{color:"#fbbf24",fontSize:18}}>›</span>
          </div>
        ))}
        <button onClick={onCancel} style={{width:"100%",marginTop:12,padding:"11px 0",background:"transparent",border:"1px solid #334155",borderRadius:10,color:"#64748b",fontFamily:"Georgia,serif",fontSize:13,cursor:"pointer"}}>
          Enter names manually instead
        </button>
      </div>
    </div>
  );

  if (step==="squad") return (
    <div style={ov}>
      <div style={box}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{color:"#fbbf24",fontSize:15,fontWeight:"bold"}}>Select Playing XI</div>
          <button onClick={()=>setStep("pick")} style={S.btnSm}>← Back</button>
        </div>
        <div style={{color:"#64748b",fontSize:12,marginBottom:14}}>Tap players to include/exclude · {selIds.length} selected</div>
        <div style={{marginBottom:14}}>
          <label style={{color:"#64748b",fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>TEAM NAME</label>
          <input value={teamName} onChange={e=>setTeamName(e.target.value)}
            style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 12px",color:"#f1f5f9",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}/>
        </div>
        {squadPool.map(p=>{
          var on = selIds.includes(p.id);
          return (
            <div key={p.id} onClick={()=>toggleSel(p.id)}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,marginBottom:6,border:on?"1px solid #fbbf24":"1px solid #334155",background:on?"rgba(251,191,36,.08)":"#0f172a",cursor:"pointer"}}>
              <div style={{width:22,height:22,borderRadius:6,border:on?"2px solid #fbbf24":"1px solid #475569",background:on?"#fbbf24":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {on&&<span style={{color:"#0f172a",fontSize:13,fontWeight:"bold"}}>✓</span>}
              </div>
              <div style={{flex:1}}>
                <div style={{color:on?"#fbbf24":"#e2e8f0",fontSize:14}}>{p.name}</div>
                <div style={{color:"#475569",fontSize:11}}>{p.role}</div>
              </div>
            </div>
          );
        })}
        {err&&<div style={{color:"#f87171",fontSize:12,margin:"8px 0",padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
        <button onClick={confirm}
          style={{width:"100%",marginTop:14,padding:"13px 0",background:"linear-gradient(135deg,#fbbf24,#d97706)",borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Georgia,serif"}}>
          Confirm Team ({selIds.length})
        </button>
      </div>
    </div>
  );

  return null;
}

ReactDOM.createRoot(document.getElementById("app")).render(
  React.createElement(AuthGate, null, React.createElement(App))
);
