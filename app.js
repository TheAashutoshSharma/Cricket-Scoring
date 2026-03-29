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
var _fbStorage = null;
function initFB() {
  if (_fbApp) return true;
  try {
    _fbApp    = firebase.initializeApp(FIREBASE_CONFIG);
    _fbDB     = firebase.database();
    _fbAuth   = firebase.auth();
    if (firebase.storage) _fbStorage = firebase.storage();
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
  teamAPlayers: Array.from({length:6},(_,i)=>"Player "+(i+1)),
  teamBPlayers: Array.from({length:6},(_,i)=>"Player "+(i+1)),
  teamACount:6, teamBCount:6,
  teamAPlayerIds:[], teamBPlayerIds:[],
  tossWinner: null,   // 0=teamA, 1=teamB
  battingFirst: 0,    // 0=teamA bats first, 1=teamB bats first
});

const blankMatch = (setup, code) => {
  var bf = (setup.battingFirst === 1) ? 1 : 0;
  var aPIds  = setup.teamAPlayerIds  || [];
  var bPIds  = setup.teamBPlayerIds  || [];
  var aPlayers = setup.teamAPlayers.slice(0,setup.teamACount||6).map((n,i)=>({...mkP(n), playerId: aPIds[i]||null}));
  var bPlayers = setup.teamBPlayers.slice(0,setup.teamBCount||6).map((n,i)=>({...mkP(n), playerId: bPIds[i]||null}));
  // Always start batting=0. If Team B bats first, swap them into slot 0 (first-innings slot).
  // The rest of the codebase assumes batting=0 is first innings, batting=1 is second/chase.
  var firstTeam  = bf===1 ? {name:setup.teamBName||"Team B", players:bPlayers, bowlers:[]} : {name:setup.teamAName||"Team A", players:aPlayers, bowlers:[]};
  var secondTeam = bf===1 ? {name:setup.teamAName||"Team A", players:aPlayers, bowlers:[]} : {name:setup.teamBName||"Team B", players:bPlayers, bowlers:[]};
  var firstCount  = bf===1 ? (setup.teamBCount||6) : (setup.teamACount||6);
  var secondCount = bf===1 ? (setup.teamACount||6) : (setup.teamBCount||6);
  return {
    matchCode: code, createdAt: Date.now(),
    totalOvers: setup.overs,
    batting: 0, striker:0,
    currentBatsmen:[0,1], currentBowler:0,
    runs:[0,0], wickets:[0,0], overs:[0,0], balls:[0,0],
    extras:[0,0],
    extrasBreakdown:[{wide:0,noBall:0,bye:0,legBye:0},{wide:0,noBall:0,bye:0,legBye:0}],
    ballLog:[[],[]],
    inningsOver:[false,false],
    numPlayers:[firstCount, secondCount],
    needsBowler: true,
    needsOpeners: true, // show opening batsmen picker at match start
    tossWinner: setup.tossWinner,
    battingFirst: bf,
    teamA: firstTeam,
    teamB: secondTeam,
  };
};

// ── Helpers ──────────────────────────────────────────────────────
const srFn  = p => (!p||p.balls===0)?"-":((p.runs/p.balls)*100).toFixed(1);
const ecoFn = b => { var o=b.overs+b.balls/6; return o===0?"-":(b.runs/o).toFixed(2); };
const bBg   = b => b.retired?"#0891b2":b.wicket?"#ef4444":b.r===6?"#f59e0b":b.r===4?"#3b82f6":b.declared?"#0e7490":b.extra?"#7c3aed":"#334155";
const bTxt  = b => b.retired?"RH":b.wicket?"W":b.declared?"1D":b.extra?(b.r+b.extra[0]):String(b.r);
// Max wickets before innings ends = numPlayers (last man bats alone, innings ends when last man out)
const maxWkts = (m, bt) => (m.numPlayers ? m.numPlayers[bt] : 11);
// Chase is won only in the 2nd innings (first innings must be complete)
const chaseWon = (m) => m.inningsOver && m.inningsOver[0] && m.batting===1 && m.runs[1] > m.runs[0];

