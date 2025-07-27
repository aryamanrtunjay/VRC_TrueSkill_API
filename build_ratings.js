/********************************************************************
 *  build_ratings.js  – rate‑limit friendly
 *******************************************************************/
import 'dotenv/config';
import fs from 'node:fs/promises';

const TOKEN = process.env.ROBOT_EVENTS_TOKEN;
if (!TOKEN) { console.error('Missing ROBOT_EVENTS_TOKEN'); process.exit(1); }

const BASE_URL   = 'https://www.robotevents.com/api/v2';
const HEADERS    = { Authorization:`Bearer ${TOKEN}`, Accept:'application/json' };
const PROGRAM_ID = 1;

const CONCURRENCY  = Number(process.env.CONCURRENCY  ?? 4);   // parallel fetches
const MIN_SPACING  = Number(process.env.MIN_SPACING  ?? 300); // ms between any two requests
const MAX_RETRIES  = Number(process.env.MAX_RETRIES  ?? 5);
const BASE_DELAY   = Number(process.env.BASE_DELAY   ?? 500); // ms

const BAR_WIDTH = 28;

/*──────────── ts‑trueskill env */
const { TrueSkill, Rating } = await import('ts-trueskill');
const env = new TrueSkill({mu:25,sigma:25/3,beta:25/6,tau:25/300,drawProbability:0.1});
const ratings = new Map();

/*──────────── global pacer + retry */
let lastCall = 0;
async function apiFetch(endpoint, params = {}) {
  // build URL
  const url = new URL(BASE_URL + endpoint);
  for (const [k,v] of Object.entries(params))
    (Array.isArray(v)?v:[v]).forEach(x=>url.searchParams.append(`${k}[]`,x));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // pace
    const now = Date.now();
    const wait = Math.max(0, MIN_SPACING - (now - lastCall));
    if (wait) await new Promise(r=>setTimeout(r, wait));

    lastCall = Date.now();
    const res = await fetch(url, { headers: HEADERS });

    if (res.ok) return res.json();

    /* retryable? */
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) || 0;
      const backoff = ra*1000 || BASE_DELAY * 2**attempt;
      if (attempt < MAX_RETRIES) {
        await new Promise(r=>setTimeout(r, backoff));
        continue;
      }
    }
    // unrecoverable
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
}

/*──────────── fetchAll unchanged except it uses apiFetchWithRetry */
async function fetchAll(endpoint, params={}) {
  let p=1, done=false, out=[];
  while (!done) {
    const r = await apiFetch(endpoint,{...params,page:p,per_page:250});
    out = out.concat(r.data);
    done = r.meta.current_page >= r.meta.last_page;
    p++;
  }
  return out;
}

/*──────────── lightweight map‑limit */
async function mapLimit(arr, limit, fn){
  const ret=[], n=arr.length;
  let i=0, active=0, resolve, reject;
  const done = new Promise((res,rej)=>{resolve=res;reject=rej;});
  function launch(){
    if (i>=n && active===0) return resolve(ret);
    while (active<limit && i<n){
      const idx=i++; active++;
      Promise.resolve(fn(arr[idx],idx))
        .then(v=>{ret[idx]=v;active--;launch();},reject);
    }
  } launch(); return done;
}

/*──────────── progress bar */
let total=1, done=0;
function addWork(n){total+=n;}
function tick(n=1){done+=n; draw();}
function draw(){
  const pct = done/total;
  const full = Math.round(pct*BAR_WIDTH);
  process.stdout.write(`\r[${'█'.repeat(full)}${'▒'.repeat(BAR_WIDTH-full)}] ${(pct*100).toFixed(1)}%  (${done}/${total})`);
}

/*──────────── stats */
const stats={ seasons:0, events:0, eventsNoDiv:0, divisions:0, divNoMatch:0, matches:0, rated:0 };

/*──────────── handlers */
async function doMatch(m){
  stats.matches++;
  const red  = m.alliances.find(a=>a.color==='red');
  const blue = m.alliances.find(a=>a.color==='blue');
  if(!red||!blue){tick();return;}

  const rT = red .teams.filter(t=>t.team).map(t=>t.team.number);
  const bT = blue.teams.filter(t=>t.team).map(t=>t.team.number);
  if(rT.length!==2||bT.length!==2){tick();return;}

  const rR = rT.map(n=>ratings.get(n)||new Rating());
  const bR = bT.map(n=>ratings.get(n)||new Rating());
  const ranks = red.score>blue.score?[0,1]: red.score<blue.score?[1,0]:[0,0];
  const [newR,newB]=env.rate([rR,bR],ranks);
  rT.forEach((n,i)=>ratings.set(n,newR[i]));
  bT.forEach((n,i)=>ratings.set(n,newB[i]));
  stats.rated++; tick();
}

async function doDivision(evId, div){
  const matches = await fetchAll(`/events/${evId}/divisions/${div.id}/matches`,{scored:1});
  if(!matches.length){stats.divNoMatch++; return;}
  addWork(matches.length); draw();
  await mapLimit(matches, CONCURRENCY, doMatch);
}

async function doEvent(ev){
  stats.events++;
  const divs = (await apiFetch(`/events/${ev.id}/divisions`)).data;
  if(!divs.length){stats.eventsNoDiv++; tick(); return;}
  stats.divisions += divs.length;
  await mapLimit(divs, CONCURRENCY, d=>doDivision(ev.id,d));
  tick(); // event itself
}

async function doSeason(s){
  stats.seasons++;
  const events = await fetchAll('/events',{'program[]':PROGRAM_ID,'season[]':s.id});
  addWork(events.length); draw();
  await mapLimit(events, CONCURRENCY, doEvent);
}

/*──────────── main */
(async ()=>{
  console.time('total');
  const seasons = await fetchAll('/seasons',{program:PROGRAM_ID});
  const wanted  = seasons.filter(s=>s.id===197||s.id===190).sort((a,b)=>a.id-b.id);

  total = 0; done = 0; draw();

  for(const s of wanted) await doSeason(s);

  process.stdout.write('\n');
  const out={
    updated:new Date().toISOString(),
    seasons:wanted.map(x=>({id:x.id,name:x.name})),
    teams:Object.fromEntries([...ratings.entries()].map(([n,r])=>[
      n, {mu:r.mu,sigma:r.sigma,trueskill:r.mu-3*r.sigma}
    ]))
  };
  await fs.writeFile('ratings.json', JSON.stringify(out,null,2),'utf8');
  console.log(`Saved ${ratings.size} teams → ratings.json`);
  console.timeEnd('total');
  console.table(stats);
})();