// Normalise match data from Firebase — Firebase silently drops empty arrays/nulls
function normaliseMatch(v) {
  if (!v) return v;
  if (!v.teamA) v.teamA = {name:"Team A", players:[], bowlers:[]};
  if (!v.teamB) v.teamB = {name:"Team B", players:[], bowlers:[]};
  if (!v.teamA.players) v.teamA.players = [];
  if (!v.teamA.bowlers) v.teamA.bowlers = [];
  if (!v.teamB.players) v.teamB.players = [];
  if (!v.teamB.bowlers) v.teamB.bowlers = [];
  if (!v.ballLog) v.ballLog = [[],[]];
  else { if (!v.ballLog[0]) v.ballLog[0]=[]; if (!v.ballLog[1]) v.ballLog[1]=[]; }
  if (!v.inningsOver) v.inningsOver = [false, false];
  if (!v.runs) v.runs = [0,0];
  if (!v.wickets) v.wickets = [0,0];
  if (!v.overs) v.overs = [0,0];
  if (!v.balls) v.balls = [0,0];
  if (!v.extras) v.extras = [0,0];
  var eb = {wide:0,noBall:0,bye:0,legBye:0};
  if (!v.extrasBreakdown) v.extrasBreakdown = [Object.assign({},eb), Object.assign({},eb)];
  else {
    if (!v.extrasBreakdown[0]) v.extrasBreakdown[0] = Object.assign({},eb);
    if (!v.extrasBreakdown[1]) v.extrasBreakdown[1] = Object.assign({},eb);
  }
  if (!v.currentBatsmen) v.currentBatsmen = [0,1];
  if (!v.numPlayers) v.numPlayers = [v.teamA.players.length||2, v.teamB.players.length||2];
  return v;
}

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
      <div style={{background:SP.bg3,borderRadius:12,padding:24,width:"100%",maxWidth:340,border:"1px solid rgba(73,72,71,.25)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{color:SP.textSec,fontSize:11,letterSpacing:2,marginBottom:12}}>
          EDIT {editing.type==="player"?"BATTER":"BOWLER"} NAME
        </div>
        <input
          ref={inputRef}
          value={editVal}
          onChange={e=>setEditVal(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")onCommit();if(e.key==="Escape")onCancel();}}
          style={{width:"100%",background:SP.bg,border:"2px solid #fbbf24",borderRadius:10,padding:"12px 14px",color:"#fff",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:14}}
        />
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel}
            style={{flex:1,padding:"11px 0",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textSec,fontWeight:"bold",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontSize:14}}>
            Cancel
          </button>
          <button onClick={onCommit}
            style={{flex:2,padding:"11px 0",background:SP.primary,border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontSize:14}}>
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
      <div style={{background:SP.bg3,borderRadius:12,padding:22,width:"100%",maxWidth:340,border:"1px solid rgba(73,72,71,.25)"}}>
        <div style={{color:"#a78bfa",fontSize:11,letterSpacing:2,marginBottom:4}}>{extra.toUpperCase()}</div>
        <div style={{color:"#fff",fontSize:15,marginBottom:16}}>
          {isNB ? "How many runs did the batter score?" : "How many wides were called?"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:16}}>
          {runs.map(r=>(
            <button key={r} onClick={()=>onConfirm(r)}
              style={{padding:"14px 0",borderRadius:10,border:r===4?"2px solid #3b82f6":r===6?"2px solid #f59e0b":"1px solid #4c1d95",background:r===4?"rgba(59,130,246,.12)":r===6?"rgba(245,158,11,.12)":"rgba(109,40,217,.12)",color:r===4?"#60a5fa":r===6?"#fbbf24":"#a78bfa",fontWeight:"bold",fontSize:18,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              {r}
            </button>
          ))}
        </div>
        {isNB && <div style={{color:SP.textDim,fontSize:11,marginBottom:14,textAlign:"center"}}>+1 penalty run added automatically</div>}
        <button onClick={onCancel}
          style={{width:"100%",padding:"10px 0",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textSec,fontWeight:"bold",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontSize:14}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── OpeningBatsmenModal — pick both openers before first ball ──
function OpeningBatsmenModal({match, onSelect}) {
  if (!match) return null;
  var bt = match.batting;
  var bTeam = bt===0 ? match.teamA : match.teamB;
  const [picking, setPicking] = React.useState("striker"); // "striker" | "nonStriker"
  const [strikerIdx, setStrikerIdx] = React.useState(null);
  const [search, setSearch] = React.useState("");

  var openerChosen = picking==="nonStriker" ? new Set([strikerIdx]) : new Set();
  var avail = bTeam.players.map((p,i)=>({...p,i})).filter(p=>!openerChosen.has(p.i));
  var filtered = avail.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));

  function pick(idx) {
    if (picking==="striker") {
      setStrikerIdx(idx); setPicking("nonStriker"); setSearch("");
    } else {
      onSelect(strikerIdx, idx);
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid rgba(73,72,71,.25)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
        <div style={{textAlign:"center",marginBottom:14,flexShrink:0}}>
          <div style={{fontSize:26,marginBottom:6}}>🏏</div>
          <div style={{color:SP.primary,fontSize:14,fontWeight:"bold",letterSpacing:1,marginBottom:4}}>
            {picking==="striker"?"SELECT OPENING STRIKER":"SELECT NON-STRIKER"}
          </div>
          {picking==="nonStriker"&&strikerIdx!==null&&(
            <div style={{color:SP.textDim,fontSize:12}}>Striker: <b style={{color:"#fff"}}>{bTeam.players[strikerIdx].name}</b></div>
          )}
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:12,flexShrink:0}}>
          {["Striker","Non-Striker"].map((lbl,i)=>{
            var active = i===(picking==="striker"?0:1);
            return (
              <div key={lbl} style={{padding:"4px 14px",borderRadius:999,background:active?"rgba(156,255,147,.1)":"transparent",border:active?"1px solid rgba(156,255,147,.3)":"1px solid rgba(73,72,71,.2)"}}>
                <span style={{color:active?SP.primary:SP.textDim,fontSize:11,fontWeight:"600"}}>{i+1}. {lbl}</span>
              </div>
            );
          })}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
          style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"9px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:10,flexShrink:0}}/>
        <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map(p=>(
            <button key={p.i} onClick={()=>pick(p.i)}
              style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(73,72,71,.25)",background:SP.bg,
                color:"#fff",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",
                display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
              <div>
                <div style={{fontWeight:"bold",marginBottom:2}}>{p.name}</div>
                <div style={{color:SP.textDim,fontSize:11}}>{p.role||"Batsman"}</div>
              </div>
              <span style={{color:SP.primary,fontSize:18}}>→</span>
            </button>
          ))}
        </div>
        {picking==="nonStriker"&&(
          <button onClick={()=>{setPicking("striker");setStrikerIdx(null);setSearch("");}}
            style={{marginTop:12,width:"100%",padding:"10px 0",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",flexShrink:0}}>
            ← Back
          </button>
        )}
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid rgba(73,72,71,.25)",borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:26,marginBottom:6}}>🏏</div>
          <div style={{color:SP.primary,fontSize:14,fontWeight:"bold",letterSpacing:1,marginBottom:4}}>NEXT BATSMAN IN</div>
          {lastOut && (
            <div style={{color:SP.textDim,fontSize:12,marginBottom:2}}>
              {lastOut.name} — {lastOut.out ? lastOut.howOut : "Retired"} · {lastOut.runs} ({lastOut.balls})
            </div>
          )}
          <div style={{color:SP.textSec,fontSize:13}}>Select who comes in next</div>
        </div>
        {available.length === 0 ? (
          <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:16}}>No batters available</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"50vh",overflowY:"auto"}}>
            {available.map(p=>{
              var sr = p.balls>0 ? ((p.runs/p.balls)*100).toFixed(0) : null;
              return (
                <button key={p.i} onClick={()=>onSelect(p.i)}
                  style={{padding:"13px 16px",borderRadius:12,border:"1px solid rgba(73,72,71,.25)",background:SP.bg,color:"#fff",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                  <div>
                    <div style={{fontWeight:"bold",marginBottom:2}}>{p.name}</div>
                    {p.balls > 0 && <div style={{color:SP.textDim,fontSize:11}}>{p.runs} runs · {p.balls} balls · SR {sr}</div>}
                    {p.balls === 0 && <div style={{color:SP.textDim,fontSize:11}}>Yet to bat</div>}
                  </div>
                  <span style={{color:SP.primary,fontSize:18}}>→</span>
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
      <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid #0e7490",borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:28,marginBottom:6}}>🩹</div>
          <div style={{color:"#67e8f9",fontSize:14,fontWeight:"bold",letterSpacing:1,marginBottom:4}}>LAST WICKET FALLEN</div>
          <div style={{color:SP.textSec,fontSize:13}}>Retired hurt player(s) can come back to bat</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {retiredPlayers.map(p=>(
            <button key={p.i} onClick={()=>onRecall(p.i)}
              style={{padding:"13px 16px",borderRadius:12,border:"1px solid #0e7490",background:"rgba(8,145,178,.12)",color:"#67e8f9",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:"bold"}}>{p.name}</span>
              <span style={{color:"#0891b2",fontSize:12}}>{p.runs} runs off {p.balls} balls · Recall →</span>
            </button>
          ))}
        </div>
        <button onClick={onDecline}
          style={{width:"100%",padding:"12px 0",background:SP.bg,border:"1px solid #7f1d1d",borderRadius:12,color:SP.tertiary,fontWeight:"bold",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontSize:14}}>
          End Innings
        </button>
      </div>
    </div>
  );
}

// ── OverCompleteModal — pick bowler from fielding team's players ──
function OverCompleteModal({match, onSelect, isFirstBall}) {
  if (!match) return null;
  var bt = match.batting;
  // Fielding team = bowling team (opposite of batting)
  var wTeam = bt===0 ? match.teamB : match.teamA;
  var prevBowlerIdx = match.currentBowler; // index into wTeam.bowlers (may not exist yet)
  var prevBowlerName = wTeam.bowlers[prevBowlerIdx]?.name;

  const [search, setSearch] = React.useState("");

  // All players of the fielding team
  var allFielders = wTeam.players;

  // Build a map: playerName -> bowler stats (if they've bowled before)
  var bowlerStatMap = {};
  wTeam.bowlers.forEach((b,i) => { bowlerStatMap[b.name] = {...b, bowlerIdx: i}; });

  var filtered = allFielders.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  function pick(player, bowlerIdx) {
    if (bowlerIdx !== undefined) {
      // Already bowled before — select by existing index
      onSelect(bowlerIdx, null, null);
    } else {
      // First time bowling — add to bowlers list
      onSelect(null, player.name, player.playerId || null);
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid rgba(73,72,71,.25)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{color:SP.primary,fontSize:13,fontWeight:"bold",letterSpacing:2,marginBottom:4}}>
            {isFirstBall ? "SELECT OPENING BOWLER" : "OVER COMPLETE"}
          </div>
          <div style={{color:SP.textSec,fontSize:13}}>
            Who will bowl {isFirstBall ? "this innings" : "next over"}?
          </div>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player…"
          style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"10px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:12}}/>
        <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map((player, pi) => {
            var stats = bowlerStatMap[player.name];
            var hasBowled = !!stats;
            var isJustBowled = !isFirstBall && player.name === prevBowlerName;
            return (
              <button key={pi} onClick={()=>!isJustBowled && pick(player, hasBowled ? stats.bowlerIdx : undefined)}
                disabled={isJustBowled}
                style={{padding:"12px 14px",borderRadius:12,border:isJustBowled?"1px solid rgba(73,72,71,.15)":hasBowled?"1px solid rgba(73,72,71,.25)":"1px solid #1e3a5f",background:isJustBowled?"#0a1120":hasBowled?"#0f172a":"rgba(30,58,95,.3)",color:isJustBowled?"#334155":"#e2e8f0",fontSize:14,cursor:isJustBowled?"not-allowed":"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center",opacity:isJustBowled?0.4:1,textAlign:"left"}}>
                <div>
                  <div style={{fontWeight: hasBowled?"normal":"bold",color:isJustBowled?"#334155":hasBowled?"#e2e8f0":"#93c5fd"}}>{player.name}</div>
                  {!hasBowled && !isJustBowled && <div style={{color:SP.textDim,fontSize:11}}>Yet to bowl</div>}
                </div>
                {hasBowled && (
                  <span style={{color:SP.textDim,fontSize:11}}>
                    {stats.overs}.{stats.balls} ov · {stats.runs}r · {stats.wickets}w{isJustBowled?" · just bowled":""}
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:20}}>No players found</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────
// ── Stadium Pulse Design System ──────────────────────────────────
const SP = {
  bg:       "#0e0e0e",
  bg2:      "#131313",
  bg3:      "#1a1919",
  bg4:      "#201f1f",
  bg5:      "#262626",
  primary:  "#9cff93",
  secondary:"#669dff",
  tertiary: "#ff7072",
  textPri:  "#ffffff",
  textSec:  "#adaaaa",
  textDim:  "#777575",
  border:   "rgba(73,72,71,.25)",
};

const S = {
  card:  { margin:"0 0 8px", background:SP.bg3, borderRadius:12, padding:"16px", border:"none" },
  lbl:   { color:SP.textDim, fontSize:9, marginBottom:8, letterSpacing:3, textTransform:"uppercase", fontWeight:"700", fontFamily:"Lexend,Georgia,sans-serif" },
  btnSm: { background:SP.bg4, border:"1px solid rgba(73,72,71,.3)", color:SP.textSec, padding:"6px 12px",
           borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"Lexend,Georgia,sans-serif", whiteSpace:"nowrap", letterSpacing:.5, fontWeight:"600" },
  page:  { minHeight:"100dvh", background:SP.bg, fontFamily:"Lexend,Georgia,sans-serif", paddingBottom:88 },
  wrap:  { maxWidth:480, margin:"0 auto" },
  topBar:{ position:"sticky", top:0, zIndex:50, background:"rgba(14,14,14,.85)", backdropFilter:"blur(20px)",
           WebkitBackdropFilter:"blur(20px)", borderBottom:"1px solid rgba(73,72,71,.15)",
           padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  bottomNav:{ position:"fixed", bottom:0, left:0, width:"100%", zIndex:50,
              background:"rgba(14,14,14,.85)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
              borderTop:"1px solid rgba(73,72,71,.15)", display:"flex", justifyContent:"space-around",
              alignItems:"center", paddingTop:10, paddingBottom:24,
              boxShadow:"0 -4px 24px rgba(0,0,0,.5)", borderRadius:"24px 24px 0 0" },
  navItem:{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer",
            padding:"4px 16px", borderRadius:12, transition:"background .15s" },
};

// Inject Lexend font + global CSS once
if (typeof document !== "undefined" && !document.getElementById("sp-global")) {
  var _link = document.createElement("link");
  _link.rel = "stylesheet";
  _link.href = "https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800;900&display=swap";
  document.head.appendChild(_link);
  var _style = document.createElement("style");
  _style.id = "sp-global";
  _style.textContent = [
    "* { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }",
    "body { background:#0e0e0e; font-family:'Lexend',Georgia,sans-serif; color:#fff; }",
    ".sp-input { width:100%; background:#000; border:none; border-bottom:2px solid #262626; border-radius:0;",
    "  padding:14px 0; color:#fff; font-size:15px; outline:none; font-family:'Lexend',Georgia,sans-serif;",
    "  transition:border-color .2s; }",
    ".sp-input:focus { border-bottom-color:#669dff; }",
    ".sp-input::placeholder { color:#494847; }",
    ".sp-btn-primary { width:100%; padding:16px 0; background:#9cff93; border:none; border-radius:6px;",
    "  color:#00440a; font-weight:800; font-size:14px; cursor:pointer;",
    "  font-family:'Lexend',Georgia,sans-serif; letter-spacing:1.5px; text-transform:uppercase;",
    "  box-shadow:0 0 24px rgba(156,255,147,.2); transition:transform .1s,opacity .15s; }",
    ".sp-btn-primary:active { transform:scale(.98); opacity:.9; }",
    ".sp-btn-primary:disabled { opacity:.4; cursor:not-allowed; }",
    ".sp-btn-secondary { width:100%; padding:14px 0; background:transparent;",
    "  border:1px solid rgba(102,157,255,.25); border-radius:6px; color:#669dff;",
    "  font-weight:700; font-size:13px; cursor:pointer;",
    "  font-family:'Lexend',Georgia,sans-serif; letter-spacing:1px; text-transform:uppercase; }",
    ".sp-btn-secondary:active { background:rgba(102,157,255,.08); }",
    ".sp-btn-danger { width:100%; padding:14px 0; background:#ff7072; border:none; border-radius:6px;",
    "  color:#490009; font-weight:800; font-size:13px; cursor:pointer;",
    "  font-family:'Lexend',Georgia,sans-serif; letter-spacing:1px; text-transform:uppercase; }",
    ".sp-btn-danger:active { opacity:.85; }",
    ".sp-run-btn { border-radius:12px; font-weight:800; font-size:20px; cursor:pointer;",
    "  font-family:'Lexend',Georgia,sans-serif; aspect-ratio:1; display:flex;",
    "  align-items:center; justify-content:center; transition:transform .08s,opacity .1s;",
    "  -webkit-tap-highlight-color:transparent; border:none; }",
    ".sp-run-btn:active { transform:scale(.9); opacity:.8; }",
    ".sp-action-btn { flex:1; padding:14px 0; border-radius:8px; font-weight:700; font-size:13px;",
    "  cursor:pointer; font-family:'Lexend',Georgia,sans-serif; letter-spacing:.5px; text-transform:uppercase;",
    "  transition:transform .08s; -webkit-tap-highlight-color:transparent; border:none; }",
    ".sp-action-btn:active { transform:scale(.97); }",
    ".sp-card { background:#131313; border-radius:12px; padding:16px; margin-bottom:8px; }",
    ".sp-card-high { background:#1a1919; border-radius:12px; padding:16px; }",
    ".sp-live-dot { display:inline-block; width:7px; height:7px; border-radius:50%;",
    "  background:#9cff93; box-shadow:0 0 8px #9cff93; animation:sp-pulse 1.4s infinite; }",
    "@keyframes sp-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.75)} }",
    ".sp-momentum { border-left:2px solid #669dff; }",
    ".sp-tab { flex:1; padding:10px 0; background:none; border:none; border-bottom:2px solid transparent;",
    "  color:#777575; font-family:'Lexend',Georgia,sans-serif; font-size:11px; cursor:pointer;",
    "  letter-spacing:1.5px; text-transform:uppercase; font-weight:700; transition:color .2s,border-color .2s; }",
    ".sp-tab.active { color:#669dff; border-bottom-color:#669dff; }",
    ".sp-select { width:100%; background:#000; border:none; border-bottom:2px solid #262626;",
    "  padding:12px 0; color:#fff; font-size:13px; outline:none;",
    "  font-family:'Lexend',Georgia,sans-serif; appearance:none; }",
    ".sp-pill { display:inline-flex; align-items:center; gap:4px; padding:3px 10px;",
    "  border-radius:999px; font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; }",
  ].join("\n");
  document.head.appendChild(_style);
}


// ════════════════════════════════════════════════════════════════
// ── MatchMediaGallery — photo/video uploads per match ────────────
function MatchMediaGallery({ matchCode, currentUser }) {
  const [media,       setMedia]       = React.useState(null);  // null=loading, []=empty
  const [uploading,   setUploading]   = React.useState(false);
  const [uploadPct,   setUploadPct]   = React.useState(0);
  const [err,         setErr]         = React.useState("");
  const [caption,     setCaption]     = React.useState("");
  const [lightbox,    setLightbox]    = React.useState(null);  // {url,type,caption,uploader}
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    if (!matchCode || matchCode==="LOCAL" || !_fbDB) return;
    var ref = _fbDB.ref("matchMedia/"+matchCode);
    ref.on("value", snap => {
      var val = snap.val() || {};
      var list = Object.values(val).sort((a,b)=>(b.uploadedAt||0)-(a.uploadedAt||0));
      setMedia(list);
    });
    return () => ref.off();
  }, [matchCode]);

  function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 50*1024*1024) { setErr("File too large — max 50 MB"); return; }
    var isVideo = file.type.startsWith("video/");
    var isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) { setErr("Only photos and videos are supported"); return; }
    setErr(""); setUploading(true); setUploadPct(0);

    if (!_fbStorage) { setErr("Firebase Storage not available"); setUploading(false); return; }
    var ext = file.name.split(".").pop();
    var path = "matchMedia/"+matchCode+"/"+Date.now()+"_"+Math.random().toString(36).slice(2,6)+"."+ext;
    var ref = _fbStorage.ref(path);
    var task = ref.put(file);
    task.on("state_changed",
      snap => setUploadPct(Math.round(snap.bytesTransferred/snap.totalBytes*100)),
      err2 => { setErr(err2.message); setUploading(false); },
      () => {
        task.snapshot.ref.getDownloadURL().then(url => {
          var entry = {
            url, path,
            type: isVideo ? "video" : "image",
            caption: caption.trim() || "",
            uploader: currentUser ? (currentUser.displayName||currentUser.email||"Unknown") : "Guest",
            uploadedAt: Date.now(),
          };
          var key = Date.now()+"_"+Math.random().toString(36).slice(2,6);
          _fbDB.ref("matchMedia/"+matchCode+"/"+key).set(entry);
          setCaption(""); setUploading(false); setUploadPct(0);
          if (fileInputRef.current) fileInputRef.current.value = "";
        });
      }
    );
  }

  function deleteMedia(item) {
    if (!currentUser) return;
    var isOwn = item.uploader === (currentUser.displayName||currentUser.email||"Unknown");
    var isAdminUser = !!(currentUser && typeof ADMIN_EMAILS !== "undefined" && ADMIN_EMAILS.includes(currentUser.email));
    if (!isOwn && !isAdminUser) return;
    if (!confirm("Delete this media?")) return;
    // Remove from DB (find the key)
    _fbDB.ref("matchMedia/"+matchCode).once("value", snap => {
      var val = snap.val()||{};
      Object.entries(val).forEach(([k,v]) => {
        if (v.url === item.url) _fbDB.ref("matchMedia/"+matchCode+"/"+k).remove();
      });
    });
    // Remove from Storage
    if (_fbStorage && item.path) {
      _fbStorage.ref(item.path).delete().catch(()=>{});
    }
  }

  if (!matchCode || matchCode==="LOCAL") return null;

  return (
    <div style={{marginTop:20,marginBottom:8}}>
      <div style={{...S.lbl,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>📸 MATCH MEDIA</span>
        {media&&media.length>0&&<span style={{color:SP.textDim,fontWeight:"400"}}>{media.length} item{media.length!==1?"s":""}</span>}
      </div>

      {/* Upload section — logged in users only */}
      {currentUser && (
        <div style={{background:SP.bg2,borderRadius:12,padding:"14px 16px",marginBottom:12}}>
          <input value={caption} onChange={e=>setCaption(e.target.value)}
            placeholder="Add a caption (optional)…"
            style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,
              padding:"9px 12px",color:"#fff",fontSize:13,outline:"none",boxSizing:"border-box",
              fontFamily:"Lexend,Georgia,sans-serif",marginBottom:10}}/>
          <input ref={fileInputRef} type="file" accept="image/*,video/*"
            onChange={handleFileChange} style={{display:"none"}} id="media-file-input"/>
          {!uploading ? (
            <button onClick={()=>fileInputRef.current&&fileInputRef.current.click()}
              style={{width:"100%",padding:"11px 0",background:"rgba(102,157,255,.1)",border:"1px solid rgba(102,157,255,.3)",
                borderRadius:10,color:SP.secondary,fontWeight:"700",fontSize:13,cursor:"pointer",
                fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:.5}}>
              📎 Add Photo / Video
            </button>
          ) : (
            <div>
              <div style={{height:6,background:SP.bg3,borderRadius:3,overflow:"hidden",marginBottom:6}}>
                <div style={{height:"100%",width:uploadPct+"%",background:SP.secondary,borderRadius:3,transition:"width .2s"}}/>
              </div>
              <div style={{color:SP.textDim,fontSize:12,textAlign:"center"}}>Uploading {uploadPct}%…</div>
            </div>
          )}
          {err&&<div style={{color:SP.tertiary,fontSize:12,marginTop:8}}>{err}</div>}
        </div>
      )}

      {/* Media grid */}
      {media===null && <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"12px 0"}}>Loading…</div>}
      {media!==null && media.length===0 && (
        <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"16px 0"}}>
          {currentUser ? "No photos or videos yet — be the first to add one!" : "No media yet."}
        </div>
      )}
      {media!==null && media.length>0 && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {media.map((item,i)=>(
            <div key={i} onClick={()=>setLightbox(item)}
              style={{position:"relative",aspectRatio:"1",borderRadius:10,overflow:"hidden",
                background:SP.bg3,cursor:"pointer"}}>
              {item.type==="video" ? (
                <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:SP.bg2}}>
                  <span style={{fontSize:28}}>▶</span>
                  <div style={{position:"absolute",bottom:4,left:4,right:4,color:"#fff",fontSize:10,
                    textOverflow:"ellipsis",overflow:"hidden",whiteSpace:"nowrap"}}>{item.caption||"Video"}</div>
                </div>
              ) : (
                <img src={item.url} alt={item.caption||""}
                  style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              )}
              {item.caption&&item.type==="image"&&(
                <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"16px 4px 4px",
                  background:"linear-gradient(transparent,rgba(0,0,0,.7))",
                  color:"#fff",fontSize:9,textOverflow:"ellipsis",overflow:"hidden",whiteSpace:"nowrap"}}>
                  {item.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div onClick={()=>setLightbox(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:2000,
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16}}>
          <button onClick={()=>setLightbox(null)}
            style={{position:"absolute",top:16,right:16,background:"none",border:"none",
              color:"#fff",fontSize:28,cursor:"pointer",zIndex:1}}>✕</button>
          {lightbox.type==="video" ? (
            <video src={lightbox.url} controls autoPlay onClick={e=>e.stopPropagation()}
              style={{maxWidth:"100%",maxHeight:"70vh",borderRadius:8}}/>
          ) : (
            <img src={lightbox.url} alt={lightbox.caption||""}
              style={{maxWidth:"100%",maxHeight:"70vh",borderRadius:8,objectFit:"contain"}}
              onClick={e=>e.stopPropagation()}/>
          )}
          <div style={{marginTop:12,textAlign:"center"}}>
            {lightbox.caption&&<div style={{color:"#fff",fontSize:14,marginBottom:4}}>{lightbox.caption}</div>}
            <div style={{color:SP.textDim,fontSize:11}}>
              {lightbox.uploader} · {lightbox.uploadedAt?new Date(lightbox.uploadedAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):""}
            </div>
          </div>
          {currentUser&&(lightbox.uploader===(currentUser.displayName||currentUser.email)||ADMIN_EMAILS.includes(currentUser.email))&&(
            <button onClick={e=>{e.stopPropagation();deleteMedia(lightbox);setLightbox(null);}}
              style={{marginTop:16,padding:"8px 20px",background:"transparent",border:"1px solid rgba(255,112,114,.4)",
                borderRadius:8,color:SP.tertiary,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              🗑️ Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── PlayerPhotoUpload — profile photo upload + display ───────────
function PlayerPhotoUpload({ player, currentUser, onPhotoSaved, editable }) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState(0);
  const [err, setErr]             = React.useState("");
  const fileRef = React.useRef(null);

  var photoUrl = player && player.photoUrl;

  function handleFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Only image files are supported"); return; }
    if (file.size > 5*1024*1024) { setErr("Max 5 MB for profile photos"); return; }
    if (!_fbStorage) { setErr("Firebase Storage not available"); return; }
    setErr(""); setUploading(true); setUploadPct(0);
    var ext = file.name.split(".").pop();
    var path = "playerPhotos/" + player.id + "." + ext;
    var ref = _fbStorage.ref(path);
    var task = ref.put(file);
    task.on("state_changed",
      snap => setUploadPct(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      err2 => { setErr(err2.message); setUploading(false); },
      () => {
        task.snapshot.ref.getDownloadURL().then(url => {
          if (_fbDB) _fbDB.ref("players/" + player.id + "/photoUrl").set(url);
          setUploading(false); setUploadPct(0);
          if (onPhotoSaved) onPhotoSaved(url);
        });
      }
    );
  }

  return (
    <div style={{position:"relative",width:80,height:80,margin:"0 auto 12px"}}>
      {photoUrl
        ? <img src={photoUrl} alt={player.name}
            style={{width:80,height:80,borderRadius:"50%",objectFit:"cover",border:"2px solid "+SP.bg3}}/>
        : <div style={{width:80,height:80,borderRadius:"50%",background:SP.primary,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,fontWeight:"bold",color:"#0f172a"}}>
            {player && player.name ? player.name[0].toUpperCase() : "?"}
          </div>
      }
      {editable && !uploading && (
        <>
          <button onClick={()=>fileRef.current&&fileRef.current.click()}
            style={{position:"absolute",bottom:0,right:0,width:26,height:26,borderRadius:"50%",background:SP.bg3,border:"2px solid "+SP.bg,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#fff",padding:0}}>
            📷
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
        </>
      )}
      {uploading && (
        <div style={{position:"absolute",inset:0,borderRadius:"50%",background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{color:"#fff",fontSize:11,fontWeight:"700"}}>{uploadPct}%</span>
        </div>
      )}
      {err && <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",color:SP.tertiary,fontSize:10,whiteSpace:"nowrap",marginTop:4}}>{err}</div>}
    </div>
  );
}


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
        // Find name/email from match entries as fallback (createdBy stored on each match)
        var nameFromMatches  = matchList.map(m => m.createdBy && m.createdBy.name).find(n => n && n.trim());
        var emailFromMatches = matchList.map(m => m.createdBy && m.createdBy.email).find(e => e && e.trim());
        var resolvedEmail = userInfo.email || emailFromMatches || uid;
        var resolvedName  = userInfo.name  || nameFromMatches  || resolvedEmail.split("@")[0] || "Unknown";
        grouped[uid] = {
          uid,
          name:    resolvedName,
          email:   resolvedEmail,
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
      <div style={{color:SP.primary,fontSize:13,marginBottom:20,textAlign:"center"}}>
        ✓ Admin — {currentUser ? (currentUser.displayName||currentUser.email) : ""}
      </div>

      {/* ── Firebase Rules reminder ── */}
      <div style={{background:"rgba(251,191,36,.07)",borderRadius:10,padding:16,border:"1px solid rgba(251,191,36,.25)",marginBottom:12}}>
        <div style={{color:SP.primary,fontSize:12,fontWeight:"bold",marginBottom:8}}>⚙️ Required Firebase Rules</div>
        <pre style={{color:SP.textSec,fontSize:10,lineHeight:1.7,margin:0,overflowX:"auto",whiteSpace:"pre-wrap"}}>{`{
  "rules": {
    "matches":          { ".read": true, ".write": true },
    "liveIndex":        { ".read": true, ".write": true },
    "completedMatches": { ".read": true, ".write": true },
    "userMatches":      { ".read": true, ".write": true },
    "users":            { ".read": true, ".write": true },
    "players":          { ".read": true, ".write": true },
    "teams":            { ".read": true, ".write": true },
    "matchMedia":       { ".read": true, ".write": true }
  }
}`}</pre>
        <div style={{color:SP.textDim,fontSize:10,marginTop:8}}>Firebase Console → Realtime Database → Rules</div>
      </div>

      {/* ── Firebase Storage Rules reminder ── */}
      <div style={{background:"rgba(102,157,255,.07)",borderRadius:10,padding:16,border:"1px solid rgba(102,157,255,.25)",marginBottom:12}}>
        <div style={{color:SP.secondary,fontSize:12,fontWeight:"bold",marginBottom:8}}>📸 Firebase Storage Rules</div>
        <pre style={{color:SP.textSec,fontSize:10,lineHeight:1.7,margin:0,overflowX:"auto",whiteSpace:"pre-wrap"}}>{`rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: true;
    }
  }
}`}</pre>
        <div style={{color:SP.textDim,fontSize:10,marginTop:8}}>Firebase Console → Storage → Rules</div>
      </div>

      {/* ── Matches by User ── */}
      <div style={{background:SP.bg3,borderRadius:10,padding:18,border:"1px solid rgba(73,72,71,.25)",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{color:SP.textSec,fontSize:13}}>👤 Matches by User</div>
          <button onClick={loadUserMatches} disabled={loadingUM}
            style={{padding:"5px 12px",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:8,color:SP.textSec,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            {loadingUM?"…":userMatches===null?"Load":"Refresh"}
          </button>
        </div>
        {msg==="RULES_ERROR" && (
          <div style={{color:SP.primary,fontSize:12,padding:"10px 12px",background:"rgba(156,255,147,.06)",borderRadius:8,marginBottom:10,lineHeight:1.6}}>
            ⚠️ Permission denied — update your Firebase Rules using the box above, then try again.
          </div>
        )}
        {msg&&msg!=="RULES_ERROR"&&<div style={{color:SP.tertiary,fontSize:12,marginBottom:8}}>{msg}</div>}
        {userMatches===null&&!loadingUM&&msg!=="RULES_ERROR"&&(
          <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"8px 0"}}>Tap Load to fetch all users' matches</div>
        )}
        {userMatches!==null&&Object.keys(userMatches).length===0&&(
          <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"10px 0",lineHeight:1.8}}>
            No matches found in Firebase.<br/>
            <span style={{color:"#334155",fontSize:11}}>Matches are saved when a scorer creates and starts a match while logged in. Check browser console (F12) for debug info.</span>
          </div>
        )}
        {userMatches!==null&&Object.values(userMatches).map(u=>(
          <div key={u.uid} style={{marginBottom:8,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,overflow:"hidden"}}>
            {/* User header */}
            <div onClick={()=>setExpandedUser(expandedUser===u.uid?null:u.uid)}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:SP.bg,cursor:"pointer"}}>
              <div>
                <div style={{color:"#fff",fontSize:13,fontWeight:"bold"}}>{u.name}</div>
                <div style={{color:SP.textDim,fontSize:11}}>{u.email} · {u.matches.length} match{u.matches.length!==1?"es":""}</div>
              </div>
              <div style={{color:SP.textDim,fontSize:14}}>{expandedUser===u.uid?"▲":"▼"}</div>
            </div>
            {/* Match list for this user */}
            {expandedUser===u.uid&&(
              <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
                {u.matches.map(m=>(
                  <div key={m.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:SP.bg3,borderRadius:8,padding:"8px 10px",border:"1px solid rgba(73,72,71,.25)"}}>
                    <div>
                      <div style={{color:"#fff",fontSize:12}}>{m.teamA} vs {m.teamB}</div>
                      <div style={{color:SP.textDim,fontSize:10}}>
                        {m.code} · {fmtAge(m.updatedAt||m.createdAt)} · {m.complete?"✓ Complete":"🔴 Live"}
                      </div>
                      <div style={{color:SP.textDim,fontSize:10}}>{fmtScore(m)}</div>
                    </div>
                    <button onClick={()=>{ if(confirm("Delete match "+m.code+"?")) deleteUserMatch(u.uid, m.code); }}
                      style={{padding:"5px 10px",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:8,color:SP.tertiary,fontSize:11,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
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
      <div style={{background:SP.bg3,borderRadius:10,padding:18,border:"1px solid rgba(73,72,71,.25)",marginBottom:12}}>
        <div style={{color:SP.textSec,fontSize:13,marginBottom:12}}>
          Local Match History: <b style={{color:"#fff"}}>{matchHistory.length} matches</b>
        </div>
        <button onClick={()=>{
          if(confirm("Permanently delete all local match history?")) {
            localStorage.removeItem(HIST_KEY);
            setMatchHistory([]);
            setMsg("Local history cleared");
          }
        }}
          style={{width:"100%",padding:"11px 0",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:10,color:SP.tertiary,fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
          🗑 Clear All Local History
        </button>
      </div>

      {/* ── Firebase live index ── */}
      <div style={{background:SP.bg3,borderRadius:10,padding:18,border:"1px solid rgba(73,72,71,.25)",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{color:SP.textSec,fontSize:13}}>🔴 Live Index (Firebase)</div>
          <button onClick={loadLiveIndex} disabled={loading}
            style={{padding:"5px 12px",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:8,color:SP.textSec,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            {loading?"…":liveEntries===null?"Load":"Refresh"}
          </button>
        </div>
        {liveEntries===null&&!loading&&(
          <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"8px 0"}}>Tap Load to fetch from Firebase</div>
        )}
        {liveEntries!==null&&liveEntries.length===0&&(
          <div style={{color:SP.textDim,fontSize:12,textAlign:"center",padding:"8px 0"}}>No entries in live index</div>
        )}
        {liveEntries!==null&&liveEntries.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {liveEntries.map(e=>(
              <div key={e.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:SP.bg,borderRadius:10,padding:"10px 12px",border:"1px solid rgba(73,72,71,.25)"}}>
                <div>
                  <div style={{color:"#fff",fontSize:13}}>{e.teamA} vs {e.teamB}</div>
                  <div style={{color:SP.textDim,fontSize:11}}>{e.code} · {fmtAge(e.updatedAt||e.createdAt)}</div>
                  {e.createdBy&&<div style={{color:SP.textDim,fontSize:10}}>by {e.createdBy.name||e.createdBy.email}</div>}
                </div>
                <button onClick={()=>deleteEntry(e.code)}
                  style={{padding:"6px 12px",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:8,color:SP.tertiary,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                  Remove
                </button>
              </div>
            ))}
            <button onClick={clearAllLive}
              style={{width:"100%",padding:"10px 0",background:"rgba(127,29,29,.2)",border:"1px solid #7f1d1d",borderRadius:10,color:SP.tertiary,fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",marginTop:4}}>
              🗑 Clear All Live Entries
            </button>
          </div>
        )}
      </div>

      {msg&&msg!=="RULES_ERROR"&&<div style={{color:SP.primary,fontSize:12,textAlign:"center",marginBottom:12}}>{msg}</div>}

      <button onClick={onDone}
        style={{width:"100%",padding:"11px 0",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
        Done
      </button>
    </div>
  );
}

// ── TossStep — coin toss in setup wizard ──────────────────────
function TossStep({teamAName, teamBName, tossWinner, battingFirst, onToss, onChoice}) {
  const [flipping,  setFlipping] = React.useState(false);
  const [coinFace,  setCoinFace] = React.useState(null);
  const [call,      setCall]     = React.useState(null);
  const [flipAngle, setFlipAngle] = React.useState(0);
  const flipRafRef = React.useRef(null);

  // Use refs so setTimeout callback always gets latest values
  const callRef    = React.useRef(null);
  const onTossRef  = React.useRef(onToss);
  React.useEffect(() => { onTossRef.current = onToss; }, [onToss]);

  function pickCall(c) {
    setCall(c);
    callRef.current = c;
  }

  function doToss() {
    var myCall = callRef.current;
    if (!myCall) return;
    setFlipping(true);
    setCoinFace(null);
    setFlipAngle(0);

    var result = Math.random() < 0.5 ? "heads" : "tails";
    var winner = result === myCall ? 0 : 1;
    // Animate: spin 8 full rotations over 1.4s, land on result face
    // heads = 0/360 deg, tails = 180 deg
    var targetExtra = result === "heads" ? 0 : 180;
    var totalRotation = 8 * 360 + targetExtra;
    var duration = 1400;
    var start = null;

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    function animate(ts) {
      if (!start) start = ts;
      var elapsed = ts - start;
      var progress = Math.min(elapsed / duration, 1);
      var angle = easeOut(progress) * totalRotation;
      setFlipAngle(angle);
      if (progress < 1) {
        flipRafRef.current = requestAnimationFrame(animate);
      } else {
        setFlipAngle(totalRotation);
        setFlipping(false);
        setCoinFace(result);
        onTossRef.current(winner);
      }
    }
    flipRafRef.current = requestAnimationFrame(animate);
  }

  // Cleanup RAF on unmount
  React.useEffect(() => () => { if (flipRafRef.current) cancelAnimationFrame(flipRafRef.current); }, []);

  function redo() {
    setCoinFace(null);
    setCall(null);
    callRef.current = null;
    onToss(null);
  }

  var tossWon    = tossWinner !== null && tossWinner !== undefined;
  var winnerName = tossWinner === 0 ? teamAName : teamBName;
  var loserName  = tossWinner === 0 ? teamBName : teamAName;

  // Use a stable unique prefix per TossStep instance to avoid duplicate SVG IDs
  const uid = React.useRef("t" + Math.random().toString(36).slice(2,6)).current;

  var CoinHeads = ({size=84}) => (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <defs>
        <radialGradient id={uid+"hg"} cx="38%" cy="35%">
          <stop offset="0%" stopColor="#ffe066"/>
          <stop offset="60%" stopColor="#d4a017"/>
          <stop offset="100%" stopColor="#a07800"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${uid}hg)`} stroke="#b8860b" strokeWidth="2"/>
      <circle cx="50" cy="50" r="43" fill="none" stroke="#d4a017" strokeWidth="1" strokeDasharray="4 3"/>
      <rect x="46" y="42" width="8" height="22" rx="1" fill="#7a5500"/>
      <rect x="40" y="36" width="20" height="7" rx="2" fill="#8a6200"/>
      <circle cx="50" cy="32" r="7" fill="#9a7000"/>
      <circle cx="50" cy="32" r="5" fill="#b38600"/>
      <circle cx="50" cy="32" r="3" fill="#7a5500"/>
      <circle cx="50" cy="32" r="1.5" fill="#ffd700"/>
      <rect x="38" y="64" width="24" height="4" rx="2" fill="#7a5500"/>
      <rect x="34" y="68" width="32" height="3" rx="1.5" fill="#8a6200"/>
      <text x="50" y="82" textAnchor="middle" fontSize="7" fontFamily="Georgia,serif" fill="#5a3e00" fontWeight="bold" letterSpacing="1">INDIA</text>
      <text x="50" y="14" textAnchor="middle" fontSize="6" fontFamily="Georgia,serif" fill="#5a3e00">{"भारत"}</text>
    </svg>
  );

  var CoinTails = ({size=84}) => (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <defs>
        <radialGradient id={uid+"tg"} cx="38%" cy="35%">
          <stop offset="0%" stopColor="#e8e8e8"/>
          <stop offset="60%" stopColor="#b0b0b0"/>
          <stop offset="100%" stopColor="#808080"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${uid}tg)`} stroke="#888" strokeWidth="2"/>
      <circle cx="50" cy="50" r="43" fill="none" stroke="#aaa" strokeWidth="1" strokeDasharray="4 3"/>
      <circle cx="50" cy="50" r="35" fill="none" stroke="#999" strokeWidth="0.8"/>
      <text x="50" y="46" textAnchor="middle" fontSize="26" fontFamily="Georgia,serif" fill="#444" fontWeight="bold">{"₹"}</text>
      <text x="50" y="66" textAnchor="middle" fontSize="16" fontFamily="Georgia,serif" fill="#333" fontWeight="bold">10</text>
      <text x="50" y="82" textAnchor="middle" fontSize="6.5" fontFamily="Georgia,serif" fill="#444" letterSpacing="1">INDIA</text>
      <text x="50" y="14" textAnchor="middle" fontSize="6" fontFamily="Georgia,serif" fill="#444">{"भारत"}</text>
    </svg>
  );

  var CoinBlank = ({size=84}) => (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <defs>
        <radialGradient id={uid+"ng"} cx="38%" cy="35%">
          <stop offset="0%" stopColor="#475569"/>
          <stop offset="100%" stopColor="#1e293b"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${uid}ng)`} stroke="#475569" strokeWidth="2"/>
      <text x="50" y="62" textAnchor="middle" fontSize="36" fill="#94a3b8">{"🪙"}</text>
    </svg>
  );

  return (
    <div>
      {/* Coin display — 3D flip animation (no backface-visibility, works on all browsers) */}
      {(()=>{
        // Determine visible face from angle: every 180deg alternates heads/tails
        // Normalize angle to 0-360, heads shows when 0-90 or 270-360, tails when 90-270
        var norm = ((flipAngle % 360) + 360) % 360;
        var showingHeads = norm < 90 || norm >= 270;
        // scaleX squish: coin appears thin at 90/270 (edge-on), full at 0/180
        var scaleX = Math.abs(Math.cos(flipAngle * Math.PI / 180));
        var glow = coinFace==="heads" ? "0 0 20px rgba(212,160,23,.8)"
                 : coinFace==="tails" ? "0 0 20px rgba(160,160,160,.6)"
                 : flipping ? "0 0 12px rgba(251,191,36,.3)"
                 : "0 2px 8px rgba(0,0,0,.5)";
        return (
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{width:100,height:100,margin:"0 auto 14px",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{
                transform:`scaleX(${Math.max(scaleX, 0.05)})`,
                transition: flipping ? "none" : "transform 0.05s",
                borderRadius:"50%",
                boxShadow: glow,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                {showingHeads ? <CoinHeads size={100}/> : <CoinTails size={100}/>}
              </div>
            </div>
            {flipping && <div style={{color:SP.primary,fontSize:13,letterSpacing:1,marginBottom:4}}>🪙 Flipping…</div>}
            {tossWon && <div style={{color:SP.primary,fontSize:15,fontWeight:"bold",marginBottom:4}}>{winnerName} wins the toss!</div>}
            {coinFace && !flipping && <div style={{color:SP.textSec,fontSize:12}}>Coin landed: <b style={{color:SP.primary}}>{coinFace}</b> · {coinFace==="heads"?"Ashoka Pillar":"₹10"}</div>}
            {!coinFace && !flipping && !tossWon && <div style={{color:"#334155",fontSize:12,marginTop:4}}>Waiting for toss…</div>}
          </div>
        );
      })()}

      {/* Before toss: Team A calls */}
      {!tossWon && !flipping && (
        <div style={{marginBottom:14}}>
          <div style={{color:SP.textDim,fontSize:11,letterSpacing:1,marginBottom:10,textAlign:"center"}}>
            {teamAName.toUpperCase()} — CALL THE TOSS
          </div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {[["heads","🏛 Heads (Ashoka)"],["tails","₹ Tails (10)"]].map(([val,lbl])=>(
              <button key={val} onClick={()=>pickCall(val)}
                style={{flex:1,padding:"10px 0",borderRadius:12,
                  border:call===val?"2px solid #fbbf24":"1px solid rgba(73,72,71,.25)",
                  background:call===val?"rgba(251,191,36,.12)":"#0f172a",
                  color:call===val?"#fbbf24":"#94a3b8",
                  fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:4,paddingTop:8,paddingBottom:8}}>
                <div style={{width:38,height:38,borderRadius:"50%",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {val==="heads" ? <CoinHeads size={38}/> : <CoinTails size={38}/>}
                </div>
                <span style={{fontSize:11}}>{val==="heads"?"Heads":"Tails"}</span>
              </button>
            ))}
          </div>
          <button onClick={doToss} disabled={!call}
            style={{width:"100%",padding:"13px 0",
              background:call?SP.primary:"#0f172a",
              border:"1px solid rgba(73,72,71,.25)",borderRadius:12,
              color:call?"#0f172a":"#334155",
              fontWeight:"bold",fontSize:15,
              cursor:call?"pointer":"not-allowed",
              fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:1,marginBottom:8}}>
            🪙 Flip Coin
          </button>
          <button onClick={()=>{ onToss(0); onChoice(0); }}
            style={{width:"100%",padding:"8px 0",background:"none",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            Skip toss — {teamAName} bats first
          </button>
        </div>
      )}



      {/* After toss: winner picks bat or bowl */}
      {tossWon && (
        <div>
          <div style={{color:SP.textDim,fontSize:11,letterSpacing:1,marginBottom:10,textAlign:"center"}}>
            {winnerName.toUpperCase()} CHOOSES TO…
          </div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            {/* Bat First = winner bats = battingFirst is tossWinner's team index */}
            <button onClick={()=>onChoice(tossWinner)}
              style={{flex:1,padding:"14px 0",borderRadius:12,
                border:battingFirst===tossWinner?"2px solid #fbbf24":"1px solid rgba(73,72,71,.25)",
                background:battingFirst===tossWinner?"rgba(251,191,36,.12)":"#0f172a",
                color:battingFirst===tossWinner?"#fbbf24":"#94a3b8",
                fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              🏏 Bat First
            </button>
            {/* Bowl First = winner bowls = other team bats */}
            <button onClick={()=>onChoice(1-tossWinner)}
              style={{flex:1,padding:"14px 0",borderRadius:12,
                border:battingFirst===(1-tossWinner)?"2px solid #fbbf24":"1px solid rgba(73,72,71,.25)",
                background:battingFirst===(1-tossWinner)?"rgba(251,191,36,.12)":"#0f172a",
                color:battingFirst===(1-tossWinner)?"#fbbf24":"#94a3b8",
                fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              🎯 Bowl First
            </button>
          </div>
          {battingFirst !== null && battingFirst !== undefined && (
            <div style={{color:SP.primary,fontSize:13,textAlign:"center",padding:"6px 0"}}>
              ✓ {battingFirst===0?teamAName:teamBName} will bat first · {battingFirst===tossWinner?loserName:winnerName} will bowl
            </div>
          )}
          <button onClick={redo}
            style={{width:"100%",marginTop:8,padding:"8px 0",background:"none",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            ↺ Redo Toss
          </button>
        </div>
      )}
    </div>
  );
}

// ── NList — player/bowler name entry in setup wizard ─────────────
function PlayerPickerStep({teamName, selectedNames, selectedIds, onUpdate, currentUser, teamSlot, setup, setSetup}) {
  // Shows all saved players as selectable list, with inline new player creation
  const [allPlayers,  setAllPlayers]  = React.useState(null);
  const [search,      setSearch]      = React.useState("");
  const [newName,     setNewName]     = React.useState("");
  const [saving,      setSaving]      = React.useState(false);
  const [saveMsg,     setSaveMsg]     = React.useState("");
  const [savingTeam,  setSavingTeam]  = React.useState(false);

  React.useEffect(() => {
    if (!_fbDB) return;
    _fbDB.ref("players").once("value", snap => {
      var val = snap.val()||{};
      setAllPlayers(Object.values(val).sort((a,b)=>a.name.localeCompare(b.name)));
    });
  }, []);

  var selIds = new Set(selectedIds||[]);

  function togglePlayer(p) {
    var curIds   = [...(selectedIds||[])];
    var curNames = [...(selectedNames||[])];
    if (selIds.has(p.id)) {
      // Deselect
      var idx = curIds.indexOf(p.id);
      curIds.splice(idx,1); curNames.splice(idx,1);
    } else {
      curIds.push(p.id); curNames.push(p.name);
    }
    onUpdate(curNames, curIds);
  }

  async function addNewPlayer() {
    var nm = newName.trim();
    if (!nm) return;
    setSaving(true);
    try {
      var now = Date.now();
      var pid = "P_"+now+"_"+Math.random().toString(36).slice(2,6);
      var p = {
        id:pid, name:nm, role:"Batsman",
        batStyle:"Right-hand", bowlStyle:"Right-arm Medium", dob:null,
        createdBy: currentUser ? currentUser.uid : null, createdAt:now,
        batting:{matches:0,innings:0,runs:0,balls:0,outs:0,fours:0,sixes:0,highScore:0,fifties:0,hundreds:0},
        bowling:{overs:0,balls:0,runs:0,wickets:0,maidens:0,bestWickets:0,bestRuns:999},
      };
      if (_fbDB) await _fbDB.ref("players/"+pid).set(p);
      setAllPlayers(prev=>[...(prev||[]),p].sort((a,b)=>a.name.localeCompare(b.name)));
      // Auto-select the new player
      var curIds=[...(selectedIds||[])]; curIds.push(pid);
      var curNames=[...(selectedNames||[])]; curNames.push(nm);
      onUpdate(curNames, curIds);
      setNewName("");
    } catch(e) { console.error(e); }
    setSaving(false);
  }

  async function saveAsTeam() {
    var nm = teamName.trim();
    if (!nm || !(selectedIds||[]).length || !_fbDB) return;
    setSavingTeam(true);
    setSaveMsg("");
    try {
      var id = "T_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
      var t = {
        id, name:nm,
        playerIds: selectedIds||[],
        ownerIds: currentUser ? [currentUser.uid] : [],
        createdBy: currentUser ? currentUser.uid : null,
        createdAt: Date.now(),
      };
      await _fbDB.ref("teams/"+id).set(t);
      setSaveMsg("✓ Saved as " + nm);
      setTimeout(()=>setSaveMsg(""), 3000);
    } catch(e) { setSaveMsg("Error: "+e.message); }
    setSavingTeam(false);
  }

  var filtered = (allPlayers||[]).filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  var count = (selectedIds||[]).length;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <span style={{color:SP.primary,fontSize:13,fontWeight:"700"}}>{count} player{count!==1?"s":""} selected</span>
        <button onClick={saveAsTeam} disabled={savingTeam||!count}
          style={{padding:"5px 12px",background:"transparent",border:"1px solid rgba(102,157,255,.35)",borderRadius:8,color:SP.secondary,fontSize:11,cursor:count?"pointer":"not-allowed",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"700",opacity:count?1:.4}}>
          {savingTeam?"Saving…":"💾 Save Team"}
        </button>
      </div>
      {saveMsg&&<div style={{color:SP.primary,fontSize:12,marginBottom:8,textAlign:"center"}}>{saveMsg}</div>}

      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
        style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"10px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:8}}/>

      {/* Add new player inline */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New player name…"
          onKeyDown={e=>{if(e.key==="Enter")addNewPlayer();}}
          style={{flex:1,background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"9px 12px",color:"#fff",fontSize:13,outline:"none",fontFamily:"Lexend,Georgia,sans-serif"}}/>
        <button onClick={addNewPlayer} disabled={saving||!newName.trim()}
          style={{padding:"9px 16px",background:newName.trim()?SP.primary:"rgba(73,72,71,.2)",border:"none",borderRadius:9,color:newName.trim()?"#0f172a":SP.textDim,fontWeight:"700",fontSize:16,cursor:newName.trim()?"pointer":"not-allowed",fontFamily:"Lexend,Georgia,sans-serif"}}>
          {saving?"…":"+"}
        </button>
      </div>

      {/* Player list */}
      {allPlayers===null && <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:20}}>Loading players…</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:"42vh",overflowY:"auto"}}>
        {filtered.map(p=>{
          var isSel = selIds.has(p.id);
          return (
            <div key={p.id} onClick={()=>togglePlayer(p)}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,
                border:isSel?"1px solid rgba(156,255,147,.35)":"1px solid rgba(73,72,71,.2)",
                background:isSel?"rgba(156,255,147,.08)":SP.bg,cursor:"pointer"}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:isSel?SP.primary:SP.bg3,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:"700",
                color:isSel?"#0f172a":SP.textDim,flexShrink:0}}>
                {isSel?"✓":p.name[0].toUpperCase()}
              </div>
              <div style={{flex:1}}>
                <div style={{color:isSel?"#fff":SP.textSec,fontSize:14,fontWeight:isSel?"700":"400"}}>{p.name}</div>
                {p.role&&<div style={{color:SP.textDim,fontSize:11}}>{p.role}</div>}
              </div>
            </div>
          );
        })}
        {allPlayers!==null&&filtered.length===0&&(
          <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:"16px 0"}}>
            {search?"No players match your search.":"No saved players yet — add one above."}
          </div>
        )}
      </div>
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
      if (u) {
        // Verify the user has a record in our DB — if deleted, sign them out
        if (_fbDB) {
          _fbDB.ref("users/"+u.uid).once("value").then(snap => {
            if (snap.exists()) {
              setAuthUser(u); setStatus("authed");
            } else {
              // DB record missing — sign out and show login
              _fbAuth.signOut();
              setAuthUser(null); setStatus("login");
              setErr("Account not found. Please register.");
            }
          }).catch(() => {
            // On DB error, still allow in (avoids locking out on connectivity issues)
            setAuthUser(u); setStatus("authed");
          });
        } else {
          setAuthUser(u); setStatus("authed");
        }
      }
      else { setAuthUser(null); setStatus("login"); }
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
        // Write both legacy playerId and new playerIds array
        await _fbDB.ref("users/"+uid).update({ playerId: playerId, playerIds: [playerId] });
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
    <div style={{minHeight:"100dvh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Lexend,Georgia,sans-serif"}}><div style={{color:SP.textDim,fontSize:12,letterSpacing:3,fontWeight:"600",textTransform:"uppercase"}}>LOADING…</div></div>
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

  var inputSt = {}; // unused stub

  return (
    <div style={{minHeight:"100dvh",background:"#0e0e0e",fontFamily:"Lexend,Georgia,sans-serif",overflowY:"auto",position:"relative"}}>
      {/* Ambient glow */}
      <div style={{position:"fixed",top:"-20%",left:"50%",transform:"translateX(-50%)",width:400,height:300,background:"radial-gradient(ellipse,rgba(102,157,255,.08) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100dvh",padding:"40px 24px 60px"}}>
      <div style={{width:"100%",maxWidth:380}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{width:72,height:72,background:"#1a1919",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",boxShadow:"0 8px 32px rgba(0,0,0,.5)"}}>
            <span style={{fontSize:34}}>🏏</span>
          </div>
          <h1 style={{color:"#fff",fontSize:28,fontWeight:"900",letterSpacing:-1,margin:"0 0 6px",fontFamily:"Lexend,Georgia,sans-serif",fontStyle:"italic"}}>CRICKET PULSE</h1>
          <p style={{color:SP.textDim,fontSize:10,letterSpacing:3,margin:0,fontWeight:"600",textTransform:"uppercase"}}>Enter the Arena</p>
        </div>

        {/* Tab switcher */}
        <div style={{display:"flex",borderBottom:"1px solid #262626",marginBottom:28,gap:0}}>
          {["login","register"].map(v=>(
            <button key={v} onClick={()=>{setView(v);clearForm();}} className={"sp-tab"+(view===v?" active":"")}>
              {v==="login"?"Sign In":"Register"}
            </button>
          ))}
        </div>

          {view==="forgot" ? (
            <div>
              <div style={{color:SP.textSec,fontSize:13,marginBottom:16,lineHeight:1.6}}>Enter your email and we'll send a reset link.</div>
              <div style={{marginBottom:14}}>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>EMAIL</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="you@example.com" className="sp-input"/>
              </div>
              {err&&<div style={{color:"#ff716c",fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,border:"1px solid rgba(255,113,108,.2)"}}>{err}</div>}
              {info&&<div style={{color:SP.primary,fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(156,255,147,.06)",borderRadius:8}}>{info}</div>}
              <button onClick={handleForgot} disabled={busy} className="sp-btn-primary">{busy?"Sending…":"Send Reset Email"}</button>
              <div style={{textAlign:"center",marginTop:14}}>
                <button onClick={()=>{setView("login");clearForm();}} style={{background:"none",border:"none",color:SP.secondary,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"700"}}>← Back to Sign In</button>
              </div>
            </div>
          ) : view==="register" ? (
            <div>
              {/* Player / Viewer toggle */}
              <div style={{marginBottom:18}}>
                <label style={{color:SP.textDim,fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>I AM REGISTERING AS</label>
                <div style={{display:"flex",gap:8}}>
                  {[["player","🏏 Player"],["viewer","👁 Viewer"]].map(([t,lbl])=>(
                    <button key={t} onClick={()=>{setRegType(t);clearForm();}}
                      style={{flex:1,padding:"12px 0",borderRadius:8,border:"none",borderBottom:regType===t?"2px solid "+SP.secondary:"2px solid transparent",background:"transparent",color:regType===t?SP.secondary:SP.textDim,fontWeight:"700",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:.5}}>
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
                <label style={{...S.lbl,display:"block",marginBottom:6}}>{regType==="player"?"PLAYER NAME":"YOUR NAME"}</label>
                <input value={name} onChange={e=>{setName(e.target.value);clearForm();}} type="text" placeholder={regType==="player"?"e.g. Rohit Sharma":"e.g. Arjun Patel"} className="sp-input"
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>

              {/* Player-only fields */}
              {regType==="player" && (
                <div>
                  <div style={{marginBottom:12}}>
                    <label style={{color:SP.textDim,fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>ROLE</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ROLES.map(r=>(
                        <button key={r} onClick={()=>setRole(r)}
                          style={{padding:"6px 14px",borderRadius:999,border:"none",background:role===r?SP.secondary:SP.bg4,color:role===r?"#001f49":SP.textSec,fontSize:11,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"700",letterSpacing:.5}}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    <div>
                      <label style={{...S.lbl,display:"block",marginBottom:6}}>BATTING</label>
                      <select value={batStyle} onChange={e=>setBatStyle(e.target.value)}
                        className="sp-select">
                        {BAT_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{...S.lbl,display:"block",marginBottom:6}}>BOWLING</label>
                      <select value={bowlStyle} onChange={e=>setBowlStyle(e.target.value)}
                        className="sp-select">
                        {BOWL_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={{...S.lbl,display:"block",marginBottom:6}}>DATE OF BIRTH <span style={{color:"#334155"}}>(optional)</span></label>
                    <input value={dob} onChange={e=>setDob(e.target.value)} type="date"
                      className="sp-input" style={{colorScheme:"dark"}}/>
                  </div>
                </div>
              )}

              <div style={{marginBottom:12}}>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>EMAIL ADDRESS</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="you@example.com" className="sp-input"
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>
              <div style={{marginBottom:12}}>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>PASSWORD</label>
                <div style={{position:"relative"}}>
                  <input value={password} onChange={e=>{setPassword(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="Min 6 characters" className="sp-input" style={{paddingRight:36}}
                    onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
                  <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:SP.textDim,fontSize:16,cursor:"pointer",padding:0}}>{showPw?"🙈":"👁"}</button>
                </div>
              </div>
              <div style={{marginBottom:18}}>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>CONFIRM PASSWORD</label>
                <input value={confirm} onChange={e=>{setConfirm(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="Repeat password" className="sp-input"
                  onKeyDown={e=>{if(e.key==="Enter")handleRegister();}}/>
              </div>
              {err&&<div style={{color:"#ff716c",fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,border:"1px solid rgba(255,113,108,.2)"}}>{err}</div>}
              <button onClick={handleRegister} disabled={busy} className="sp-btn-primary">{busy?"Creating account…":regType==="player"?"Join as Player ⚡":"Join as Viewer ⚡"}</button>
            </div>
          ) : (
            <div>
              <div style={{marginBottom:20}}>
                <label style={S.lbl}>Email Address</label>
                <input value={email} onChange={e=>{setEmail(e.target.value);clearForm();}} type="email" placeholder="player@cricketpulse.com" className="sp-input"
                  onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
              </div>
              <div style={{marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0}}>
                  <label style={S.lbl}>Password</label>
                  <button onClick={()=>{setView("forgot");clearForm();}} style={{background:"none",border:"none",color:SP.secondary,fontSize:10,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:1,fontWeight:"700",textTransform:"uppercase"}}>Forgot?</button>
                </div>
                <div style={{position:"relative"}}>
                  <input value={password} onChange={e=>{setPassword(e.target.value);clearForm();}} type={showPw?"text":"password"} placeholder="••••••••" className="sp-input" style={{paddingRight:36}}
                    onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
                  <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:0,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:SP.textDim,fontSize:15,cursor:"pointer",padding:0}}>{showPw?"🙈":"👁"}</button>
                </div>
              </div>
              <div style={{height:28}}/>
              {err&&<div style={{color:"#ff716c",fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,border:"1px solid rgba(255,113,108,.2)"}}>{err}</div>}
              <button onClick={handleLogin} disabled={busy} className="sp-btn-primary">{busy?"Signing in…":"Log in to Field ⚡"}</button>

            </div>
          )}

        <div style={{textAlign:"center",marginTop:24}}>
          <span style={{color:SP.textDim,fontSize:13}}>New to the league? </span>
          <button onClick={()=>{setView("register");clearForm();}} style={{background:"none",border:"none",color:SP.secondary,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"700"}}>Sign Up</button>
        </div>

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
  // Replace batter: slot (0|1) of a batsman who hasn't faced a ball yet
  const [replacingBatter, setReplacingBatter] = useState(null);
  // Replace bowler who hasn't bowled a ball yet
  const [replacingBowler, setReplacingBowler] = useState(false);
  // Match history
  const [matchHistory, setMatchHistory] = useState([]);
  // Admin
  const [adminPin, setAdminPin] = useState("");
  const [viewAsUser, setViewAsUser] = useState(false); // admin persona switcher
  // Live matches list for viewer
  const [homeTab, setHomeTab] = useState("home"); // "home"|"live"|"profile"
  const [userPlayerId, setUserPlayerId] = useState(null); // current user's playerId from DB

  // Load current user's linked playerIds from users/{uid}
  useEffect(() => {
    if (!currentUser || !_fbDB) return;
    _fbDB.ref("users/"+currentUser.uid).once("value", snap => {
      var rec = snap.val() || {};
      // Support both legacy single playerId and new playerIds array
      if (rec.playerIds && rec.playerIds.length) setUserPlayerId(rec.playerIds[0]);
      else if (rec.playerId) setUserPlayerId(rec.playerId);
    });
  }, [currentUser]);
  //const [userPlayerId, setUserPlayerId] = useState(null); // linked player id for current user
  const [liveMatches, setLiveMatches] = useState(null); // null=not loaded, []=empty
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError,   setLiveError]   = useState("");
  const listRef = useRef(null);
  const scorerLockRef = useRef(null);
  const scorerRequestRef = useRef(null);
  const [scorerToast, setScorerToast] = useState("");
  // Players & Teams
  const [showPlayers,    setShowPlayers]    = useState(false);
  const [showTeams,      setShowTeams]      = useState(false);
  const [teamPickerSlot, setTeamPickerSlot] = useState(null); // "A"|"B"|null

  // Init Firebase
  useEffect(() => { setFbReady(initFB()); }, []);

  // Load the current user's linked playerId from the users node
  useEffect(() => {
    if (!currentUser || !_fbDB) return;
    _fbDB.ref("users/" + currentUser.uid + "/playerId").once("value", snap => {
      if (snap.val()) setUserPlayerId(snap.val());
    }).catch(() => {});
  }, [currentUser]);

  // Load match history — from matches/ in Firebase (source of truth)
  useEffect(() => {
    // Show local cache instantly while Firebase loads
    try {
      var raw = localStorage.getItem(HIST_KEY);
      if (raw) setMatchHistory(JSON.parse(raw));
    } catch(e) {}
    if (!_fbDB) return;

    function buildEntries(mVal) {
      var entries = {};
      Object.values(mVal||{}).forEach(m => {
        if (!m || !m.matchCode) return;
        if (!m.inningsOver || !m.inningsOver[0]) return; // skip in-progress
        var nm = normaliseMatch(JSON.parse(JSON.stringify(m)));
        entries[m.matchCode] = {
          id: m.matchCode,
          date: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
          teamA: nm.teamA.name, teamB: nm.teamB.name,
          runsA: nm.runs[0], wicketsA: nm.wickets[0], oversA: nm.overs[0], ballsA: nm.balls[0],
          runsB: nm.runs[1], wicketsB: nm.wickets[1], oversB: nm.overs[1], ballsB: nm.balls[1],
          totalOvers: nm.totalOvers,
          snapshot: nm,
        };
      });
      return Object.values(entries).sort((a,b) => (b.date||"") > (a.date||"") ? 1 : -1).slice(0, 50);
    }

    function applyEntries(fbEntries) {
      if (!fbEntries.length) return;
      setMatchHistory(prev => {
        var seen = new Set(fbEntries.map(e=>e.id));
        var localOnly = (prev||[]).filter(e => !seen.has(e.id));
        var merged = [...fbEntries, ...localOnly].slice(0, 50);
        try { localStorage.setItem(HIST_KEY, JSON.stringify(merged)); } catch(e) {}
        return merged;
      });
    }

    // Load from completedMatches first (fast, formatted)
    _fbDB.ref("completedMatches").orderByChild("date").limitToLast(50).once("value")
      .then(snap => {
        var cmVal = snap.val() || {};
        var cmEntries = Object.values(cmVal)
          .filter(e => e && e.id)
          .map(e => ({...e, snapshot: normaliseMatch(e.snapshot)}))
          .sort((a,b) => (b.date||"") > (a.date||"") ? 1 : -1);
        if (cmEntries.length) applyEntries(cmEntries);
      })
      .catch(() => {});

    // Load from userMatches index — fetch each match individually (respects $c rule)
    _fbDB.ref("userMatches").once("value").then(umSnap => {
      var umVal = umSnap.val() || {};
      // Collect all unique match codes across all users
      var codes = {};
      Object.values(umVal).forEach(userMap => {
        if (!userMap || typeof userMap !== "object") return;
        Object.keys(userMap).forEach(code => { codes[code] = true; });
      });
      var allCodes = Object.keys(codes);
      if (!allCodes.length) return;
      // Fetch each match individually (permitted by $c rule)
      return Promise.all(
        allCodes.map(code => _fbDB.ref("matches/"+code).once("value").then(s => s.val()).catch(()=>null))
      );
    }).then(matchArr => {
      if (!matchArr) return;
      var mVal = {};
      matchArr.forEach(m => { if (m && m.matchCode) mVal[m.matchCode] = m; });
      applyEntries(buildEntries(mVal));
    }).catch(err => console.warn("[History] userMatches load error:", err));
  }, [fbReady]);

  // Restore saved match + screen on refresh
  useEffect(() => {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d) return;
      if (d.match) {
        // Restore match screen
        setMatch(normaliseMatch(d.match));
        setIsViewer(!!d.isViewer);
        var restoredScreen = d.screen || (d.isViewer ? "viewer" : "match");
        // Only restore safe match-dependent screens
        var safeMatchScreens = ["match", "viewer", "scorecard", "historycard"];
        setScreen(safeMatchScreens.includes(restoredScreen) ? restoredScreen : (d.isViewer ? "viewer" : "match"));
        if (d.isViewer && d.match.matchCode) attachListener(d.match.matchCode);
        else if (!d.isViewer && d.match.matchCode && d.match.matchCode !== "LOCAL" && currentUser) watchScorerLock(d.match.matchCode);
      } else if (d.screen) {
        // Restore non-match screens (history, admin, setup)
        setScreen(d.screen);
      }
    } catch(e) {}
  }, []);

  // Show bowler picker whenever an over completes
  const [needsOpeners, setNeedsOpeners] = useState(false);

  useEffect(() => {
    if (match && match.needsBowler && !isViewer) {
      setOverComplete(true);
    }
  }, [match ? match.needsBowler : null]);

  useEffect(() => {
    if (match && match.needsOpeners && !isViewer) {
      setNeedsOpeners(true);
    }
  }, [match ? match.needsOpeners : null]);

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

  // Persist locally — save screen too so refresh restores the right view
  useEffect(() => {
    try {
      if (match) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({match, isViewer, screen}));
      } else {
        // No match — only persist non-match screens worth restoring
        var screensToPersist = ["history", "admin", "setup"];
        if (screensToPersist.includes(screen)) {
          localStorage.setItem(LOCAL_KEY, JSON.stringify({screen}));
        } else {
          localStorage.removeItem(LOCAL_KEY);
        }
      }
    } catch(e) {}
  }, [match, isViewer, screen]);

  // Sync to Firebase (scorer only)
  useEffect(() => {
    if (!match || isViewer || !fbReady || !match.matchCode || match.matchCode==="LOCAL") return;
    setSyncing(true);
    var code = match.matchCode;
    // We write the full match with .set(), but scorerRequest is owned by the handover
    // flow (written by viewers). We must not clobber it. Strategy: snapshot the current
    // scorerRequest from Firebase first, then write match + re-attach scorerRequest.
    var ref = _fbDB.ref("matches/"+code);
    // Read the scorer-lock fields before writing — these are owned by the lock/handover
    // system and must never be clobbered by the scorer's ball-by-ball sync.
    ref.once("value", snap => {
      var live = snap.val() || {};
      var matchToWrite = {
        ...match,
        scorerUid:        live.scorerUid        || match.scorerUid        || null,
        scorerName:       live.scorerName       || match.scorerName       || null,
        scorerHeartbeat:  live.scorerHeartbeat  || match.scorerHeartbeat  || null,
        scorerRequest:    live.scorerRequest    || match.scorerRequest    || null,
      };
      ref.set(matchToWrite)
        .then(()=>setSyncing(false))
        .catch(()=>setSyncing(false));
    });
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
    var first = true;
    ref.on("value", snap => {
      var v = normaliseMatch(snap.val());
      if (!v) return;
      if (first) {
        first = false;
        setMatch(v); setIsViewer(true); setScreen("viewer");
      } else {
        // Check if we've just been approved as the new scorer
        var myUid = currentUser && currentUser.uid;
        if (myUid && v.scorerUid === myUid) {
          // We are now the scorer — stop read-only listener and take over
          if (listRef.current) { listRef.current.off(); listRef.current = null; }
          setMatch(v);
          setIsViewer(false);
          setScreen("match");
          watchScorerLock(code);
        } else {
          setMatch(v);
        }
      }
    }, err => console.warn("FB listener error:", err.message));
  }

  function detach() { if (listRef.current) { listRef.current.off(); listRef.current=null; } }

  // ── Multi-scorer lock system ─────────────────────────────────
  // Any logged-in user can score — open access since players may be added by name only
  function canClaimScoring(m) {
    return !!(currentUser && m);
  }

  // Returns true if this user is the match creator (gets priority in conflicts)
  function isMatchCreator(m) {
    return currentUser && m && m.createdBy && m.createdBy.uid === currentUser.uid;
  }

  // Watch scorerUid — if it changes to someone else's uid, drop to viewer
  // Also watch scorerRequest so the scorer sees handover requests instantly
  // and the banner clears immediately when a request is declined.
  function watchScorerLock(code) {
    if (scorerLockRef.current) { scorerLockRef.current.off(); }
    if (!_fbDB || !currentUser) return;
    var myUid = currentUser.uid;
    var firstFire = true; // ignore the initial value event on scorerUid
    scorerLockRef.current = _fbDB.ref("matches/"+code+"/scorerUid");
    scorerLockRef.current.on("value", snap => {
      if (firstFire) { firstFire = false; return; } // skip initial read
      var newScorer = snap.val();
      if (newScorer && newScorer !== myUid) {
        // Someone else claimed — drop to viewer
        if (scorerLockRef.current) { scorerLockRef.current.off(); scorerLockRef.current = null; }
        if (scorerRequestRef.current) { scorerRequestRef.current.off(); scorerRequestRef.current = null; }
        setIsViewer(true);
        setScreen("viewer");
        setScorerToast((newScorer||"Someone") + " is now scoring");
        setTimeout(()=>setScorerToast(""), 4000);
      }
    });
    // Listen for incoming handover requests (and their removal on decline)
    if (scorerRequestRef.current) { scorerRequestRef.current.off(); }
    scorerRequestRef.current = _fbDB.ref("matches/"+code+"/scorerRequest");
    scorerRequestRef.current.on("value", snap => {
      var req = snap.val();
      setMatch(prev => prev ? {...prev, scorerRequest: req || null} : prev);
    });
  }

  // Claim scoring rights:
  // - If slot is free → claim it
  // - If match creator tries to claim → always wins (overrides current scorer)
  // - If another eligible player tries → blocked, told who has it
  function claimScoring(m) {
    if (!_fbDB || !m || !m.matchCode || !currentUser) return;
    var code = m.matchCode;
    var uid = currentUser.uid;
    var myName = currentUser.displayName || currentUser.email || "A player";
    var iAmCreator = isMatchCreator(m);

    _fbDB.ref("matches/"+code).once("value", snap => {
      var latest = normaliseMatch(snap.val());
      if (!latest) return;
      var existingScorer = latest.scorerUid;

      if (existingScorer && existingScorer !== uid && !iAmCreator) {
        // Slot taken by non-creator — blocked
        setScorerToast((latest.scorerName||"Someone") + " is already scoring");
        setTimeout(()=>setScorerToast(""), 3500);
        return;
      }

      // Free slot OR I am the creator — claim it
      _fbDB.ref("matches/"+code).update({
        scorerUid:        uid,
        scorerName:       myName,
        scorerHeartbeat:  Date.now(),
      }).then(() => {
        detach(); // stop read-only listener
        // Use latest match data from Firebase (most up to date)
        var m2 = {...latest, scorerUid: uid, scorerName: myName};
        setMatch(m2);
        setIsViewer(false);
        setScreen("match");
        watchScorerLock(code);
      });
    });
  }

  // Hand off scoring to another player — scorer explicitly yields
  function handOffScoring(m) {
    if (!_fbDB || !m || !m.matchCode) return;
    var code = m.matchCode;
    // 1. Stop scorer lock watcher first (prevents self-trigger on null write)
    if (scorerLockRef.current) { scorerLockRef.current.off(); scorerLockRef.current = null; }
    if (scorerRequestRef.current) { scorerRequestRef.current.off(); scorerRequestRef.current = null; }
    // 2. Clear scorer slot in Firebase
    _fbDB.ref("matches/"+code).update({ scorerUid: null, scorerName: null, scorerHeartbeat: null });
    // 3. Switch to viewer mode
    setIsViewer(true);
    setScreen("viewer");
    // 4. Reattach as read-only listener — skip first-nav since we are already on viewer
    if (listRef.current) listRef.current.off();
    var ref = _fbDB.ref("matches/"+code);
    listRef.current = ref;
    ref.on("value", snap => { var v = normaliseMatch(snap.val()); if (v) setMatch(v); },
      err => console.warn("FB listener error:", err.message));
  }

  // Viewer requests handover from active scorer
  function requestHandover(m) {
    if (!_fbDB || !m || !m.matchCode || !currentUser) return;
    var code = m.matchCode;
    var req = { uid: currentUser.uid, name: currentUser.displayName || currentUser.email || "A player", requestedAt: Date.now() };
    _fbDB.ref("matches/"+code+"/scorerRequest").set(req);
    setScorerToast("Handover requested — waiting for approval");
    setTimeout(()=>setScorerToast(""), 4000);
  }

  // Active scorer approves the handover request
  function approveHandover(m, req) {
    if (!_fbDB || !m || !m.matchCode || !req) return;
    var code = m.matchCode;
    // Write new scorer, clear request
    _fbDB.ref("matches/"+code).update({
      scorerUid: req.uid, scorerName: req.name,
      scorerHeartbeat: Date.now(), scorerRequest: null,
    }).then(() => {
      // Current scorer drops to viewer
      if (scorerLockRef.current) { scorerLockRef.current.off(); scorerLockRef.current = null; }
      if (scorerRequestRef.current) { scorerRequestRef.current.off(); scorerRequestRef.current = null; }
      setIsViewer(true);
      setScreen("viewer");
      if (listRef.current) listRef.current.off();
      var ref = _fbDB.ref("matches/"+code);
      listRef.current = ref;
      ref.on("value", snap => { var v = normaliseMatch(snap.val()); if (v) setMatch(v); },
        err => console.warn("FB listener:", err.message));
    });
  }

  // Active scorer declines the handover request
  function declineHandover(m) {
    if (!_fbDB || !m || !m.matchCode) return;
    _fbDB.ref("matches/"+m.matchCode+"/scorerRequest").remove();
  }

  // Release scoring fully (match end / leave)
  function releaseScoring(code) {
    if (scorerLockRef.current) { scorerLockRef.current.off(); scorerLockRef.current = null; }
    if (scorerRequestRef.current) { scorerRequestRef.current.off(); scorerRequestRef.current = null; }
    if (_fbDB && code && code !== "LOCAL") {
      _fbDB.ref("matches/"+code).update({ scorerUid: null, scorerName: null, scorerHeartbeat: null, scorerRequest: null });
    }
  }

  // ── Match start ──────────────────────────────────────────────
  function startMatch() {
    var code = fbReady ? genCode() : "LOCAL";
    var m = blankMatch(setup, code);
    // Tag match with creator info
    if (currentUser) {
      m.createdBy = { uid: currentUser.uid, name: currentUser.displayName||"", email: currentUser.email||"" };
      // Creator claims scoring lock immediately
      m.scorerUid = currentUser.uid;
      m.scorerName = currentUser.displayName || currentUser.email || "Creator";
      m.scorerHeartbeat = Date.now();
    }
    setMatch(m);
    setHistory([]);
    setIsViewer(false);
    setScreen("match");
    if (currentUser && code !== "LOCAL") {
      watchScorerLock(code);
    }
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
      if (currentUser) _fbDB.ref("userMatches/"+currentUser.uid+"/"+code).set(entry);
    }
  }

  function saveToHistory(m) {
    var entry = {
      id: m.matchCode || String(Date.now()),
      date: new Date().toISOString(),
      teamA: m.teamA.name, teamB: m.teamB.name,
      runsA: m.runs[0], wicketsA: m.wickets[0], oversA: m.overs[0], ballsA: m.balls[0],
      runsB: m.runs[1], wicketsB: m.wickets[1], oversB: m.overs[1], ballsB: m.balls[1],
      totalOvers: m.totalOvers,
      snapshot: m
    };
    // Update state immediately so it shows in history right away
    setMatchHistory(prev => {
      var deduped = [entry, ...prev.filter(e => e.id !== entry.id)].slice(0, 50);
      try { localStorage.setItem(HIST_KEY, JSON.stringify(deduped)); } catch(e) {}
      return deduped;
    });
    // Save to Firebase so all other users can see it
    if (_fbDB && m.matchCode && m.matchCode !== "LOCAL") {
      _fbDB.ref("completedMatches/"+m.matchCode).set(entry).catch(()=>{});
    }
    // Push player stats to Firebase only for completed, non-abandoned matches
    if (!m.abandoned) updatePlayerStats(m);
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
    var msg = isViewer ? "Leave this match?" : "Start a new match? This will clear everything.";
    if (!confirm(msg)) return;
    if (match && match.matchCode && !isViewer) releaseScoring(match.matchCode);
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
      var STALE = 12*60*60*1000; // 12 hours
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

  function selectNewBowler(idx, newName, newPlayerId) {
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      var wTeam = m.batting===0 ? m.teamB : m.teamA;
      if (idx !== null && idx !== undefined) {
        // Existing bowler selected by index
        m.currentBowler = idx;
      } else {
        // Add new bowler to the list
        var nm = (newName||"").trim() || "Bowler";
        wTeam.bowlers.push({...mkB(nm), playerId: newPlayerId||null});
        m.currentBowler = wTeam.bowlers.length - 1;
      }
      m.needsBowler = false;
      return m;
    });
    setOverComplete(false);
  }
  
  // Replace the current bowler who hasn't bowled a ball yet
  function replaceBowler(idx, newName, newPlayerId) {
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      var wTeam = m.batting===0 ? m.teamB : m.teamA;
      // Remove the un-bowled current bowler entry from the list entirely
      var oldIdx = m.currentBowler;
      wTeam.bowlers.splice(oldIdx, 1);
      if (idx !== null && idx !== undefined) {
        // Existing bowler (already in list before this over)
        // Adjust idx if it shifted due to splice
        var adjustedIdx = idx > oldIdx ? idx - 1 : idx;
        m.currentBowler = adjustedIdx;
      } else {
        wTeam.bowlers.push({...mkB((newName||"").trim()||"Bowler"), playerId: newPlayerId||null});
        m.currentBowler = wTeam.bowlers.length - 1;
      }
      return m;
    });
    setReplacingBowler(false);
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
  function addRuns(r, extra, declared) {
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

      m.ballLog[bt].push({r, extra, declared: declared||false});

      if (!dead) {
        m.balls[bt]++; wT.bowlers[bi].balls++;
        if (m.balls[bt]===6) {
          m.overs[bt]++; m.balls[bt]=0;
          wT.bowlers[bi].overs++; wT.bowlers[bi].balls=0;
          m.striker=1-m.striker;
          if (!(m.overs[bt]>=m.totalOvers||m.wickets[bt]>=maxWkts(m,bt)||chaseWon(m))) m.needsBowler = true;
        }
        // Declared run: no strike rotation regardless of run count
        if (!declared && r%2!==0) m.striker=1-m.striker;
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

  function selectOpeners(strikerIdx, nonStrikerIdx) {
    setNeedsOpeners(false);
    setMatch(m => {
      var m2 = JSON.parse(JSON.stringify(m));
      m2.currentBatsmen = [strikerIdx, nonStrikerIdx];
      m2.striker = 0;
      m2.needsOpeners = false;
      return m2;
    });
  }

  // Replace a batsman who hasn't faced a ball yet (slot = position in currentBatsmen)
  function replaceBatter(slot, playerIdx) {
    setMatch(prev => {
      var m = JSON.parse(JSON.stringify(prev));
      m.currentBatsmen[slot] = playerIdx;
      return m;
    });
    setReplacingBatter(null);
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


  // Admin persona: isRealAdmin = actual admin email; isAdmin = real admin AND not in user-view mode
  var isRealAdmin = !!(currentUser && ADMIN_EMAILS.includes(currentUser.email));
  var isAdmin = isRealAdmin && !viewAsUser;

  if (showPlayers) return <PlayersScreen currentUser={currentUser} isAdmin={isAdmin} onBack={()=>setShowPlayers(false)} initialPlayerId={showPlayers!==true?showPlayers:null} setScreen={setScreen} setHomeTab={setHomeTab}/>;
  if (showTeams)   return <TeamsScreen   currentUser={currentUser} isAdmin={isAdmin} onBack={()=>setShowTeams(false)} setScreen={setScreen} setHomeTab={setHomeTab}/>;

  if (screen==="home") {
    var activeTab = homeTab || "home";
    function navTab(tab) { setHomeTab(tab); }
    var BottomNav = (
      <nav style={S.bottomNav}>
        {[
          {icon:"🏠",label:"Home",tab:"home"},
          {icon:"📡",label:"Live",tab:"live"},
          {icon:"📚",label:"History",tab:"history"},
          {icon:"👤",label:"Profile",tab:"profile"},
        ].map(({icon,label,tab})=>(
          <div key={tab} onClick={tab==="history"?()=>setScreen("history"):()=>navTab(tab)}
            style={{...S.navItem,color:activeTab===tab?SP.secondary:SP.textDim,background:activeTab===tab?"rgba(102,157,255,.1)":"transparent"}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
          </div>
        ))}
      </nav>
    );
    return (
    <div style={{...S.page,paddingBottom:88}}>
      {/* Top App Bar */}
      <header style={S.topBar}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>🏏</span>
          <span style={{color:"#fff",fontSize:16,fontWeight:"900",letterSpacing:-0.5,fontFamily:"Lexend,Georgia,sans-serif"}}>CRICKET PULSE</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:SP.bg3,borderRadius:999,border:"1px solid rgba(73,72,71,.2)"}}>
            <span style={{fontSize:11}}>{fbReady?"🔵":"🟡"}</span>
            <span style={{color:SP.textDim,fontSize:9,letterSpacing:2,fontWeight:"700",textTransform:"uppercase"}}>{fbReady?"Firebase Sync":"Offline"}</span>
          </div>
          {currentUser&&<button onClick={()=>{initFB();_fbAuth&&_fbAuth.signOut();}} style={{background:"none",border:"none",color:SP.textDim,fontSize:18,cursor:"pointer",padding:0}}>🔔</button>}
        </div>
      </header>

      <div style={{...S.wrap,padding:"0 20px"}}>
        {/* Admin persona toggle */}
        {isRealAdmin&&<div style={{paddingTop:10,textAlign:"center"}}>
          <button onClick={()=>setViewAsUser(v=>!v)} style={{...S.btnSm,borderColor:"rgba(167,139,250,.3)",color:viewAsUser?"#fbbf24":"#a78bfa"}}>
            {viewAsUser?"👤 User View":"🔒 Admin View"}
          </button>
        </div>}

        {/* ── HOME TAB ── */}
        {activeTab==="home"&&<div>
        {/* Hero CTA */}
        <div style={{margin:"16px 0 12px",background:SP.bg2,borderRadius:12,padding:"24px 20px",borderLeft:"4px solid "+SP.primary,overflow:"hidden",position:"relative"}}>
          <div style={{position:"absolute",right:-30,top:-30,width:120,height:120,background:"radial-gradient(circle,rgba(156,255,147,.08) 0%,transparent 70%)",pointerEvents:"none"}}/>
          <div style={S.lbl}>Ready for the next match?</div>
          <h2 style={{color:"#fff",fontSize:20,fontWeight:"800",margin:"0 0 6px",letterSpacing:-0.5,fontFamily:"Lexend,Georgia,sans-serif"}}>Start scoring live</h2>
          <p style={{color:SP.textSec,fontSize:13,marginBottom:16,lineHeight:1.6}}>
            {fbReady?"Viewers join instantly from any device.":"Firebase will sync when connected."}
          </p>
          <button onClick={()=>setScreen("setup")} className="sp-btn-primary" style={{maxWidth:280,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            ＋ Start New Match
          </button>
        </div>

        {/* Quick actions */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <button onClick={()=>setShowPlayers(true)} style={{padding:"16px 12px",background:SP.bg2,border:"none",borderRadius:12,color:"#fff",fontWeight:"700",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:.5,textAlign:"left"}}>
            <div style={{fontSize:22,marginBottom:6}}>🏏</div>
            <div>Players</div>
            <div style={{color:SP.textDim,fontSize:10,marginTop:2}}>View roster</div>
          </button>
          <button onClick={()=>setShowTeams(true)} style={{padding:"16px 12px",background:SP.bg2,border:"none",borderRadius:12,color:"#fff",fontWeight:"700",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:.5,textAlign:"left"}}>
            <div style={{fontSize:22,marginBottom:6}}>👥</div>
            <div>Teams</div>
            <div style={{color:SP.textDim,fontSize:10,marginTop:2}}>Manage squads</div>
          </button>
        </div>

        {/* Live Matches */}
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{color:"#fff",fontSize:16,fontWeight:"700",margin:0,fontFamily:"Lexend,Georgia,sans-serif"}}>Live Matches</h3>
            <button onClick={fetchLiveMatches} disabled={loadingLive}
              style={{...S.btnSm,color:SP.secondary,borderColor:"rgba(102,157,255,.25)"}}>
              {loadingLive?"Loading…":liveMatches===null?"Find":"↻ Refresh"}
            </button>
          </div>

          {liveError&&<div style={{color:"#ff716c",fontSize:12,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,marginBottom:10,border:"1px solid rgba(255,113,108,.15)"}}>{liveError}</div>}

          {liveMatches===null&&!loadingLive&&(
            <div style={{background:SP.bg2,borderRadius:12,padding:"20px",textAlign:"center",color:SP.textDim,fontSize:12}}>Tap Find to load live matches</div>
          )}
          {liveMatches!==null&&liveMatches.length===0&&(
            <div style={{background:SP.bg2,borderRadius:12,padding:"20px",textAlign:"center",color:SP.textDim,fontSize:12}}>No live matches right now</div>
          )}
          {liveMatches!==null&&liveMatches.map(m=>(
            <div key={m.code} onClick={()=>joinByCode(m.code)} className="sp-card sp-momentum"
              style={{cursor:"pointer",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{display:"flex",alignItems:"center",gap:6}}>
                  <span className="sp-live-dot"/>
                  <span style={{color:SP.primary,fontSize:9,letterSpacing:2,fontWeight:"700"}}>LIVE</span>
                </span>
                <span style={{color:SP.textDim,fontSize:10}}>{m.totalOvers} overs</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:m.batting===0?SP.secondary:SP.textSec,fontSize:13,fontWeight:"700",marginBottom:2}}>{m.teamA}</div>
                  <div style={{color:"#fff",fontSize:22,fontWeight:"800",letterSpacing:-0.5}}>{m.runs&&m.runs[0]!==undefined?m.runs[0]:0}<span style={{color:SP.textDim,fontSize:16,fontWeight:"400"}}>/{m.wickets&&m.wickets[0]!==undefined?m.wickets[0]:0}</span></div>
                </div>
                <div style={{color:SP.textDim,fontSize:11,fontWeight:"700"}}>VS</div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:m.batting===1?SP.secondary:SP.textSec,fontSize:13,fontWeight:"700",marginBottom:2}}>{m.teamB}</div>
                  <div style={{color:"#fff",fontSize:22,fontWeight:"800",letterSpacing:-0.5}}>{m.runs&&m.runs[1]!==undefined?m.runs[1]:0}<span style={{color:SP.textDim,fontSize:16,fontWeight:"400"}}>/{m.wickets&&m.wickets[1]!==undefined?m.wickets[1]:0}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{textAlign:"center",marginTop:6,paddingBottom:8}}>
          <button onClick={()=>setScreen("admin")} style={{background:"none",border:"none",color:isRealAdmin?SP.textDim:"#1a1919",fontSize:11,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>···</button>
        </div>
        </div>}{/* end home tab */}

        {/* ── LIVE TAB ── */}
        {activeTab==="live"&&<div style={{paddingTop:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h3 style={{color:"#fff",fontSize:18,fontWeight:"700",margin:0,fontFamily:"Lexend,Georgia,sans-serif"}}>Live Matches</h3>
            <button onClick={fetchLiveMatches} disabled={loadingLive}
              style={{...S.btnSm,color:SP.secondary,borderColor:"rgba(102,157,255,.25)"}}>
              {loadingLive?"Loading…":liveMatches===null?"🔍 Find":"↻ Refresh"}
            </button>
          </div>
          {liveError&&<div style={{color:SP.tertiary,fontSize:12,padding:"10px 14px",background:"rgba(255,112,114,.08)",borderRadius:8,marginBottom:12}}>{liveError}</div>}
          {liveMatches===null&&!loadingLive&&(
            <div style={{background:SP.bg2,borderRadius:12,padding:"40px 20px",textAlign:"center"}}>
              <div style={{fontSize:32,marginBottom:12}}>📡</div>
              <div style={{color:SP.textSec,fontSize:14,marginBottom:4,fontWeight:"600"}}>Find live matches</div>
              <div style={{color:SP.textDim,fontSize:12,marginBottom:20}}>Tap Find to load matches in progress</div>
              <button onClick={fetchLiveMatches} disabled={loadingLive} className="sp-btn-primary" style={{maxWidth:200,margin:"0 auto"}}>
                🔍 Find Matches
              </button>
            </div>
          )}
          {liveMatches!==null&&liveMatches.length===0&&(
            <div style={{background:SP.bg2,borderRadius:12,padding:"40px 20px",textAlign:"center",color:SP.textDim,fontSize:13}}>No live matches right now</div>
          )}
          {liveMatches!==null&&liveMatches.map(m=>(
            <div key={m.code} onClick={()=>joinByCode(m.code)}
              style={{background:SP.bg2,borderRadius:12,padding:"16px",marginBottom:10,cursor:"pointer",borderLeft:"3px solid "+SP.secondary}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{display:"flex",alignItems:"center",gap:6}}>
                  <span className="sp-live-dot"/>
                  <span style={{color:SP.primary,fontSize:9,letterSpacing:2,fontWeight:"700"}}>LIVE</span>
                </span>
                <span style={{color:SP.textDim,fontSize:11}}>{m.totalOvers} overs</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:m.batting===0?SP.secondary:SP.textSec,fontSize:13,fontWeight:"700",marginBottom:2,fontFamily:"Lexend,Georgia,sans-serif"}}>{m.teamA}</div>
                  <div style={{color:"#fff",fontSize:24,fontWeight:"800",letterSpacing:-0.5,fontFamily:"Lexend,Georgia,sans-serif"}}>{m.runs&&m.runs[0]!==undefined?m.runs[0]:0}<span style={{color:SP.textDim,fontSize:16,fontWeight:"300"}}>/{m.wickets&&m.wickets[0]!==undefined?m.wickets[0]:0}</span></div>
                </div>
                <div style={{color:SP.textDim,fontSize:12,fontWeight:"700"}}>VS</div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:m.batting===1?SP.secondary:SP.textSec,fontSize:13,fontWeight:"700",marginBottom:2,fontFamily:"Lexend,Georgia,sans-serif"}}>{m.teamB}</div>
                  <div style={{color:"#fff",fontSize:24,fontWeight:"800",letterSpacing:-0.5,fontFamily:"Lexend,Georgia,sans-serif"}}>{m.runs&&m.runs[1]!==undefined?m.runs[1]:0}<span style={{color:SP.textDim,fontSize:16,fontWeight:"300"}}>/{m.wickets&&m.wickets[1]!==undefined?m.wickets[1]:0}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>}{/* end live tab */}

        {/* ── PROFILE TAB ── */}
        {activeTab==="profile"&&<div style={{paddingTop:16}}>
          {currentUser ? (
            <div>
              {/* Avatar */}
              <div style={{textAlign:"center",marginBottom:24}}>
                <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,"+SP.secondary+",rgba(102,157,255,.3))",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:32}}>
                  {(currentUser.displayName||currentUser.email||"?")[0].toUpperCase()}
                </div>
                <div style={{color:"#fff",fontSize:18,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:4}}>{currentUser.displayName||"Player"}</div>
                <div style={{color:SP.textDim,fontSize:13}}>{currentUser.email}</div>
              </div>
              {/* Season Stats — only matches the current user played in */}
              {(()=>{
                var myName = currentUser.displayName||"";
                var myMatches = matchHistory.filter(e=>{
                  if (!e.snapshot) return false;
                  var nm = e.snapshot;
                  var allPlayers = [...((nm.teamA&&nm.teamA.players)||[]),...((nm.teamB&&nm.teamB.players)||[])];
                  return allPlayers.some(p=>p&&(
                    p.playerId===currentUser.uid ||
                    (userPlayerId && p.playerId===userPlayerId) ||
                    (myName&&p.name&&p.name.toLowerCase()===myName.toLowerCase())
                  ));
                });
                var myRuns = 0, myWickets = 0, myMatches50 = 0;
                myMatches.forEach(e=>{
                  var nm = e.snapshot;
                  var allP = [...((nm.teamA&&nm.teamA.players)||[]),...((nm.teamB&&nm.teamB.players)||[])];
                  var me = allP.find(p=>p&&(p.playerId===currentUser.uid||(userPlayerId&&p.playerId===userPlayerId)||(myName&&p.name&&p.name.toLowerCase()===myName.toLowerCase())));
                  if (me) { myRuns+=me.runs||0; myWickets+=(me.wickets||0); if((me.runs||0)>=50)myMatches50++; }
                  var allBowlers = [...((nm.teamA&&nm.teamA.bowlers)||[]),...((nm.teamB&&nm.teamB.bowlers)||[])];
                  var meBowl = allBowlers.find(b=>b&&(
                    (userPlayerId&&b.playerId===userPlayerId)||
                    (myName&&b.name&&b.name.toLowerCase()===myName.toLowerCase())
                  ));
                  if (meBowl) myWickets+=meBowl.wickets||0;
                });
                return (
                  <div style={{background:SP.bg2,borderRadius:12,padding:"16px",marginBottom:10}}>
                    <div style={{...S.lbl,marginBottom:8}}>My Season Stats</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                      {[["Matches",myMatches.length],["Runs",myRuns],["Wickets",myWickets],["50s",myMatches50]].map(([label,val])=>(
                        <div key={label} style={{textAlign:"center",background:SP.bg3,borderRadius:10,padding:"10px 4px"}}>
                          <div style={{color:"#fff",fontSize:20,fontWeight:"800",fontFamily:"Lexend,Georgia,sans-serif"}}>{val}</div>
                          <div style={{color:SP.textDim,fontSize:9,fontWeight:"700",letterSpacing:1,marginTop:2}}>{label.toUpperCase()}</div>
                        </div>
                      ))}
                    </div>
                    {myMatches.length===0&&<div style={{color:SP.textDim,fontSize:12,textAlign:"center",marginTop:8}}>No matches found for your player name</div>}
                  </div>
                );
              })()}
              {/* My Match History */}
              {(()=>{
                var myName = currentUser.displayName||"";
                var myMatches = matchHistory.filter(e=>{
                  if (!e.snapshot) return false;
                  var nm = e.snapshot;
                  var allPlayers = [...((nm.teamA&&nm.teamA.players)||[]),...((nm.teamB&&nm.teamB.players)||[])];
                  return allPlayers.some(p=>p&&(
                    p.playerId===currentUser.uid ||
                    (userPlayerId && p.playerId===userPlayerId) ||
                    (myName&&p.name&&p.name.toLowerCase()===myName.toLowerCase())
                  ));
                });
                if (!myMatches.length) return null;
                return (
                  <div style={{background:SP.bg2,borderRadius:12,padding:"16px",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={S.lbl}>My Match History</div>
                      <span style={{color:SP.textDim,fontSize:11}}>{myMatches.length} match{myMatches.length!==1?"es":""}</span>
                    </div>
                    {myMatches.map(e=>(
                      <div key={e.id} onClick={()=>{setMatch(normaliseMatch(e.snapshot));setScreen("historycard");}}
                        style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:"1px solid "+SP.bg3,cursor:"pointer"}}>
                        <div>
                          <div style={{color:"#fff",fontSize:13,fontWeight:"600",fontFamily:"Lexend,Georgia,sans-serif"}}>{e.teamA} vs {e.teamB}</div>
                          <div style={{color:SP.textDim,fontSize:11}}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{color:SP.secondary,fontSize:11,fontWeight:"700"}}>
                            {e.snapshot&&e.snapshot.inningsOver&&e.snapshot.inningsOver[1]
                              ?(e.runsB>e.runsA?e.teamB+" won":e.runsA>e.runsB?e.teamA+" won":"Tied"):"In Progress"}
                          </div>
                          <span style={{color:SP.textDim,fontSize:14}}>›</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Actions */}
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                <button onClick={()=>setShowPlayers(userPlayerId || currentUser.uid)}
                  style={{...S.btnSm,width:"100%",padding:"13px",textAlign:"left",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>🏏 My Player Profile</span><span style={{color:SP.secondary}}>›</span>
                </button>
                {isRealAdmin&&<button onClick={()=>setScreen("admin")}
                  style={{...S.btnSm,width:"100%",padding:"13px",textAlign:"left",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",color:"#a78bfa",borderColor:"rgba(167,139,250,.3)"}}>
                  <span>🔒 Admin Panel</span><span>›</span>
                </button>}
                <button onClick={()=>{setUserPlayerId(null);setHomeTab("home");initFB();_fbAuth&&_fbAuth.signOut();}}
                  style={{...S.btnSm,width:"100%",padding:"13px",textAlign:"center",fontSize:13,color:SP.tertiary,borderColor:"rgba(255,112,114,.25)",marginTop:4}}>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:48,marginBottom:16}}>👤</div>
              <div style={{color:"#fff",fontSize:16,fontWeight:"700",marginBottom:8,fontFamily:"Lexend,Georgia,sans-serif"}}>Not signed in</div>
              <div style={{color:SP.textDim,fontSize:13,marginBottom:24}}>Sign in to track your stats and history</div>
              <button onClick={()=>{initFB();_fbAuth&&_fbAuth.signOut();window.location.reload();}} className="sp-btn-primary" style={{maxWidth:200,margin:"0 auto"}}>Sign In</button>
            </div>
          )}
        </div>}{/* end profile tab */}

      </div>
      {BottomNav}
    </div>
  );}

  // ════════════════════════════════════════════════════════════
  // HISTORY LIST
  if (screen==="history") {
    function fmtDate(iso) {
      var d = new Date(iso);
      return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
    }
    function matchResult(e) {
      if (!e.snapshot||!e.snapshot.inningsOver||!e.snapshot.inningsOver[1]) return "Incomplete";
      if (e.runsB > e.runsA) return e.teamB+" won";
      if (e.runsA > e.runsB) return e.teamA+" won";
      return "Tied";
    }
    function resultColor(e) {
      if (!e.snapshot||!e.snapshot.inningsOver||!e.snapshot.inningsOver[1]) return SP.textDim;
      return SP.primary;
    }
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <header style={S.topBar}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:SP.textSec,fontSize:18,cursor:"pointer",padding:0}}>←</button>
              <span style={{color:"#fff",fontSize:15,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>Match History</span>
            </div>
          </div>
        </header>
        <div style={{...S.wrap,padding:"12px 20px"}}>
          {matchHistory.length===0 ? (
            <div style={{textAlign:"center",color:SP.textDim,padding:"60px 0",fontSize:13,fontFamily:"Lexend,Georgia,sans-serif"}}>No matches saved yet</div>
          ) : matchHistory.map((e)=>(
            <div key={e.id} onClick={()=>{setMatch(normaliseMatch(e.snapshot));setScreen("historycard");}}
              style={{background:SP.bg2,borderRadius:12,padding:"16px",marginBottom:8,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{...S.lbl,marginBottom:0}}>{fmtDate(e.date)}</div>
                <div style={{color:resultColor(e),fontSize:11,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:.5}}>{matchResult(e)}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"#fff",fontSize:14,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>{e.teamA}</div>
                  <div style={{color:SP.secondary,fontSize:18,fontWeight:"800",fontFamily:"Lexend,Georgia,sans-serif"}}>{e.runsA}/{e.wicketsA} <span style={{color:SP.textDim,fontSize:12,fontWeight:"400"}}>({e.oversA}.{e.ballsA})</span></div>
                </div>
                <div style={{color:SP.textDim,fontSize:11,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>VS</div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:"#fff",fontSize:14,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>{e.teamB}</div>
                  <div style={{color:SP.secondary,fontSize:18,fontWeight:"800",fontFamily:"Lexend,Georgia,sans-serif"}}>{e.runsB}/{e.wicketsB} <span style={{color:SP.textDim,fontSize:12,fontWeight:"400"}}>({e.oversB}.{e.ballsB})</span></div>
                </div>
              </div>
            </div>
          ))}
          {matchHistory.length > 0 && isAdmin && (
            <button onClick={()=>setScreen("admin")}
              className="sp-btn-secondary" style={{marginTop:8,marginBottom:20}}>
              ⚙ Admin — Manage History
            </button>
          )}
        </div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:tab==="history"?SP.secondary:SP.textDim,background:tab==="history"?"rgba(102,157,255,.1)":"transparent"}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // HISTORY SCORECARD
  if (screen==="historycard" && match) {
    function TCardH({team,inn,opp}) {
      return (
        <div style={{marginBottom:20}}>
          <div style={{background:SP.bg3,borderRadius:12,overflow:"hidden",border:"1px solid rgba(73,72,71,.25)"}}>
            <div style={{background:SP.bg,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:SP.primary,fontWeight:"bold",fontSize:15}}>{team.name}</span>
              <span style={{color:"#fff",fontWeight:"bold"}}>{match.runs[inn]}/{match.wickets[inn]} <span style={{color:SP.textDim,fontSize:12}}>({match.overs[inn]}.{match.balls[inn]})</span></span>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Batter","R","B","4s","6s","SR"].map(h=><th key={h} style={{padding:"5px 7px",color:SP.textDim,fontSize:11,textAlign:h==="Batter"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {team.players.filter(p=>p.balls>0||p.out||p.retired).map((p,pi)=>(
                  <tr key={pi} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",minWidth:110}}>
                      <div style={{color:p.out?"#64748b":p.retired?"#67e8f9":"#e2e8f0",fontSize:13}}>{p.name}</div>
                      {p.out&&<div style={{color:SP.textDim,fontSize:10}}>
                        {p.howOut==="Bowled"?`b ${p.dismissedBy}`:
                         p.howOut==="Caught"?`c & b ${p.dismissedBy}`:
                         p.howOut==="LBW"?`lbw b ${p.dismissedBy}`:
                         p.howOut==="Stumped"?`st b ${p.dismissedBy}`:
                         p.howOut==="Hit Wicket"?`hit wkt b ${p.dismissedBy}`:
                         p.howOut==="Run Out"?`run out`:p.howOut}
                      </div>}
                      {p.retired&&<div style={{color:"#0891b2",fontSize:10}}>Retired Hurt</div>}
                    </td>
                    <td style={{textAlign:"center",color:SP.primary,fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{p.runs}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{p.balls}</td>
                    <td style={{textAlign:"center",color:SP.secondary,fontSize:13,padding:"7px 4px"}}>{p.fours}</td>
                    <td style={{textAlign:"center",color:"#f59e0b",fontSize:13,padding:"7px 4px"}}>{p.sixes}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:12,padding:"7px 4px"}}>{srFn(p)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"1px solid rgba(73,72,71,.25)"}}>
                  <td colSpan="6" style={{padding:"6px 8px"}}>
                    <span style={{color:SP.textSec,fontSize:12}}>Extras: <b style={{color:"#fff"}}>{match.extras[inn]}</b></span>
                    <span style={{color:SP.textDim,fontSize:11,marginLeft:8}}>W:{match.extrasBreakdown[inn].wide} NB:{match.extrasBreakdown[inn].noBall} B:{match.extrasBreakdown[inn].bye} LB:{match.extrasBreakdown[inn].legBye}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={{width:"100%",borderCollapse:"collapse",borderTop:"2px solid rgba(73,72,71,.35)"}}>
              <thead><tr>{["Bowler","O","M","R","W","Eco"].map(h=><th key={h} style={{padding:"5px 7px",color:SP.textDim,fontSize:11,textAlign:h==="Bowler"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {opp.bowlers.filter(b=>b.overs>0||b.balls>0).map((b,bi)=>(
                  <tr key={bi} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",color:"#fff",fontSize:13,minWidth:110}}>{b.name}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.overs}.{b.balls}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.maidens}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.runs}</td>
                    <td style={{textAlign:"center",color:SP.tertiary,fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{b.wickets}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:12,padding:"7px 4px"}}>{ecoFn(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{...S.topBar,position:"static",padding:"12px 16px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>{setMatch(null);setScreen("history");}} style={{background:"none",border:"none",color:SP.textSec,fontSize:18,cursor:"pointer",padding:0}}>←</button>
              <span style={{color:"#fff",fontSize:15,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>Scorecard</span>
            </div>
          </div>
          {match.teamA&&match.teamB&&<TCardH team={match.teamA} inn={0} opp={match.teamB}/>}
          {match.inningsOver&&match.inningsOver[0]&&match.teamB&&<TCardH team={match.teamB} inn={1} opp={match.teamA}/>}
          {match.matchCode&&match.matchCode!=="LOCAL"&&(
            <MatchMediaGallery matchCode={match.matchCode} currentUser={currentUser}/>
          )}
          <nav style={S.bottomNav}>
            {[
              {icon:"🏠",label:"Home",tab:"home"},
              {icon:"📡",label:"Live",tab:"live"},
              {icon:"📚",label:"History",tab:"history"},
              {icon:"👤",label:"Profile",tab:"profile"},
            ].map(({icon,label,tab})=>(
              <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
                style={{...S.navItem,color:SP.textDim}}>
                <span style={{fontSize:20}}>{icon}</span>
                <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
              </div>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // ADMIN
  if (screen==="admin") {
    const ADMIN_PIN = "1989";
    var isAdminUser = isAdmin;
    var pinOk = isAdminUser || adminPin===ADMIN_PIN;
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{...S.topBar,position:"static",padding:"12px 16px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>{setScreen("home");setAdminPin("");}} style={{background:"none",border:"none",color:SP.textSec,fontSize:18,cursor:"pointer",padding:0}}>←</button>
              <span style={{color:"#fff",fontSize:15,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>Admin</span>
            </div>
          </div>
          {!pinOk ? (
            <div style={{background:SP.bg3,borderRadius:10,padding:24,border:"1px solid rgba(73,72,71,.25)",textAlign:"center"}}>
              <div style={{color:SP.textSec,fontSize:13,marginBottom:16}}>Enter admin PIN to continue</div>
              <input
                type="password" maxLength={8} value={adminPin}
                onChange={e=>setAdminPin(e.target.value)}
                placeholder="PIN"
                style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"14px",color:SP.primary,fontSize:24,textAlign:"center",outline:"none",boxSizing:"border-box",fontFamily:"monospace",letterSpacing:8}}
              />
              {adminPin.length>0&&!pinOk&&<div style={{color:SP.tertiary,fontSize:12,marginTop:10}}>Incorrect PIN</div>}
            </div>
          ) : (
            <AdminPanel matchHistory={matchHistory} setMatchHistory={setMatchHistory} currentUser={currentUser} onDone={()=>{setScreen("home");setAdminPin("");}}/>
          )}
          <nav style={S.bottomNav}>
            {[
              {icon:"🏠",label:"Home",tab:"home"},
              {icon:"📡",label:"Live",tab:"live"},
              {icon:"📚",label:"History",tab:"history"},
              {icon:"👤",label:"Profile",tab:"profile"},
            ].map(({icon,label,tab})=>(
              <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
                style={{...S.navItem,color:SP.textDim}}>
                <span style={{fontSize:20}}>{icon}</span>
                <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
              </div>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  if (screen==="setup") {
    var s=setup;
    var STEPS=[`Match Details`, `${s.teamAName} — Players`, `${s.teamBName} — Players`, `Toss`];
    return (
      <React.Fragment>
      <div style={{minHeight:"100dvh",background:SP.bg,display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 16px 40px",fontFamily:"Lexend,Georgia,sans-serif"}}>
        <div style={{width:"100%",maxWidth:420}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
            <button onClick={()=>setScreen("home")} style={S.btnSm}>← Home</button>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:SP.textDim,fontSize:11}}>STEP {s.step+1}/{STEPS.length}</span>
                <span style={{color:SP.primary,fontSize:11}}>{STEPS[s.step]}</span>
              </div>
              <div style={{height:3,background:SP.bg3,borderRadius:2}}>
                <div style={{height:"100%",width:(s.step/(STEPS.length-1)*100)+"%",background:"linear-gradient(90deg,#fbbf24,#d97706)",borderRadius:2,transition:"width .3s"}}/>
              </div>
            </div>
          </div>
          <div style={{background:SP.bg2,borderRadius:12,padding:22,border:"none"}}>
            {s.step===0&&(
              <div>
                {[["TEAM 1 NAME","teamAName"],["TEAM 2 NAME","teamBName"]].map(([lbl,key])=>(
                  <div key={key} style={{marginBottom:14}}>
                    <label style={{color:SP.textDim,fontSize:11,display:"block",marginBottom:6,letterSpacing:1}}>{lbl}</label>
                    <input value={s[key]} onChange={e=>{var v=e.target.value;setSetup(p=>({...p,[key]:v}));}}
                      style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"12px 14px",color:"#fff",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif"}}
                    />
                  </div>
                ))}
                <label style={{color:SP.textDim,fontSize:11,display:"block",marginBottom:10,letterSpacing:1}}>OVERS PER INNINGS</label>
                <div style={{display:"flex",alignItems:"center",gap:0,background:SP.bg,borderRadius:12,border:"1px solid rgba(73,72,71,.25)",overflow:"hidden"}}>
                  <button
                    onClick={()=>setSetup(p=>({...p,overs:Math.max(1,p.overs-1)}))}
                    style={{width:48,height:52,background:"transparent",border:"none",color:SP.textSec,fontSize:24,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",flexShrink:0,borderRight:"1px solid rgba(73,72,71,.25)"}}>
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
                    style={{flex:1,background:"transparent",border:"none",color:SP.primary,fontSize:26,fontWeight:"bold",textAlign:"center",outline:"none",fontFamily:"Lexend,Georgia,sans-serif",padding:"0 4px"}}
                  />
                  <button
                    onClick={()=>setSetup(p=>({...p,overs:Math.min(100,p.overs+1)}))}
                    style={{width:48,height:52,background:"transparent",border:"none",color:SP.textSec,fontSize:24,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",flexShrink:0,borderLeft:"1px solid rgba(73,72,71,.25)"}}>
                    +
                  </button>
                </div>
                <div style={{display:"flex",gap:6,marginTop:10}}>
                  {[5,10,20,50].map(o=>(
                    <button key={o} onClick={()=>setSetup(p=>({...p,overs:o}))}
                      style={{flex:1,padding:"8px 0",borderRadius:8,border:s.overs===o?"1px solid #fbbf24":"1px solid rgba(73,72,71,.25)",background:s.overs===o?"rgba(251,191,36,.12)":"transparent",color:s.overs===o?"#fbbf24":"#475569",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {s.step===1&&(
              <div>
                <div style={{textAlign:"center",marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(73,72,71,.25)"}}>
                  <div style={{color:SP.textDim,fontSize:11,letterSpacing:2,marginBottom:4}}>TEAM 1 — SELECT PLAYERS</div>
                  <div style={{color:SP.primary,fontSize:22,fontWeight:"bold"}}>{s.teamAName}</div>
                </div>
                <PlayerPickerStep
                  teamName={s.teamAName}
                  selectedNames={s.teamAPlayers} selectedIds={s.teamAPlayerIds}
                  onUpdate={(names,ids)=>setSetup(p=>({...p,teamAPlayers:names,teamACount:names.length,teamAPlayerIds:ids}))}
                  currentUser={currentUser}/>
              </div>
            )}
            {s.step===2&&(
              <div>
                <div style={{textAlign:"center",marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(73,72,71,.25)"}}>
                  <div style={{color:SP.textDim,fontSize:11,letterSpacing:2,marginBottom:4}}>TEAM 2 — SELECT PLAYERS</div>
                  <div style={{color:SP.primary,fontSize:22,fontWeight:"bold"}}>{s.teamBName}</div>
                </div>
                <PlayerPickerStep
                  teamName={s.teamBName}
                  selectedNames={s.teamBPlayers} selectedIds={s.teamBPlayerIds}
                  onUpdate={(names,ids)=>setSetup(p=>({...p,teamBPlayers:names,teamBCount:names.length,teamBPlayerIds:ids}))}
                  currentUser={currentUser}/>
              </div>
            )}
            {s.step===3&&(
              <TossStep
                teamAName={s.teamAName} teamBName={s.teamBName}
                tossWinner={s.tossWinner} battingFirst={s.battingFirst}
                onToss={(winner)=>setSetup(p=>({...p,tossWinner:winner,battingFirst:winner===null?0:null}))}
                onChoice={(bf)=>setSetup(p=>({...p,battingFirst:bf}))}
              />
            )}
            <div style={{display:"flex",gap:10,marginTop:22}}>
              {s.step>0&&<button onClick={()=>setSetup(p=>({...p,step:p.step-1}))}
                style={{flex:1,padding:"13px 0",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:12,color:SP.textSec,fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>← Back</button>}
              {s.step<STEPS.length-1
                ?<button onClick={()=>setSetup(p=>({...p,step:p.step+1}))}
                  style={{flex:2,padding:"13px 0",background:"linear-gradient(135deg,#1d4ed8,#1e40af)",borderRadius:12,border:"none",color:"#fff",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>Next →</button>
                :<button onClick={s.battingFirst!==null&&s.battingFirst!==undefined?startMatch:undefined}
                  disabled={s.battingFirst===null||s.battingFirst===undefined}
                  style={{flex:2,padding:"13px 0",background:s.battingFirst!==null&&s.battingFirst!==undefined?SP.primary:"#1e293b",borderRadius:12,border:s.battingFirst!==null&&s.battingFirst!==undefined?"none":"1px solid rgba(73,72,71,.25)",color:s.battingFirst!==null&&s.battingFirst!==undefined?"#0f172a":"#334155",fontWeight:"bold",fontSize:15,cursor:s.battingFirst!==null&&s.battingFirst!==undefined?"pointer":"not-allowed",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:1}}>
                  {s.battingFirst!==null&&s.battingFirst!==undefined?"▶ Start Match":"← Pick bat or bowl"}
                </button>}
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
            if (teamPickerSlot==="A") {
              setSetup(p=>({...p,
                teamAName: picked.teamName,
                teamAPlayers: playerNames, teamACount: playerNames.length, teamAPlayerIds: playerIds,
              }));
            } else {
              setSetup(p=>({...p,
                teamBName: picked.teamName,
                teamBPlayers: playerNames, teamBCount: playerNames.length, teamBPlayerIds: playerIds,
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
  var bt       = match.batting||0;
  var bTeam    = bt===0?match.teamA:match.teamB;
  var wTeam    = bt===0?match.teamB:match.teamA;
  // Guard against missing/corrupt nested data (can happen during Firebase sync)
  if (!bTeam||!bTeam.players||!wTeam||!wTeam.bowlers) return null;
  var bTeamKey = bt===0?"A":"B";
  var wTeamKey = bt===0?"B":"A";
  var striker    = bTeam.players[match.currentBatsmen&&match.currentBatsmen[match.striker||0]];
  var nonStriker = bTeam.players[match.currentBatsmen&&match.currentBatsmen[1-(match.striker||0)]];
  var bowler     = wTeam.bowlers[match.currentBowler||0];
  var target     = bt===1?match.runs[0]+1:null;
  var needed     = target?target-match.runs[1]:null;
  var ballsLeft  = (match.totalOvers-match.overs[bt])*6-match.balls[bt];
  var lastBalls  = (match.ballLog&&match.ballLog[bt])||[];
  lastBalls      = lastBalls.slice(-12);

  // ── Shared UI blocks ──────────────────────────────────────────
  function ScoreHeader() {
    return (
      <div style={{margin:"10px 12px",background:"linear-gradient(135deg,#0f1f40,#111827)",borderRadius:16,padding:"16px 18px",border:"1px solid rgba(102,157,255,.15)"}}>
        {match.matchCode&&match.matchCode!=="LOCAL"&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {isViewer?<span className="sp-live-dot"/>:<span style={{color:SP.textDim,fontSize:10,letterSpacing:1}}>📡 BROADCASTING</span>}
              {isViewer&&<span style={{color:SP.textDim,fontSize:10,letterSpacing:2}}>LIVE</span>}
            </div>
            <div style={{background:"rgba(102,157,255,.1)",border:"1px solid rgba(102,157,255,.25)",borderRadius:8,padding:"4px 12px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{color:SP.textDim,fontSize:10}}>CODE</span>
              <span style={{color:SP.secondary,fontWeight:"bold",fontSize:18,fontFamily:"monospace",letterSpacing:4}}>{match.matchCode}</span>
            </div>
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:target?10:0}}>
          <div>
            <div style={{color:SP.secondary,fontSize:10,letterSpacing:2,marginBottom:4,fontWeight:"700"}}>BATTING</div>
            <div style={{color:"#fff",fontWeight:"bold",fontSize:18,fontFamily:"Lexend,Georgia,sans-serif"}}>{bTeam.name}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{lineHeight:1}}>
              <span style={{color:"#fff",fontSize:34,fontWeight:"bold"}}>{match.runs[bt]}</span>
              <span style={{color:SP.textDim,fontSize:22}}>/{match.wickets[bt]}</span>
            </div>
            <div style={{color:SP.textDim,fontSize:13,marginTop:2}}>{match.overs[bt]}.{match.balls[bt]} / {match.totalOvers} ov</div>
          </div>
        </div>
        {target&&(
          <div style={{background:"rgba(255,112,114,.08)",border:"1px solid rgba(255,112,114,.2)",borderRadius:10,padding:"8px 14px",display:"flex",gap:16}}>
            <span style={{color:"rgba(255,160,160,.8)",fontSize:13}}>Target: <b style={{color:"#fff"}}>{target}</b></span>
            <span style={{color:"rgba(255,160,160,.8)",fontSize:13}}>Need: <b style={{color:"#fff"}}>{needed}</b> off <b style={{color:"#fff"}}>{ballsLeft}</b> balls</span>
          </div>
        )}
      </div>
    );
  }

  function BatterCard({editable}) {
    return (
      <div style={{...S.card}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={S.lbl}>BATTERS</span>
          {editable&&<span style={{color:SP.textDim,fontSize:10}}>✏ tap name to edit</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 32px 32px 32px 32px 44px",gap:4,marginBottom:6}}>
          {["NAME","R","B","4s","6s","SR"].map(h=><span key={h} style={{color:SP.textDim,fontSize:10,textAlign:h==="NAME"?"left":"center",fontWeight:"600"}}>{h}</span>)}
        </div>
        {[
          {p:striker,    si:match.currentBatsmen[match.striker],   slot:match.striker,   isStriker:true},
          {p:nonStriker && match.currentBatsmen[0]!==match.currentBatsmen[1] ? nonStriker : null, si:match.currentBatsmen[1-match.striker], slot:1-match.striker, isStriker:false},
        ].map(({p,si,slot,isStriker})=> p&&(
          <div key={si} style={{borderTop:"1px solid "+SP.bg4}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 32px 32px 32px 32px 44px",gap:4,padding:"8px 0",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden"}}>
                <span style={{color:SP.secondary,fontSize:13,flexShrink:0}}>{isStriker?"🏏":"   "}</span>
                {editable
                  ? <span onClick={()=>startEdit(bTeamKey,"player",si,p.name)}
                      style={{color:isStriker?"#fff":SP.textSec,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",borderBottom:"1px dashed "+SP.textDim,fontFamily:"Lexend,Georgia,sans-serif",fontWeight:isStriker?"700":"400"}}>
                      {p.name}
                    </span>
                  : <span style={{color:isStriker?"#fff":SP.textSec,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:isStriker?"700":"400"}}>{p.name}</span>}
              </div>
              <span style={{color:SP.secondary,fontWeight:"bold",fontSize:15,textAlign:"center"}}>{p.runs}</span>
              <span style={{color:SP.textSec,fontSize:13,textAlign:"center"}}>{p.balls}</span>
              <span style={{color:"#60a5fa",fontSize:13,textAlign:"center"}}>{p.fours}</span>
              <span style={{color:SP.primary,fontSize:13,textAlign:"center"}}>{p.sixes}</span>
              <span style={{color:SP.textDim,fontSize:12,textAlign:"center"}}>{srFn(p)}</span>
            </div>
            {editable && p.balls === 0 && (
              <div style={{paddingBottom:6}}>
                <button onClick={()=>setReplacingBatter(slot)}
                  style={{fontSize:10,padding:"3px 10px",borderRadius:6,background:"transparent",border:"1px solid rgba(251,191,36,.35)",color:"#fbbf24",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"600",letterSpacing:.5}}>
                  ⇄ Replace
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ── Replace batter picker modal ───────────────────────────────
  function ReplaceBatterModal() {
    if (replacingBatter === null) return null;
    var slot = replacingBatter;
    // The player currently in that slot
    var currentIdx = match.currentBatsmen[slot];
    // Both slots in use — exclude them both so neither can be re-picked
    var inUse = new Set(match.currentBatsmen);
    var available = bTeam.players.map((p,i)=>({...p,i})).filter(p=>!p.out && !p.retired && !inUse.has(p.i));
    var [search, setSearch] = React.useState("");
    var filtered = available.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid rgba(73,72,71,.25)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
          <div style={{textAlign:"center",marginBottom:14,flexShrink:0}}>
            <div style={{fontSize:22,marginBottom:6}}>⇄</div>
            <div style={{color:"#fbbf24",fontSize:13,fontWeight:"bold",letterSpacing:1.5,marginBottom:4}}>REPLACE BATSMAN</div>
            <div style={{color:SP.textDim,fontSize:12}}>Replacing: <b style={{color:"#fff"}}>{bTeam.players[currentIdx].name}</b></div>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
            style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"9px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:10,flexShrink:0}}/>
          <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:6}}>
            {filtered.map(p=>(
              <button key={p.i} onClick={()=>replaceBatter(slot, p.i)}
                style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(73,72,71,.25)",background:SP.bg,color:"#fff",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                <div>
                  <div style={{fontWeight:"bold",marginBottom:2}}>{p.name}</div>
                  <div style={{color:SP.textDim,fontSize:11}}>{p.role||"Batsman"} · Yet to bat</div>
                </div>
                <span style={{color:"#fbbf24",fontSize:18}}>→</span>
              </button>
            ))}
            {filtered.length===0&&(
              <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:"20px 0"}}>No other batsmen available</div>
            )}
          </div>
          <button onClick={()=>setReplacingBatter(null)}
            style={{marginTop:14,width:"100%",padding:"11px 0",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",flexShrink:0}}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function BowlerCard({editable}) {
    return (
      <div style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:SP.textDim,fontSize:10,marginBottom:3,letterSpacing:1,fontWeight:"600"}}>BOWLING — {wTeam.name}</div>
          {editable
            ? <span onClick={()=>startEdit(wTeamKey,"bowler",match.currentBowler,bowler?bowler.name:"")}
                style={{color:"#fff",fontSize:15,cursor:"pointer",borderBottom:"1px dashed "+SP.textDim,fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"600"}}>
                {bowler?bowler.name:""}
              </span>
            : <span style={{color:"#fff",fontSize:15,fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"600"}}>{bowler?bowler.name:""}</span>}
        </div>
        <div style={{display:"flex",gap:14,flexShrink:0}}>
          {bowler&&[["O",bowler.overs+"."+bowler.balls],["R",bowler.runs],["W",bowler.wickets]].map(([l,v])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{color:SP.textDim,fontSize:10,fontWeight:"600"}}>{l}</div>
              <div style={{color:l==="W"?SP.tertiary:"#fff",fontWeight:"bold",fontSize:16,fontFamily:"Lexend,Georgia,sans-serif"}}>{v}</div>
            </div>
          ))}
        </div>
		{editable && bowler && bowler.balls===0 && bowler.overs===0 && (
          <div style={{marginTop:8}}>
            <button onClick={()=>setReplacingBowler(true)}
              style={{fontSize:10,padding:"3px 10px",borderRadius:6,background:"transparent",border:"1px solid rgba(251,191,36,.35)",color:"#fbbf24",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",fontWeight:"600",letterSpacing:.5}}>
              ⇄ Replace
            </button>
          </div>
        )}
      </div>
    );
  }
	
  function ReplaceBowlerModal() {
    if (!replacingBowler || !bowler) return null;
    var allFielders = wTeam.players;
    var bowlerStatMap = {};
    wTeam.bowlers.forEach((b,i) => { bowlerStatMap[b.name] = {...b, bowlerIdx: i}; });
    // Exclude the current un-bowled bowler from options
    var currentBowlerName = bowler.name;
    var [search, setSearch] = React.useState("");
    var filtered = allFielders
      .filter(p => p.name !== currentBowlerName)
      .filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <div style={{background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480,border:"1px solid rgba(73,72,71,.25)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
          <div style={{textAlign:"center",marginBottom:14,flexShrink:0}}>
            <div style={{fontSize:22,marginBottom:6}}>⇄</div>
            <div style={{color:"#fbbf24",fontSize:13,fontWeight:"bold",letterSpacing:1.5,marginBottom:4}}>REPLACE BOWLER</div>
            <div style={{color:SP.textDim,fontSize:12}}>Replacing: <b style={{color:"#fff"}}>{currentBowlerName}</b></div>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
            style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"9px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:10,flexShrink:0}}/>
          <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:6}}>
            {filtered.map((player, pi) => {
              var stats = bowlerStatMap[player.name];
              var hasBowled = !!stats;
              return (
                <button key={pi} onClick={()=>replaceBowler(hasBowled ? stats.bowlerIdx : null, hasBowled ? null : player.name, player.playerId||null)}
                  style={{padding:"12px 14px",borderRadius:12,border:hasBowled?"1px solid rgba(73,72,71,.25)":"1px solid #1e3a5f",background:hasBowled?"#0f172a":"rgba(30,58,95,.3)",color:"#e2e8f0",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                  <div>
                    <div style={{fontWeight:hasBowled?"normal":"bold",color:hasBowled?"#e2e8f0":"#93c5fd"}}>{player.name}</div>
                    {hasBowled
                      ? <div style={{color:SP.textDim,fontSize:11}}>{stats.overs}.{stats.balls} ov · {stats.runs}r · {stats.wickets}w</div>
                      : <div style={{color:SP.textDim,fontSize:11}}>Yet to bowl</div>}
                  </div>
                  <span style={{color:"#fbbf24",fontSize:18}}>→</span>
                </button>
              );
            })}
            {filtered.length===0 && (
              <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:"20px 0"}}>No other bowlers available</div>
            )}
          </div>
          <button onClick={()=>setReplacingBowler(false)}
            style={{marginTop:14,width:"100%",padding:"11px 0",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",flexShrink:0}}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function BallLog() {
    if (!lastBalls.length) return null;
    return (
      <div style={{marginBottom:10,display:"flex",gap:6,flexWrap:"wrap"}}>
        {lastBalls.map((b,i)=>(
          <div key={i} style={{width:36,height:36,borderRadius:"50%",background:bBg(b),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:"bold",fontFamily:"Lexend,Georgia,sans-serif",boxShadow:b.r===6?"0 0 8px rgba(156,255,147,.4)":b.r===4?"0 0 8px rgba(102,157,255,.3)":"none"}}>
            {bTxt(b)}
          </div>
        ))}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // VIEWER
  if (screen==="viewer") {
    var canScore = match && canClaimScoring(match);
    var iAmScorer = match && currentUser && match.scorerUid === currentUser.uid;
    var scorerActive = match && match.scorerUid && !iAmScorer; // someone else is scoring
    var iRequestedHandover = match && match.scorerRequest && currentUser && match.scorerRequest.uid === currentUser.uid;
    return (
    <div style={S.page}>
      <EditModal editing={editing} editVal={editVal} setEditVal={setEditVal} onCommit={commitEdit} onCancel={cancelEdit}/>
      {scorerToast ? (
        <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:SP.bg3,border:"1px solid rgba(156,255,147,.3)",borderRadius:999,padding:"10px 20px",color:SP.primary,fontSize:12,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif",zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,.6)",whiteSpace:"nowrap",letterSpacing:.5}}>
          🏏 {scorerToast}
        </div>
      ) : null}
      <div style={S.wrap}>
        {/* Viewer top bar */}
        <div style={{...S.topBar}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>🏏</span>
            <span style={{color:"#fff",fontSize:13,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>CRICKET PULSE</span>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>setScreen("scorecard")} style={S.btnSm}>📊</button>
            {canScore && (
              scorerActive
                ? iRequestedHandover
                  ? <button disabled style={{...S.btnSm,opacity:0.5}}>⏳</button>
                  : <button onClick={()=>requestHandover(match)} style={{...S.btnSm,color:SP.primary,borderColor:"rgba(156,255,147,.3)"}}>✋ Request</button>
                : <button onClick={()=>claimScoring(match)} style={{...S.btnSm,color:SP.primary,borderColor:"rgba(156,255,147,.3)"}}>🏏 Score</button>
            )}
            <button onClick={resetAll} style={{...S.btnSm,color:SP.tertiary,borderColor:"rgba(255,112,114,.2)"}}>✕</button>
          </div>
        </div>
        {/* Scorer info strip */}
        <div style={{background:SP.bg2,borderBottom:"1px solid "+SP.bg3,padding:"6px 14px",display:"flex",alignItems:"center",gap:8}}>
          {match&&match.scorerName
            ? <span style={{color:SP.textSec,fontSize:12,fontFamily:"Lexend,Georgia,sans-serif"}}>🏏 <b style={{color:"#fff"}}>{match.scorerName}</b> is scoring</span>
            : <span style={{color:SP.textDim,fontSize:12,fontFamily:"Lexend,Georgia,sans-serif"}}>No active scorer</span>}
          {match&&match.scorerRequest&&(
            <span style={{marginLeft:"auto",color:SP.textDim,fontSize:11}}>
              ✋ {match.scorerRequest.name} requesting…
            </span>
          )}
        </div>
        <ScoreHeader/>
        <div style={{padding:"0 12px"}}>
          <BatterCard editable={false}/>
          <BowlerCard editable={false}/>
          <BallLog/>
        </div>
        {match.inningsOver[0]&&bt===0&&(
          <div style={{margin:"0 12px 12px",background:"rgba(156,255,147,.08)",borderRadius:10,padding:18,textAlign:"center",border:"1px solid rgba(156,255,147,.2)"}}>
            <div style={{color:SP.primary,fontWeight:"bold",fontSize:15}}>1st Innings Complete</div>
            <div style={{color:"#fff",fontSize:13,marginTop:4}}>{match.teamA.name}: {match.runs[0]}/{match.wickets[0]}</div>
          </div>
        )}
        {match.inningsOver[1]&&bt===1&&(
          <div style={{margin:"0 12px 12px",background:SP.bg3,borderRadius:10,padding:20,textAlign:"center",border:"1px solid rgba(102,157,255,.2)"}}>
            <div style={{fontSize:30,marginBottom:6}}>🏆</div>
            <div style={{color:SP.primary,fontWeight:"bold",fontSize:18,marginBottom:4}}>Match Over!</div>
            {match.runs[1]>match.runs[0]?<div style={{color:SP.primary,fontSize:14}}>{match.teamB.name} wins by {10-match.wickets[1]} wickets!</div>
             :match.runs[1]<match.runs[0]?<div style={{color:SP.tertiary,fontSize:14}}>{match.teamA.name} wins by {match.runs[0]-match.runs[1]} runs!</div>
             :<div style={{color:SP.primary,fontSize:14}}>Match Tied!</div>}
          </div>
        )}
        <div style={{textAlign:"center",padding:"14px 0",color:"#334155",fontSize:11}}>Updates every ball automatically</div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:SP.textDim}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
  } // end viewer

  // ════════════════════════════════════════════════════════════
  // SCORECARD
  if (screen==="scorecard") {
    var prev = isViewer?"viewer":"match";
    function TCard({team,inn,opp}) {
      return (
        <div style={{marginBottom:20}}>
          <div style={{background:SP.bg3,borderRadius:12,overflow:"hidden",border:"1px solid rgba(73,72,71,.25)"}}>
            <div style={{background:SP.bg,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:SP.primary,fontWeight:"bold",fontSize:15}}>{team.name}</span>
              <span style={{color:"#fff",fontWeight:"bold"}}>{match.runs[inn]}/{match.wickets[inn]} <span style={{color:SP.textDim,fontSize:12}}>({match.overs[inn]}.{match.balls[inn]})</span></span>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Batter","R","B","4s","6s","SR"].map(h=><th key={h} style={{padding:"5px 7px",color:SP.textDim,fontSize:11,textAlign:h==="Batter"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {team.players.filter(p=>p.balls>0||p.out||p.retired).map((p,i)=>(
                  <tr key={i} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",minWidth:110}}>
                      <div style={{color:p.out?"#64748b":p.retired?"#67e8f9":"#e2e8f0",fontSize:13}}>{p.name}</div>
                      {p.out&&<div style={{color:SP.textDim,fontSize:10}}>
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
                    <td style={{textAlign:"center",color:SP.primary,fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{p.runs}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{p.balls}</td>
                    <td style={{textAlign:"center",color:SP.secondary,fontSize:13,padding:"7px 4px"}}>{p.fours}</td>
                    <td style={{textAlign:"center",color:"#f59e0b",fontSize:13,padding:"7px 4px"}}>{p.sixes}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:12,padding:"7px 4px"}}>{srFn(p)}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"1px solid rgba(73,72,71,.25)"}}>
                  <td colSpan="6" style={{padding:"6px 8px"}}>
                    <span style={{color:SP.textSec,fontSize:12}}>Extras: <b style={{color:"#fff"}}>{match.extras[inn]}</b></span>
                    <span style={{color:SP.textDim,fontSize:11,marginLeft:8}}>W:{match.extrasBreakdown[inn].wide} NB:{match.extrasBreakdown[inn].noBall} B:{match.extrasBreakdown[inn].bye} LB:{match.extrasBreakdown[inn].legBye}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={{width:"100%",borderCollapse:"collapse",borderTop:"2px solid rgba(73,72,71,.35)"}}>
              <thead><tr>{["Bowler","O","M","R","W","Eco"].map(h=><th key={h} style={{padding:"5px 7px",color:SP.textDim,fontSize:11,textAlign:h==="Bowler"?"left":"center",fontWeight:"normal"}}>{h}</th>)}</tr></thead>
              <tbody>
                {opp.bowlers.filter(b=>b.overs>0||b.balls>0).map((b,i)=>(
                  <tr key={i} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"7px 8px",color:"#fff",fontSize:13,minWidth:110}}>{b.name}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.overs}.{b.balls}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.maidens}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:13,padding:"7px 4px"}}>{b.runs}</td>
                    <td style={{textAlign:"center",color:SP.tertiary,fontWeight:"bold",fontSize:14,padding:"7px 4px"}}>{b.wickets}</td>
                    <td style={{textAlign:"center",color:SP.textSec,fontSize:12,padding:"7px 4px"}}>{ecoFn(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap,padding:"0 12px"}}>
          <div style={{...S.topBar,position:"static",padding:"12px 16px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>setScreen(prev)} style={{background:"none",border:"none",color:SP.textSec,fontSize:18,cursor:"pointer",padding:0}}>←</button>
              <span style={{color:"#fff",fontSize:15,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif"}}>Scorecard</span>
            </div>
          </div>
          <TCard team={match.teamA} inn={0} opp={match.teamB}/>
          {(match.batting===1||match.inningsOver[0])&&<TCard team={match.teamB} inn={1} opp={match.teamA}/>}
          {match.matchCode&&match.matchCode!=="LOCAL"&&(
            <MatchMediaGallery matchCode={match.matchCode} currentUser={currentUser}/>
          )}
        </div>
            <nav style={S.bottomNav}>
        {[
          {icon:"🏠",label:"Home",tab:"home"},
          {icon:"📡",label:"Live",tab:"live"},
          {icon:"📚",label:"History",tab:"history"},
          {icon:"👤",label:"Profile",tab:"profile"},
        ].map(({icon,label,tab})=>(
          <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
            style={{...S.navItem,color:SP.textDim}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
          </div>
        ))}
      </nav>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // SCORER / MATCH SCREEN
  return (
    <div style={S.page}>
      <EditModal editing={editing} editVal={editVal} setEditVal={setEditVal} onCommit={commitEdit} onCancel={cancelEdit}/>
      <PendingExtraModal extra={pendingExtra} onConfirm={confirmExtra} onCancel={()=>setPendingExtra(null)}/>
      {overComplete && <OverCompleteModal match={match} onSelect={selectNewBowler} isFirstBall={match&&match.teamA&&match.teamB&&(match.batting===0?match.teamB:match.teamA).bowlers.length===0}/>}
      {needsOpeners && !nextBatterPick && <OpeningBatsmenModal match={match} onSelect={selectOpeners}/>}
      {nextBatterPick && <NextBatterModal match={match} onSelect={selectNextBatter}/>}
      {recallPrompt && <RecallPromptModal match={match} onRecall={recallRetired} onDecline={declineRecall}/>}
      <ReplaceBatterModal/>
	  <ReplaceBowlerModal/>
      <div style={S.wrap}>

        {/* Toast */}
        {scorerToast ? (
          <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:SP.bg3,border:"1px solid rgba(156,255,147,.3)",borderRadius:999,padding:"10px 20px",color:SP.primary,fontSize:12,fontWeight:"700",fontFamily:"Lexend,Georgia,sans-serif",zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,.6)",whiteSpace:"nowrap",letterSpacing:.5}}>
            🏏 {scorerToast}
          </div>
        ) : null}

        {/* Scorer identity banner */}
        <div style={{background:SP.bg2,borderBottom:"1px solid "+SP.bg3,padding:"7px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{color:SP.textSec,fontSize:12,fontFamily:"Lexend,Georgia,sans-serif"}}>🏏 Scoring: <b style={{color:"#fff"}}>{match.scorerName || (currentUser&&(currentUser.displayName||currentUser.email)) || "You"}</b>
            {syncing&&<span style={{color:SP.secondary,fontSize:10,marginLeft:6}}>↑</span>}
          </span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={undo} disabled={!history.length}
              style={{...S.btnSm,opacity:history.length?1:0.3,color:"#fb923c",borderColor:history.length?"rgba(251,146,60,.3)":"transparent",padding:"4px 10px",fontSize:11}}>
              ↩ Undo
            </button>
            <button onClick={()=>setScreen("scorecard")} style={{...S.btnSm,padding:"4px 10px",fontSize:11}}>📋</button>
            {match&&match.matchCode&&match.matchCode!=="LOCAL"&&(
              <button onClick={()=>handOffScoring(match)}
                style={{...S.btnSm,color:SP.textDim,padding:"4px 10px",fontSize:11}}>
                ↪ Hand Off
              </button>
            )}
            <button onClick={resetAll} style={{...S.btnSm,padding:"4px 10px",fontSize:11}}>🔄</button>
          </div>
        </div>

        {/* Handover approval banner */}
        {match&&match.scorerRequest&&currentUser&&match.scorerRequest.uid!==currentUser.uid && (
          <div style={{margin:"10px 12px 0",background:"rgba(156,255,147,.06)",border:"1px solid rgba(251,191,36,.4)",borderRadius:10,padding:"12px 16px"}}>
            <div style={{color:SP.primary,fontSize:13,fontWeight:"bold",marginBottom:8}}>
              ✋ {match.scorerRequest.name} wants to score
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>approveHandover(match, match.scorerRequest)}
                style={{flex:1,padding:"9px 0",background:"linear-gradient(135deg,#4ade80,#16a34a)",border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                ✓ Approve
              </button>
              <button onClick={()=>declineHandover(match)}
                style={{flex:1,padding:"9px 0",background:"transparent",border:"1px solid #ef4444",borderRadius:10,color:SP.tertiary,fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                ✗ Decline
              </button>
            </div>
          </div>
        )}

        <ScoreHeader/>

        <div style={{padding:"0 12px"}}>
          <BatterCard editable={true}/>
          <BowlerCard editable={true}/>
          <BallLog/>
        </div>

        {/* Innings done */}
        {match.inningsOver[0]&&bt===0&&(
          <div style={{margin:"0 12px 12px",background:"rgba(156,255,147,.08)",borderRadius:10,padding:20,textAlign:"center",border:"1px solid rgba(156,255,147,.2)"}}>
            <div style={{color:SP.primary,fontWeight:"bold",fontSize:16,marginBottom:6}}>Innings Complete!</div>
            <div style={{color:"#fff",fontSize:14,marginBottom:14}}>{match.teamA.name}: {match.runs[0]}/{match.wickets[0]}</div>
            <button onClick={()=>setMatch(m=>{
              var m2 = JSON.parse(JSON.stringify(m));
              m2.batting = 1;
              m2.striker = 0;
              m2.currentBatsmen = [0,1];
              m2.currentBowler = 0;
              m2.needsBowler = true; // must pick first bowler of 2nd innings
              // In 2nd innings (batting=1), teamB is bowling — clear their bowlers for fresh start
              m2.teamB.bowlers = [];
              // Also reset currentBowler
              m2.currentBowler = 0;
              return m2;
            })}
              style={{background:SP.primary,color:"#00440a",border:"none",borderRadius:8,padding:"12px 28px",fontWeight:"800",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:1}}>
              Start 2nd Innings →
            </button>
          </div>
        )}

        {/* Match over */}
        {match.inningsOver[1]&&bt===1&&(
          <div style={{margin:"0 12px 12px",background:SP.bg3,borderRadius:10,padding:20,textAlign:"center",border:"1px solid rgba(102,157,255,.2)"}}>
            <div style={{fontSize:30,marginBottom:6}}>🏆</div>
            <div style={{color:SP.primary,fontWeight:"bold",fontSize:18,marginBottom:6}}>Match Over!</div>
            {match.runs[1]>match.runs[0]?<div style={{color:SP.primary,fontSize:14}}>{match.teamB.name} wins by {10-match.wickets[1]} wickets!</div>
             :match.runs[1]<match.runs[0]?<div style={{color:SP.tertiary,fontSize:14}}>{match.teamA.name} wins by {match.runs[0]-match.runs[1]} runs!</div>
             :<div style={{color:SP.primary,fontSize:14}}>Match Tied!</div>}
            <button onClick={()=>{saveToHistory(match);resetAll();}}
              style={{marginTop:14,padding:"10px 24px",background:"#fbbf24",color:"#0f172a",border:"none",borderRadius:10,fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:6}}>
                {[0,1,2,3,4,5,6].map(r=>(
                  <button key={r} onClick={()=>addRuns(r)}
                    style={{padding:"14px 0",borderRadius:10,border:"none",
                      background:r===6?"rgba(156,255,147,.15)":r===4?"rgba(102,157,255,.15)":SP.bg4,
                      color:r===6?SP.primary:r===4?SP.secondary:"#fff",
                      fontWeight:"bold",fontSize:18,cursor:"pointer",touchAction:"manipulation",
                      fontFamily:"Lexend,Georgia,sans-serif",
                      boxShadow:r===6?"0 0 12px rgba(156,255,147,.15)":r===4?"0 0 12px rgba(102,157,255,.12)":"none"}}>
                    {r}
                  </button>
                ))}
              </div>
              {/* 1 Declared — adds 1 run, no strike rotation */}
              <button onClick={()=>addRuns(1, null, true)}
                style={{width:"100%",padding:"10px 0",borderRadius:10,border:"1px solid rgba(14,116,144,.4)",
                  background:"rgba(8,145,178,.12)",color:"#67e8f9",fontWeight:"bold",fontSize:13,
                  cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif",
                  letterSpacing:1}}>
                1D &nbsp;<span style={{color:"rgba(103,232,249,.6)",fontSize:11,fontWeight:"normal"}}>Declared — no strike change</span>
              </button>
            </div>

            {/* EXTRAS */}
            <div style={S.card}>
              <div style={S.lbl}>EXTRAS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                {["Wide","No Ball"].map(ex=>(
                  <button key={ex} onClick={()=>setPendingExtra(ex)}
                    style={{padding:"12px 0",borderRadius:10,border:"none",background:"rgba(167,139,250,.15)",color:"#c4b5fd",fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif"}}>
                    {ex} ›
                  </button>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {["Bye","Leg Bye"].map(ex=>(
                  <button key={ex} onClick={()=>addRuns(1,ex)}
                    style={{padding:"12px 0",borderRadius:10,border:"none",background:SP.bg4,color:SP.textSec,fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif"}}>
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
                    style={{padding:"12px 0",borderRadius:10,border:"none",background:"rgba(255,112,114,.12)",color:SP.tertiary,fontWeight:"bold",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif"}}>
                    {how}
                  </button>
                ))}
                <button onClick={()=>addWicket(RET_HURT)}
                  style={{padding:"13px 0",borderRadius:10,border:"none",background:"rgba(8,145,178,.15)",color:"#67e8f9",fontWeight:"bold",fontSize:13,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif",gridColumn:"span 3",marginTop:4}}>
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
                        style={{padding:"10px 14px",borderRadius:10,border:"1px solid #0e7490",background:"rgba(8,145,178,.1)",color:"#67e8f9",fontWeight:"bold",fontSize:13,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
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
                <span style={{color:SP.textDim,fontSize:10}}>✏ tap name to edit</span>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {wTeam.bowlers.map((b,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:0}}>
                    <button onClick={()=>setMatch(m=>({...m,currentBowler:i}))}
                      style={{padding:"8px 10px",borderRadius:"8px 0 0 8px",border:match.currentBowler===i?"2px solid #fbbf24":"1px solid rgba(73,72,71,.25)",borderRight:"none",background:match.currentBowler===i?"rgba(251,191,36,.12)":"#0f172a",color:match.currentBowler===i?"#fbbf24":"#64748b",fontSize:12,cursor:"pointer",touchAction:"manipulation",fontFamily:"Lexend,Georgia,sans-serif"}}>
                      {b.name}
                    </button>
                    <button onClick={()=>startEdit(wTeamKey,"bowler",i,b.name)}
                      title="Edit name"
                      style={{padding:"8px 7px",borderRadius:"0 8px 8px 0",border:match.currentBowler===i?"2px solid #fbbf24":"1px solid rgba(73,72,71,.25)",borderLeft:"1px solid rgba(73,72,71,.25)",background:match.currentBowler===i?"rgba(251,191,36,.08)":"#0f172a",color:SP.textDim,fontSize:11,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                      ✏
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* END INNINGS */}
            <div style={{marginTop:4,marginBottom:8}}>
              <button onClick={()=>{if(confirm("End innings now?"))setMatch(m=>{var n={...m};n.inningsOver=[...m.inningsOver];n.inningsOver[m.batting]=true;return n;})}}
                style={{width:"100%",padding:"11px 0",borderRadius:12,border:"1px solid #475569",background:"transparent",color:SP.textDim,fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",letterSpacing:1}}>
                ⏹ End Innings
              </button>
            </div>

          </div>
        )}
      </div>
      <nav style={S.bottomNav}>
        {[
          {icon:"🏠",label:"Home",tab:"home"},
          {icon:"📡",label:"Live",tab:"live"},
          {icon:"📚",label:"History",tab:"history"},
          {icon:"👤",label:"Profile",tab:"profile"},
        ].map(({icon,label,tab})=>(
          <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
            style={{...S.navItem,color:SP.textDim}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PLAYER & TEAM MANAGEMENT COMPONENTS
// ════════════════════════════════════════════════════════════

// ── PlayerStatsCard ── compact list row, expands to full stats on click ──
function PlayerStatsCard({ p, onClick }) {
  var bat = p.batting || {};
  var bowl = p.bowling || {};
  var avg = bat.innings > 0 ? (bat.runs / Math.max(bat.outs,1)).toFixed(1) : "-";
  var sr  = bat.balls  > 0 ? ((bat.runs / bat.balls)*100).toFixed(1) : "-";
  var eco = (bowl.overs + (bowl.balls||0)/6) > 0 ? (bowl.runs / (bowl.overs + (bowl.balls||0)/6)).toFixed(2) : "-";
  var age = null;
  if (p.dob) { var diff = Date.now() - new Date(p.dob).getTime(); age = Math.floor(diff/(365.25*24*3600*1000)); }

  // Compact row — just name, role, key numbers
  return (
    <div onClick={onClick} style={{background:SP.bg3,borderRadius:12,padding:"12px 16px",marginBottom:8,border:"1px solid rgba(73,72,71,.25)",cursor:onClick?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
        {p.photoUrl
          ? <img src={p.photoUrl} alt={p.name} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",flexShrink:0,border:"1px solid rgba(73,72,71,.3)"}}/>
          : <div style={{width:36,height:36,borderRadius:"50%",background:SP.primary,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:"bold",color:"#0f172a",flexShrink:0}}>
              {p.name[0].toUpperCase()}
            </div>
        }
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"#fff",fontSize:14,fontWeight:"bold",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
          <div style={{display:"flex",gap:6,marginTop:2,flexWrap:"wrap"}}>
            {p.role && <span style={{color:SP.textDim,fontSize:11}}>{p.role}</span>}
            {age && <span style={{color:SP.textDim,fontSize:11}}>· Age {age}</span>}
            {p.uid && <span style={{color:SP.primary,fontSize:11}}>· ✓</span>}
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center",flexShrink:0}}>
        <div style={{textAlign:"center"}}>
          <div style={{color:SP.primary,fontSize:13,fontWeight:"bold"}}>{bat.runs||0}</div>
          <div style={{color:SP.textDim,fontSize:10}}>runs</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{color:"#a78bfa",fontSize:13,fontWeight:"bold"}}>{bowl.wickets||0}</div>
          <div style={{color:SP.textDim,fontSize:10}}>wkts</div>
        </div>
        <div style={{color:"#334155",fontSize:16}}>›</div>
      </div>
    </div>
  );
}

// ── PlayerFullStats ── full stats panel shown in detail view ──
function PlayerFullStats({ p }) {
  var bat = p.batting || {};
  var bowl = p.bowling || {};
  var avg = bat.innings > 0 ? (bat.runs / Math.max(bat.outs,1)).toFixed(1) : "-";
  var sr  = bat.balls  > 0 ? ((bat.runs / bat.balls)*100).toFixed(1) : "-";
  var eco = (bowl.overs + (bowl.balls||0)/6) > 0 ? (bowl.runs / (bowl.overs + (bowl.balls||0)/6)).toFixed(2) : "-";
  var age = null;
  if (p.dob) { var diff = Date.now() - new Date(p.dob).getTime(); age = Math.floor(diff/(365.25*24*3600*1000)); }
  return (
    <div style={{background:SP.bg3,borderRadius:10,padding:"16px",border:"1px solid rgba(73,72,71,.25)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{color:"#fff",fontSize:17,fontWeight:"bold"}}>{p.name}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
            {p.role && <span style={{color:SP.textDim,fontSize:11}}>{p.role}</span>}
            {p.batStyle && <span style={{color:SP.textDim,fontSize:11}}>· {p.batStyle} bat</span>}
            {p.bowlStyle && p.bowlStyle!=="N/A" && <span style={{color:SP.textDim,fontSize:11}}>· {p.bowlStyle}</span>}
            {age && <span style={{color:SP.textDim,fontSize:11}}>· Age {age}</span>}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.2)",borderRadius:8,padding:"2px 8px",color:SP.primary,fontSize:10}}>{bat.matches||0} matches</div>
          {p.uid && <div style={{background:"rgba(74,222,128,.08)",border:"1px solid rgba(74,222,128,.2)",borderRadius:8,padding:"2px 8px",color:SP.primary,fontSize:10}}>✓ Registered</div>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{background:SP.bg,borderRadius:10,padding:"10px 12px"}}>
          <div style={{color:SP.textDim,fontSize:10,letterSpacing:1,marginBottom:6}}>BATTING</div>
          {[["Matches",bat.matches||0],["Innings",bat.innings||0],["Runs",bat.runs||0,"#fbbf24"],["Avg",avg],["SR",sr],["50s/100s",(bat.fifties||0)+"/"+(bat.hundreds||0)],["HS",bat.highScore||0]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{color:SP.textSec,fontSize:11}}>{l}</span>
              <span style={{color:c||"#e2e8f0",fontSize:12,fontWeight:c?"bold":"normal"}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{background:SP.bg,borderRadius:10,padding:"10px 12px"}}>
          <div style={{color:SP.textDim,fontSize:10,letterSpacing:1,marginBottom:6}}>BOWLING</div>
          {[["Wickets",bowl.wickets||0,"#a78bfa"],["Econ",eco],["Runs",bowl.runs||0],["Overs",bowl.overs||0],["Maidens",bowl.maidens||0],["Best",(bowl.bestWickets||0)+"/"+(bowl.bestRuns===999||!bowl.bestRuns?0:bowl.bestRuns)]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{color:SP.textSec,fontSize:11}}>{l}</span>
              <span style={{color:c||"#e2e8f0",fontSize:12,fontWeight:c?"bold":"normal"}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── PlayersScreen — view/edit players ────────────────────────
function PlayersScreen({ currentUser, isAdmin, onBack, initialPlayerId, setScreen, setHomeTab }) {
  const ROLES       = ["Batsman","Bowler","All-rounder","Wicket-keeper"];
  const BAT_STYLES  = ["Right-hand","Left-hand"];
  const BOWL_STYLES = ["Right-arm Fast","Right-arm Medium","Right-arm Off-spin","Left-arm Fast","Left-arm Medium","Left-arm Spin","N/A"];

  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view,    setView]    = React.useState("list"); // list | detail | edit | add
  const [sel,     setSel]     = React.useState(null);
  const [editForm,setEditForm]= React.useState({});
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState("");
  const [search,  setSearch]  = React.useState("");
  const [users,   setUsers]   = React.useState([]); // all registered users, admin only

  React.useEffect(() => {
    loadPlayers(initialPlayerId);
    if (isAdmin && _fbDB) {
      _fbDB.ref("users").once("value", snap => {
        var val = snap.val() || {};
        // Inject the Firebase key as uid on each user record (uid is the key, not stored in the record)
        var list = Object.entries(val)
          .filter(([,u])=>u&&u.name)
          .map(([uid,u])=>({...u, uid}));
        setUsers(list);
      });
    }
  }, []);

  function loadPlayers(autoOpenId) {
    if (!_fbDB) return;
    setLoading(true);
    _fbDB.ref("players").once("value", snap => {
      var val = snap.val() || {};
      var list = Object.values(val).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
      setPlayers(list);
      setLoading(false);
      if (autoOpenId) {
        // Search by player id first, then by linked uid
        var found = list.find(p => p.id === autoOpenId) || list.find(p => p.uid === autoOpenId || p.createdBy === autoOpenId);
        if (found) { setSel(found); setView("detail"); }
        else { setView("list"); } // no profile yet — show list so they can add one
      }
    }, () => setLoading(false));
  }



  function canEdit(p) {
    if (!currentUser) return false;
    if (isAdmin) return true;
    if (p.uid && p.uid === currentUser.uid) return true;
    if (p.createdBy && p.createdBy === currentUser.uid) return true;
    return false;
  }

  function deletePlayer(p) {
    if (!confirm(`Delete ${p.name}? This cannot be undone.`)) return;
    if (_fbDB) _fbDB.ref("players/"+p.id).remove();
    setPlayers(ps => ps.filter(x => x.id !== p.id));
    setView("list"); setSel(null);
  }

  function openEdit(p) {
    // Find linked user name if any
    var linkedUser = p.uid ? users.find(u=>u.uid===p.uid||Object.keys(u).some(k=>u.uid===p.uid)) : null;
    var linkedName = "";
    if (p.uid && users.length) {
      var lu = users.find(u=>u.uid===p.uid);
      if (lu) linkedName = lu.name||lu.email||p.uid;
    }
    setEditForm({
      name: p.name||"", role: p.role||"Batsman",
      batStyle: p.batStyle||"Right-hand", bowlStyle: p.bowlStyle||"Right-arm Medium",
      dob: p.dob||"",
      linkedUid: p.uid||"", linkedName,
    });
    setSel(p); setErr(""); setView("edit");
  }

  function saveEdit() {
    if (!editForm.name.trim()) return setErr("Name is required");
    setSaving(true); setErr("");
    // Only update non-stats fields — never touch batting/bowling objects
    var updates = {
      name: editForm.name.trim(),
      role: editForm.role,
      batStyle: editForm.batStyle,
      bowlStyle: editForm.bowlStyle,
      dob: editForm.dob || null,
    };
    _fbDB.ref("players/"+sel.id).update(updates).then(() => {
      var updated = {...sel, ...updates};
      setPlayers(ps => ps.map(p => p.id===sel.id ? updated : p).sort((a,b)=>a.name.localeCompare(b.name)));
      setSel(updated); setSaving(false); setView("detail");
    }).catch(e => { setErr(e.message); setSaving(false); });
  }

  function linkUser(playerId, uid, userName) {
    if (!_fbDB) return;
    // Write uid onto player record
    _fbDB.ref("players/"+playerId+"/uid").set(uid);
    // Add to user's playerIds array; also set playerId if not already set (primary)
    _fbDB.ref("users/"+uid).once("value", snap => {
      var rec = snap.val() || {};
      var existing = Array.isArray(rec.playerIds) ? rec.playerIds : (rec.playerId ? [rec.playerId] : []);
      if (!existing.includes(playerId)) {
        var updated2 = { playerIds: [...existing, playerId] };
        if (!rec.playerId) updated2.playerId = playerId; // set primary if none
        _fbDB.ref("users/"+uid).update(updated2);
      }
    });
    // Update local state
    var updated = {...sel, uid};
    setPlayers(ps => ps.map(p => p.id===playerId ? updated : p));
    setSel(updated);
    setEditForm(f => ({...f, linkedUid: uid, linkedName: userName}));
  }

  function unlinkUser(playerId) {
    if (!_fbDB || !sel.uid) return;
    var prevUid = sel.uid;
    _fbDB.ref("players/"+playerId+"/uid").remove();
    // Remove from user's playerIds array; also clear playerId if it matches
    _fbDB.ref("users/"+prevUid).once("value", snap => {
      var rec = snap.val() || {};
      var existing = Array.isArray(rec.playerIds) ? rec.playerIds : (rec.playerId ? [rec.playerId] : []);
      var newIds = existing.filter(id => id !== playerId);
      var updates = { playerIds: newIds.length ? newIds : null };
      // If primary playerId matched, update to next in list or remove
      if (rec.playerId === playerId) updates.playerId = newIds[0] || null;
      _fbDB.ref("users/"+prevUid).update(updates);
      // Reload users
      _fbDB.ref("users").once("value", s2 => {
        var val = s2.val() || {};
        setUsers(Object.entries(val).filter(([,u])=>u&&u.name).map(([uid,u])=>({...u,uid})));
      });
    });
    var updated = {...sel, uid: null};
    setPlayers(ps => ps.map(p => p.id===playerId ? updated : p));
    setSel(updated);
    setEditForm(f => ({...f, linkedUid: "", linkedName: ""}));
  }

  function saveNewPlayer() {
    if (!editForm.name.trim()) return setErr("Name is required");
    if (!currentUser) return setErr("You must be logged in to add a player");
    setSaving(true); setErr("");
    var id = "P_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    var p = {
      id, name: editForm.name.trim(), role: editForm.role||"Batsman",
      batStyle: editForm.batStyle||"Right-hand", bowlStyle: editForm.bowlStyle||"Right-arm Medium",
      dob: editForm.dob||null,
      uid: currentUser.uid,
      createdBy: currentUser.uid,
      createdAt: Date.now(),
      batting:  { matches:0, innings:0, runs:0, balls:0, outs:0, fours:0, sixes:0, highScore:0, fifties:0, hundreds:0 },
      bowling:  { overs:0, balls:0, runs:0, wickets:0, maidens:0, bestWickets:0, bestRuns:999 },
    };
    var writes = [_fbDB.ref("players/"+id).set(p)];
    // Write to playerIds array; set playerId as primary if first
    writes.push(
      _fbDB.ref("users/"+currentUser.uid).once("value").then(snap => {
        var rec = snap.val() || {};
        var existing = Array.isArray(rec.playerIds) ? rec.playerIds : (rec.playerId ? [rec.playerId] : []);
        if (!existing.includes(id)) {
          var updates = { playerIds: [...existing, id] };
          if (!rec.playerId) updates.playerId = id;
          return _fbDB.ref("users/"+currentUser.uid).update(updates);
        }
      })
    );
    Promise.all(writes).then(() => {
      setPlayers(ps => [...ps, p].sort((a,b)=>a.name.localeCompare(b.name)));
      setSel(p); setView("detail"); setSaving(false);
    }).catch(e => { setErr(e.message); setSaving(false); });
  }

  var filtered = players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  var inSt = {width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"12px 14px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif"};

  // ── No profile linked ──
  if (view==="noprofile") {
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={S.btnSm}>← Back</button>
            <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>MY PLAYER PROFILE</h2>
          </div>
          <div style={{background:SP.bg3,borderRadius:12,padding:"40px 24px",textAlign:"center",border:"1px solid rgba(73,72,71,.25)",marginTop:20}}>
            <div style={{fontSize:48,marginBottom:16}}>🏏</div>
            <div style={{color:"#fff",fontSize:16,fontWeight:"700",marginBottom:8,fontFamily:"Lexend,Georgia,sans-serif"}}>No Player Profile Yet</div>
            <div style={{color:SP.textDim,fontSize:13,marginBottom:24,lineHeight:1.6}}>
              Create your player profile to track your stats across matches.
            </div>
            {currentUser && (
              <button onClick={()=>{setEditForm({name:"",role:"Batsman",batStyle:"Right-hand",bowlStyle:"Right-arm Medium",dob:""});setView("add");}}
                style={{padding:"13px 28px",background:SP.primary,border:"none",borderRadius:12,color:"#0f172a",fontWeight:"bold",fontSize:14,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                + Create My Profile
              </button>
            )}
          </div>
        </div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:tab==="history"?SP.secondary:SP.textDim,background:tab==="history"?"rgba(102,157,255,.1)":"transparent"}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // ── Edit / Add form ──
  if (view==="edit" || view==="add") {
    var isAdd = view==="add";
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>{setView(isAdd?"list":"detail");setErr("");}} style={S.btnSm}>← Back</button>
            <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>{isAdd?"ADD PLAYER":"EDIT PROFILE"}</h2>
          </div>
          <div style={{background:SP.bg3,borderRadius:12,padding:20,border:"1px solid rgba(73,72,71,.25)",marginBottom:14}}>
            <div style={{marginBottom:12}}>
              <label style={{...S.lbl,display:"block",marginBottom:6}}>PLAYER NAME</label>
              <input value={editForm.name||""} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Rohit Sharma" style={inSt} autoFocus/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{color:SP.textDim,fontSize:11,letterSpacing:1,display:"block",marginBottom:8}}>ROLE</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {ROLES.map(r=>(
                  <button key={r} onClick={()=>setEditForm(f=>({...f,role:r}))}
                    style={{padding:"7px 12px",borderRadius:9,border:(editForm.role||"Batsman")===r?"1px solid #fbbf24":"1px solid rgba(73,72,71,.25)",background:(editForm.role||"Batsman")===r?"rgba(251,191,36,.1)":"transparent",color:(editForm.role||"Batsman")===r?"#fbbf24":"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>BATTING</label>
                <select value={editForm.batStyle||"Right-hand"} onChange={e=>setEditForm(f=>({...f,batStyle:e.target.value}))}
                  style={{...inSt,padding:"10px 10px"}}>
                  {BAT_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{...S.lbl,display:"block",marginBottom:6}}>BOWLING</label>
                <select value={editForm.bowlStyle||"Right-arm Medium"} onChange={e=>setEditForm(f=>({...f,bowlStyle:e.target.value}))}
                  style={{...inSt,padding:"10px 10px"}}>
                  {BOWL_STYLES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{marginBottom:6}}>
              <label style={{...S.lbl,display:"block",marginBottom:6}}>DATE OF BIRTH <span style={{color:"#334155"}}>(optional)</span></label>
              <input value={editForm.dob||""} onChange={e=>setEditForm(f=>({...f,dob:e.target.value}))} type="date" style={{...inSt,colorScheme:"dark"}}/>
            </div>
          </div>
          {!isAdd && isAdmin && (
            <div style={{background:"rgba(102,157,255,.06)",border:"1px solid rgba(102,157,255,.2)",borderRadius:10,padding:"14px",marginBottom:14}}>
              <div style={{...S.lbl,marginBottom:10,color:SP.secondary}}>🔗 LINK USER ACCOUNT</div>
              {/* Show currently linked user (if any) with unlink button */}
              {sel.uid && (()=>{
                var lu = users.find(u=>u.uid===sel.uid);
                var displayName = lu ? (lu.name||lu.email) : (editForm.linkedName||sel.uid);
                return (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"rgba(156,255,147,.06)",borderRadius:8,marginBottom:10,border:"1px solid rgba(156,255,147,.15)"}}>
                    <div>
                      <div style={{color:"#fff",fontSize:13,fontWeight:"700"}}>{displayName}</div>
                      {lu&&lu.email&&<div style={{color:SP.textDim,fontSize:11}}>{lu.email}</div>}
                      <div style={{color:SP.primary,fontSize:11,marginTop:2}}>✓ Currently linked</div>
                    </div>
                    <button onClick={()=>unlinkUser(sel.id)}
                      style={{padding:"6px 12px",background:"transparent",border:"1px solid rgba(255,112,114,.3)",borderRadius:8,color:SP.tertiary,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                      Unlink
                    </button>
                  </div>
                );
              })()}
              {/* User list — all users can be linked; already-linked-to-this-player shown as linked */}
              {users.filter(u=>u.uid).length===0 ? (
                <div style={{color:SP.textDim,fontSize:12}}>No registered users found.</div>
              ) : (
                <div>
                  <div style={{color:SP.textDim,fontSize:12,marginBottom:8}}>
                    {sel.uid ? "Link additional user accounts:" : "Associate this player with a user account:"}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
                    {users.filter(u=>u.uid&&u.name).sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(u=>{
                      var isLinkedToThis = sel.uid === u.uid;
                      return (
                        <div key={u.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:isLinkedToThis?"rgba(156,255,147,.06)":SP.bg4,borderRadius:8,border:isLinkedToThis?"1px solid rgba(156,255,147,.15)":"none"}}>
                          <div>
                            <div style={{color:"#fff",fontSize:13}}>{u.name}</div>
                            <div style={{color:SP.textDim,fontSize:11}}>{u.email}</div>
                            {isLinkedToThis&&<div style={{color:SP.primary,fontSize:10,marginTop:2}}>✓ Linked to this player</div>}
                          </div>
                          {isLinkedToThis ? (
                            <button onClick={()=>unlinkUser(sel.id)}
                              style={{padding:"5px 12px",background:"transparent",border:"1px solid rgba(255,112,114,.3)",borderRadius:8,color:SP.tertiary,fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                              Unlink
                            </button>
                          ) : (
                            <button onClick={()=>linkUser(sel.id,u.uid,u.name)}
                              style={{padding:"5px 12px",background:SP.secondary,border:"none",borderRadius:8,color:"#001f49",fontSize:12,fontWeight:"700",cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                              Link
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {!isAdmin && !isAdd && (
            <div style={{background:"rgba(156,255,147,.06)",border:"1px solid rgba(156,255,147,.15)",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
              <div style={{color:SP.primary,fontSize:11}}>✓ This player will be linked to your account — you'll be able to edit their profile and they'll show as your registered player.</div>
            </div>
          )}
          <div style={{background:"rgba(251,191,36,.06)",border:"1px solid rgba(251,191,36,.15)",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
            <div style={{color:SP.textDim,fontSize:11}}>🔒 Stats (matches, runs, wickets etc.) are updated automatically from match scorecards and cannot be edited manually.</div>
          </div>
          {err&&<div style={{color:"#ff716c",fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,border:"1px solid rgba(255,113,108,.2)"}}>{err}</div>}
          <button onClick={isAdd?saveNewPlayer:saveEdit} disabled={saving}
            style={{width:"100%",padding:"13px 0",background:SP.primary,borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            {saving?"Saving…":isAdd?"Register Player":"Save Changes"}
          </button>
        </div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen&&setScreen("history");else{setHomeTab&&setHomeTab(tab);setScreen&&setScreen("home");}}}
              style={{...S.navItem,color:SP.textDim}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // ── Detail view ──
  if (view==="detail" && sel) {
    var editable = canEdit(sel);
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <button onClick={()=>setView("list")} style={S.btnSm}>← Back</button>
              <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>PLAYER PROFILE</h2>
            </div>
            <div style={{display:"flex",gap:8}}>
              {editable && (
                <button onClick={()=>openEdit(sel)}
                  style={{padding:"7px 14px",background:"transparent",border:"1px solid #fbbf24",borderRadius:10,color:SP.primary,fontWeight:"bold",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                  ✏️ Edit
                </button>
              )}
              {(editable || isAdmin) && (
                <button onClick={()=>deletePlayer(sel)}
                  style={{padding:"7px 14px",background:"transparent",border:"1px solid #ef4444",borderRadius:10,color:SP.tertiary,fontWeight:"bold",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                  🗑️ Delete
                </button>
              )}
            </div>
          </div>
          <div style={{background:SP.bg3,borderRadius:12,padding:22,border:"1px solid rgba(73,72,71,.25)",textAlign:"center",marginBottom:14}}>
            <PlayerPhotoUpload
              player={sel}
              currentUser={currentUser}
              editable={editable}
              onPhotoSaved={url=>{
                var updated = {...sel, photoUrl:url};
                setSel(updated);
                setPlayers(ps=>ps.map(p=>p.id===sel.id?updated:p));
              }}
            />
            <div style={{color:"#fff",fontSize:20,fontWeight:"bold"}}>{sel.name}</div>
            <div style={{color:SP.textDim,fontSize:12,marginTop:4}}>{sel.role}{sel.batStyle?` · ${sel.batStyle} bat`:""}{sel.bowlStyle&&sel.bowlStyle!=="N/A"?` · ${sel.bowlStyle}`:""}</div>
            {sel.uid && <div style={{color:SP.primary,fontSize:11,marginTop:6}}>✓ Registered account</div>}
          </div>
          <PlayerFullStats p={sel} />
        </div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:tab==="history"?SP.secondary:SP.textDim,background:tab==="history"?"rgba(102,157,255,.1)":"transparent"}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // ── List view ──
  return (
    <div style={{...S.page,paddingBottom:88}}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={S.btnSm}>← Back</button>
            <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>🏏 PLAYERS</h2>
          </div>
          {currentUser && (
            <button onClick={()=>{setEditForm({name:"",role:"Batsman",batStyle:"Right-hand",bowlStyle:"Right-arm Medium",dob:""});setView("add");}}
              style={{padding:"7px 14px",background:SP.primary,border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              + Add Player
            </button>
          )}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players…"
          style={{width:"100%",background:SP.bg3,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:14}}/>
        {loading && <div style={{color:SP.textDim,textAlign:"center",padding:40}}>Loading…</div>}
        {!loading && filtered.length===0 && (
          <div style={{color:SP.textDim,textAlign:"center",padding:40,lineHeight:1.8}}>
            No players yet.<br/>
            <span style={{fontSize:12}}>{currentUser ? "Tap \"+ Add Player\" above to add the first one." : "Log in to add players."}</span>
          </div>
        )}
        {filtered.map(p=>(
          <PlayerStatsCard key={p.id} p={p} onClick={()=>{setSel(p);setView("detail");}}/>
        ))}
      </div>
      <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:tab==="Profile"?SP.secondary:SP.textDim,background:tab==="Profile"?"rgba(102,157,255,.1)":"transparent"}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
    </div>
  );
}

// ── TeamsScreen — create/manage teams ────────────────────────
// ── QuickAddPlayer — inline new player form for use inside team create/edit ──
function QuickAddPlayer({currentUser, onAdded}) {
  const [open,    setOpen]    = React.useState(false);
  const [name,    setName]    = React.useState("");
  const [role,    setRole]    = React.useState("Batsman");
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState("");

  async function save() {
    var nm = name.trim();
    if (!nm) return setErr("Name is required");
    setSaving(true); setErr("");
    try {
      var now = Date.now();
      var pid = "P_" + now + "_" + Math.random().toString(36).slice(2,6);
      var p = {
        id: pid, name: nm, role,
        batStyle:"Right-hand", bowlStyle:"Right-arm Medium", dob:null,
        createdBy: currentUser ? currentUser.uid : null, createdAt: now,
        batting:  {matches:0,innings:0,runs:0,balls:0,outs:0,fours:0,sixes:0,highScore:0,fifties:0,hundreds:0},
        bowling:  {overs:0,balls:0,runs:0,wickets:0,maidens:0,bestWickets:0,bestRuns:999},
      };
      if (_fbDB) await _fbDB.ref("players/"+pid).set(p);
      onAdded(p);
      setName(""); setRole("Batsman"); setOpen(false);
    } catch(e) { setErr(e.message||"Error saving"); }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={()=>setOpen(true)}
      style={{width:"100%",padding:"9px 0",marginBottom:4,borderRadius:10,border:"1px dashed #334155",background:"transparent",color:SP.primary,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
      <span style={{fontSize:16}}>⊕</span> Add New Player
    </button>
  );

  return (
    <div style={{background:SP.bg,border:"1px solid #22c55e",borderRadius:12,padding:"14px 14px",marginBottom:8}}>
      <div style={{color:SP.primary,fontSize:11,letterSpacing:1,marginBottom:10}}>NEW PLAYER</div>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Player name"
        autoFocus
        style={{width:"100%",background:SP.bg3,border:"1px solid rgba(73,72,71,.25)",borderRadius:9,padding:"9px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif",marginBottom:8}}/>
      <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        {["Batsman","Bowler","All-rounder","Wicket-keeper"].map(r=>(
          <button key={r} onClick={()=>setRole(r)}
            style={{padding:"5px 10px",borderRadius:8,border:role===r?"1px solid #4ade80":"1px solid rgba(73,72,71,.25)",background:role===r?"rgba(74,222,128,.1)":"transparent",color:role===r?"#4ade80":"#64748b",fontSize:11,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            {r}
          </button>
        ))}
      </div>
      {err && <div style={{color:SP.tertiary,fontSize:11,marginBottom:8}}>{err}</div>}
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>{setOpen(false);setName("");setErr("");}}
          style={{flex:1,padding:"8px 0",background:"none",border:"1px solid rgba(73,72,71,.25)",borderRadius:9,color:SP.textDim,fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
          Cancel
        </button>
        <button onClick={save} disabled={saving||!name.trim()}
          style={{flex:2,padding:"8px 0",background:name.trim()?"linear-gradient(135deg,#22c55e,#16a34a)":"#1e293b",border:"none",borderRadius:9,color:name.trim()?"#fff":"#334155",fontWeight:"bold",fontSize:13,cursor:name.trim()?"pointer":"not-allowed",fontFamily:"Lexend,Georgia,sans-serif"}}>
          {saving?"Saving…":"✓ Add to List"}
        </button>
      </div>
    </div>
  );
}

function TeamsScreen({ currentUser, isAdmin, onBack, setScreen, setHomeTab }) {

  const [teams,   setTeams]   = React.useState([]);
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view,    setView]    = React.useState("list"); // list | create | edit | detail
  const [sel,     setSel]     = React.useState(null);
  const [form,    setForm]    = React.useState({ name:"", playerIds:[] });
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState("");

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

  function canEdit(t) {
    if (!currentUser) return false;
    if (isAdmin) return true;
    // Support both legacy single createdBy and new ownerIds array
    if (t.ownerIds && t.ownerIds.includes(currentUser.uid)) return true;
    if (t.createdBy && t.createdBy === currentUser.uid) return true;
    return false;
  }

  function isOwnerOf(t) {
    if (!currentUser) return false;
    if (t.ownerIds && t.ownerIds.includes(currentUser.uid)) return true;
    if (!t.ownerIds && t.createdBy === currentUser.uid) return true;
    return false;
  }

  function togglePlayer(id) {
    setForm(f => ({
      ...f,
      playerIds: f.playerIds.includes(id) ? f.playerIds.filter(x=>x!==id) : [...f.playerIds, id]
    }));
  }

  function toggleOwner(uid) {
    setForm(f => ({
      ...f,
      ownerIds: f.ownerIds.includes(uid) ? f.ownerIds.filter(x=>x!==uid) : [...f.ownerIds, uid]
    }));
  }

  function saveTeam() {
    if (!form.name.trim()) return setErr("Team name is required");
    if (form.playerIds.length < 2) return setErr("Add at least 2 players");
    setSaving(true); setErr("");
    // Always ensure current user is an owner
    var ownerIds = form.ownerIds || [];
    if (currentUser && !ownerIds.includes(currentUser.uid)) {
      ownerIds = [...ownerIds, currentUser.uid];
    }
    if (view==="edit" && sel) {
      _fbDB.ref("teams/"+sel.id).update({ name: form.name.trim(), playerIds: form.playerIds, ownerIds }).then(() => {
        var updated = {...sel, name: form.name.trim(), playerIds: form.playerIds, ownerIds};
        setTeams(ts => ts.map(t => t.id===sel.id ? updated : t).sort((a,b)=>a.name.localeCompare(b.name)));
        setSel(updated); setView("detail"); setSaving(false);
      }).catch(e => { setErr(e.message); setSaving(false); });
    } else {
      var id = "T_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
      var t = { id, name: form.name.trim(), playerIds: form.playerIds, ownerIds, createdBy: currentUser ? currentUser.uid : null, createdAt: Date.now() };
      _fbDB.ref("teams/"+id).set(t).then(() => {
        setTeams(ts => [...ts, t].sort((a,b)=>a.name.localeCompare(b.name)));
        setView("list"); setSaving(false);
      }).catch(e => { setErr(e.message); setSaving(false); });
    }
  }

  var inputSt = {width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"12px 14px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif"};

  // ── Create / Edit form ──
  if (view==="create" || view==="edit") {
    var isEdit = view==="edit";
    // For owner selection, show registered players that are also users
    var registeredPlayers = players.filter(p=>p.uid);
    return (
      <div style={{...S.page,paddingBottom:88}}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{padding:"16px 0 12px",display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>{setView(isEdit?"detail":"list");setErr("");}} style={S.btnSm}>← Back</button>
            <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>{isEdit?"EDIT TEAM":"CREATE TEAM"}</h2>
          </div>
          <div style={{background:SP.bg3,borderRadius:12,padding:20,border:"1px solid rgba(73,72,71,.25)",marginBottom:12}}>
            <div style={{marginBottom:14}}>
              <label style={{...S.lbl,display:"block",marginBottom:6}}>TEAM NAME</label>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Mumbai Warriors" style={inputSt}/>
            </div>

            {/* Players header with count */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <label style={{color:SP.textDim,fontSize:11,letterSpacing:1}}>PLAYERS ({form.playerIds.length} selected)</label>
            </div>

            {/* Quick-add new player inline */}
            <QuickAddPlayer
              currentUser={currentUser}
              onAdded={(newP)=>{
                setPlayers(prev=>[...prev,newP].sort((a,b)=>a.name.localeCompare(b.name)));
                setForm(f=>({...f, playerIds:[...f.playerIds, newP.id]}));
              }}
            />

            {players.length===0 && <div style={{color:SP.textDim,fontSize:13,marginBottom:10,marginTop:8}}>No players yet — add one above.</div>}
            <div style={{maxHeight:"36vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,marginBottom:6,marginTop:8}}>
              {players.map(p=>{
                var on = form.playerIds.includes(p.id);
                return (
                  <div key={p.id} onClick={()=>togglePlayer(p.id)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:on?"1px solid #fbbf24":"1px solid rgba(73,72,71,.25)",background:on?"rgba(251,191,36,.08)":"#0f172a",cursor:"pointer"}}>
                    <div style={{width:20,height:20,borderRadius:5,border:on?"2px solid #fbbf24":"1px solid #475569",background:on?"#fbbf24":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {on&&<span style={{color:"#0f172a",fontSize:12,fontWeight:"bold"}}>✓</span>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{color:on?"#fbbf24":"#e2e8f0",fontSize:14}}>{p.name}</div>
                      <div style={{color:SP.textDim,fontSize:11}}>{p.role}{p.uid?" · ✓ Registered":""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Multiple owners selector */}
          {registeredPlayers.length > 0 && (
            <div style={{background:SP.bg3,borderRadius:12,padding:20,border:"1px solid rgba(73,72,71,.25)",marginBottom:12}}>
              <label style={{color:SP.textDim,fontSize:11,letterSpacing:1,display:"block",marginBottom:4}}>TEAM OWNERS <span style={{color:"#334155"}}>(can edit this team)</span></label>
              <div style={{color:SP.textDim,fontSize:11,marginBottom:10}}>You are always an owner. Select additional owners:</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {registeredPlayers.map(p=>{
                  if (!p.uid) return null;
                  var isMe = currentUser && p.uid === currentUser.uid;
                  var on = isMe || (form.ownerIds||[]).includes(p.uid);
                  return (
                    <div key={p.uid} onClick={()=>!isMe&&toggleOwner(p.uid)}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,border:on?"1px solid #4ade80":"1px solid rgba(73,72,71,.25)",background:on?"rgba(74,222,128,.06)":"#0f172a",cursor:isMe?"default":"pointer",opacity:isMe?0.7:1}}>
                      <div style={{width:18,height:18,borderRadius:4,border:on?"2px solid #4ade80":"1px solid #475569",background:on?"#4ade80":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {on&&<span style={{color:"#0f172a",fontSize:11,fontWeight:"bold"}}>✓</span>}
                      </div>
                      <div>
                        <div style={{color:on?"#4ade80":"#e2e8f0",fontSize:13}}>{p.name} {isMe?"(you)":""}</div>
                        <div style={{color:SP.textDim,fontSize:10}}>{p.role}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {err&&<div style={{color:"#ff716c",fontSize:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,113,108,.08)",borderRadius:8,border:"1px solid rgba(255,113,108,.2)"}}>{err}</div>}
          <button onClick={saveTeam} disabled={saving}
            style={{width:"100%",padding:"13px 0",background:SP.primary,borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
            {saving?"Saving…":isEdit?"Save Changes":"Create Team"}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail view ──
  if (view==="detail" && sel) {
    var teamPlayers = players.filter(p=>sel.playerIds&&sel.playerIds.includes(p.id));
    var editable = canEdit(sel);
    var iAmOwner = isOwnerOf(sel);
    var ownerCount = (sel.ownerIds||[]).length || 1;
    return (
      <div style={S.page}>
        <div style={{...S.wrap, padding:"0 16px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <button onClick={()=>setView("list")} style={S.btnSm}>← Back</button>
              <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>{sel.name.toUpperCase()}</h2>
            </div>
            {editable && (
              <button onClick={()=>{setForm({name:sel.name,playerIds:[...(sel.playerIds||[])],ownerIds:[...(sel.ownerIds||(sel.createdBy?[sel.createdBy]:[]))]});setView("edit");}}
                style={{padding:"7px 14px",background:"transparent",border:"1px solid #fbbf24",borderRadius:10,color:SP.primary,fontWeight:"bold",fontSize:12,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
                ✏️ Edit
              </button>
            )}
          </div>
          <div style={{color:SP.textDim,fontSize:12,marginBottom:14,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <span>{teamPlayers.length} players</span>
            {iAmOwner && <span style={{color:SP.primary,fontSize:11}}>· You're an owner</span>}
            {isAdmin&&!iAmOwner && <span style={{color:"#a78bfa",fontSize:11}}>· Admin access</span>}
            {ownerCount > 1 && <span style={{color:SP.textDim,fontSize:11}}>· {ownerCount} owners</span>}
          </div>
          {teamPlayers.map(p=><PlayerFullStats key={p.id} p={p}/>)}
        </div>
        <nav style={S.bottomNav}>
          {[
            {icon:"🏠",label:"Home",tab:"home"},
            {icon:"📡",label:"Live",tab:"live"},
            {icon:"📚",label:"History",tab:"history"},
            {icon:"👤",label:"Profile",tab:"profile"},
          ].map(({icon,label,tab})=>(
            <div key={tab} onClick={()=>{if(tab==="history")setScreen("history");else{setHomeTab(tab);setScreen("home");}}}
              style={{...S.navItem,color:tab==="history"?SP.secondary:SP.textDim,background:tab==="history"?"rgba(102,157,255,.1)":"transparent"}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontWeight:"700",textTransform:"uppercase"}}>{label}</span>
            </div>
          ))}
        </nav>
      </div>
    );
  }

  // ── List view ──
  return (
    <div style={{...S.page,paddingBottom:88}}>
      <div style={{...S.wrap, padding:"0 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={S.btnSm}>← Back</button>
            <h2 style={{color:SP.primary,margin:0,fontSize:16,letterSpacing:2}}>👥 TEAMS</h2>
          </div>
          {currentUser && (
            <button onClick={()=>{setForm({name:"",playerIds:[],ownerIds:[]});setView("create");}}
              style={{padding:"7px 14px",background:SP.primary,border:"none",borderRadius:10,color:"#0f172a",fontWeight:"bold",fontSize:13,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
              + Create
            </button>
          )}
        </div>
        {loading && <div style={{color:SP.textDim,textAlign:"center",padding:40}}>Loading…</div>}
        {!loading && teams.length===0 && (
          <div style={{color:SP.textDim,textAlign:"center",padding:40,lineHeight:1.8}}>
            No teams yet.<br/><span style={{fontSize:12}}>Create a team to save your squad.</span>
          </div>
        )}
        {teams.map(t=>{
          var iOwn = isOwnerOf(t);
          return (
            <div key={t.id} onClick={()=>{setSel(t);setView("detail");}}
              style={{background:SP.bg3,borderRadius:10,padding:"14px 16px",marginBottom:10,border:"1px solid rgba(73,72,71,.25)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:"#fff",fontSize:15,fontWeight:"bold"}}>{t.name}</div>
                <div style={{color:SP.textDim,fontSize:12,marginTop:3}}>
                  {(t.playerIds||[]).length} players
                  {iOwn && <span style={{color:SP.primary,marginLeft:8,fontSize:11}}>· Owner</span>}
                  {isAdmin&&!iOwn && <span style={{color:"#a78bfa",marginLeft:8,fontSize:11}}>· Admin</span>}
                </div>
              </div>
              <span style={{color:SP.textDim,fontSize:18}}>›</span>
            </div>
          );
        })}
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
  var box = { background:SP.bg3,borderRadius:"20px 20px 0 0",padding:"22px 20px 36px",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto" };

  if (loading) return <div style={ov}><div style={box}><div style={{color:SP.textDim,textAlign:"center",padding:30}}>Loading…</div></div></div>;

  if (step==="pick") return (
    <div style={ov}>
      <div style={box}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{color:SP.primary,fontSize:15,fontWeight:"bold"}}>Pick Team {slot}</div>
          <button onClick={onCancel} style={{...S.btnSm}}>✕ Cancel</button>
        </div>
        {teams.length===0 && <div style={{color:SP.textDim,fontSize:13,textAlign:"center",padding:20}}>No saved teams — enter names manually in the setup wizard.</div>}
        {teams.map(t=>(
          <div key={t.id} onClick={()=>pickTeam(t)}
            style={{background:SP.bg,borderRadius:12,padding:"12px 14px",marginBottom:8,border:"1px solid rgba(73,72,71,.25)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{color:"#fff",fontSize:14,fontWeight:"bold"}}>{t.name}</div>
              <div style={{color:SP.textDim,fontSize:12}}>{(t.playerIds||[]).length} players in squad</div>
            </div>
            <span style={{color:SP.primary,fontSize:18}}>›</span>
          </div>
        ))}
        <button onClick={onCancel} style={{width:"100%",marginTop:12,padding:"11px 0",background:"transparent",border:"1px solid rgba(73,72,71,.25)",borderRadius:10,color:SP.textDim,fontFamily:"Lexend,Georgia,sans-serif",fontSize:13,cursor:"pointer"}}>
          Enter names manually instead
        </button>
      </div>
    </div>
  );

  if (step==="squad") return (
    <div style={ov}>
      <div style={box}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{color:SP.primary,fontSize:15,fontWeight:"bold"}}>Select Playing XI</div>
          <button onClick={()=>setStep("pick")} style={S.btnSm}>← Back</button>
        </div>
        <div style={{color:SP.textDim,fontSize:12,marginBottom:14}}>Tap players to include/exclude · {selIds.length} selected</div>
        <div style={{marginBottom:14}}>
          <label style={{...S.lbl,display:"block",marginBottom:6}}>TEAM NAME</label>
          <input value={teamName} onChange={e=>setTeamName(e.target.value)}
            style={{width:"100%",background:SP.bg,border:"1px solid rgba(73,72,71,.25)",borderRadius:10,padding:"10px 12px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"Lexend,Georgia,sans-serif"}}/>
        </div>
        {squadPool.map(p=>{
          var on = selIds.includes(p.id);
          return (
            <div key={p.id} onClick={()=>toggleSel(p.id)}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,marginBottom:6,border:on?"1px solid #fbbf24":"1px solid rgba(73,72,71,.25)",background:on?"rgba(251,191,36,.08)":"#0f172a",cursor:"pointer"}}>
              <div style={{width:22,height:22,borderRadius:6,border:on?"2px solid #fbbf24":"1px solid #475569",background:on?"#fbbf24":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {on&&<span style={{color:"#0f172a",fontSize:13,fontWeight:"bold"}}>✓</span>}
              </div>
              <div style={{flex:1}}>
                <div style={{color:on?"#fbbf24":"#e2e8f0",fontSize:14}}>{p.name}</div>
                <div style={{color:SP.textDim,fontSize:11}}>{p.role}</div>
              </div>
            </div>
          );
        })}
        {err&&<div style={{color:SP.tertiary,fontSize:12,margin:"8px 0",padding:"8px 12px",background:"rgba(239,68,68,.1)",borderRadius:8}}>{err}</div>}
        <button onClick={confirm}
          style={{width:"100%",marginTop:14,padding:"13px 0",background:SP.primary,borderRadius:12,border:"none",color:"#0f172a",fontWeight:"bold",fontSize:15,cursor:"pointer",fontFamily:"Lexend,Georgia,sans-serif"}}>
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
