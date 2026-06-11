// Auto-updates index.html with 2026 World Cup data: final results, live (in-play) scores,
// goal events (scorer + minute), top scorers, and a timestamp.
// Runs in GitHub Actions. Data: football-data.org. Needs repo secret FOOTBALL_DATA_TOKEN.
//   - Final scores + top scorers: free tier (delayed).
//   - Live in-play scores: needs the "Free w/ Livescores" tier (EUR 12/mo).
//   - Goal events (scorer + minute): needs the "Deep Data" tier (EUR 29/mo).
// On lower tiers the live/goal sections simply stay empty; the script still runs safely.
// Commits only when data actually changed (the timestamp is not bumped on no-op runs),
// which keeps GitHub Pages builds low even on a fast schedule. No dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'index.html';
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const BASE = 'https://api.football-data.org/v4/competitions/WC';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CANON = ["Mexico","South Africa","South Korea","Czechia","Canada","Bosnia & Herzegovina","Qatar","Switzerland","Brazil","Morocco","Haiti","Scotland","USA","Paraguay","Australia","Türkiye","Germany","Curaçao","Ivory Coast","Ecuador","Netherlands","Japan","Sweden","Tunisia","Belgium","Egypt","Iran","New Zealand","Spain","Cape Verde","Saudi Arabia","Uruguay","France","Senegal","Iraq","Norway","Argentina","Algeria","Austria","Jordan","Portugal","DR Congo","Uzbekistan","Colombia","England","Croatia","Ghana","Panama"];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const NAME = {};
for (const c of CANON) NAME[norm(c)] = c;
Object.entries({
'unitedstates':'USA','unitedstatesofamerica':'USA','turkey':'Türkiye','czechrepublic':'Czechia',
'korearepublic':'South Korea','republicofkorea':'South Korea','koreasouth':'South Korea','iriran':'Iran',
'cotedivoire':'Ivory Coast','caboverde':'Cape Verde','congodr':'DR Congo','drcongo':'DR Congo',
'democraticrepublicofcongo':'DR Congo','democraticrepublicofthecongo':'DR Congo','bosniaandherzegovina':'Bosnia & Herzegovina'
}).forEach(([k,v]) => NAME[k] = v);
const toCanon = s => NAME[norm(s||'')] || null;
const get = (url) => fetch(url, { headers: { 'X-Auth-Token': TOKEN } });

const src = await readFile(FILE, 'utf8');

// fixtures from the M[] array
const rows = src.match(/\["2026-\d\d-\d\d"[^\]]*\]/g) || [];
const fixtures = [];
for (const r of rows) { try { const a = JSON.parse(r); fixtures.push({ date: a[0], home: a[2], away: a[3] }); } catch {} }
if (!fixtures.length) { console.error('No fixtures parsed'); process.exit(1); }

// existing final results
const officialRe = /const OFFICIAL_BYKEY=\{([\s\S]*?)\n\};/;
const block = src.match(officialRe);
if (!block) { console.error('OFFICIAL_BYKEY block not found'); process.exit(1); }
const results = {};
{ const er = /"([^"]+)":\{h:(\d+),a:(\d+)\}/g; let em; while ((em = er.exec(block[1]))) results[em[1]] = { h: +em[2], a: +em[3] }; }

const live = {};
const goals = {};
let scorers = [];
let added = 0;

function mapFixture(homeName, awayName) {
  const ah = toCanon(homeName), aa = toCanon(awayName);
  if (ah == null || aa == null) return null;
  let fx = fixtures.find(f => f.home === ah && f.away === aa);
  if (fx) return { fx, swap: false };
  fx = fixtures.find(f => f.home === aa && f.away === ah);
  if (fx) return { fx, swap: true };
  return null;
}

if (TOKEN) {
  let data = null;
  try {
    const res = await get(`${BASE}/matches?season=2026`);
    if (res.ok) data = await res.json();
    else console.error('Matches API HTTP', res.status);
  } catch (e) { console.error('Matches fetch failed:', e.message); }

  if (data) {
    const today = new Date().toISOString().slice(0, 10);
    for (const mt of (data.matches || [])) {
      const mapped = mapFixture(mt.homeTeam && mt.homeTeam.name, mt.awayTeam && mt.awayTeam.name);
      if (!mapped) continue;
      const { fx, swap } = mapped;
      const key = `${fx.date}|${fx.home}|${fx.away}`;
      const st = mt.status;
      const score = (mt.score && mt.score.fullTime) || {};
      let h = score.home, a = score.away;

      if (st === 'FINISHED') {
        if (h != null && a != null) {
          let H = h, A = a; if (swap) { H = a; A = h; }
          const p = results[key];
          if (!p || p.h !== H || p.a !== A) { results[key] = { h: H, a: A }; added++; }
        }
      } else if (st === 'IN_PLAY' || st === 'PAUSED') {
        let H = (h == null ? 0 : h), A = (a == null ? 0 : a);
        if (swap) { const t = H; H = A; A = t; }
        live[key] = { h: H, a: A, st };
      }

      // goal events (Deep Data tier) for today's live/finished matches
      if ((st === 'IN_PLAY' || st === 'PAUSED' || st === 'FINISHED') && String(mt.utcDate || '').slice(0, 10) === today) {
        try {
          const d = await get(`${BASE}/matches/${mt.id}`);
          if (d.ok) {
            const dd = await d.json();
            const arr = [];
            for (const g of (dd.goals || [])) {
              const player = (g.scorer && g.scorer.name) || '';
              if (!player) continue;
              const teamC = toCanon(g.team && g.team.name) || (g.team && g.team.name) || '';
              let mn = (g.minute != null ? String(g.minute) : '');
              if (g.injuryTime != null) mn += '+' + g.injuryTime;
              arr.push({ t: teamC, p: player, m: mn });
            }
            if (arr.length) goals[key] = arr;
          }
          await sleep(6500); // stay under the free 10 calls/min limit
        } catch (e) { /* ignore goal-detail errors */ }
      }
    }
  }

  // top scorers (Golden Boot)
  try {
    const r2 = await get(`${BASE}/scorers?season=2026&limit=25`);
    if (r2.ok) {
      const d2 = await r2.json();
      for (const sc of (d2.scorers || [])) {
        const name = sc.player && sc.player.name;
        const g = sc.goals;
        if (!name || g == null) continue;
        scorers.push({ n: name, t: toCanon(sc.team && sc.team.name) || (sc.team && sc.team.name) || '', g });
      }
    } else console.error('Scorers API HTTP', r2.status);
  } catch (e) { console.error('Scorers fetch failed:', e.message); }
} else {
  console.log('FOOTBALL_DATA_TOKEN not set.');
}

// rebuild data blocks
const oKeys = Object.keys(results).sort();
const officialBody = oKeys.map(k => ` "${k}":{h:${results[k].h},a:${results[k].a}},`).join('\n');
const newOfficial = `const OFFICIAL_BYKEY={\n${officialBody}\n};`;

const lKeys = Object.keys(live).sort();
const liveBody = lKeys.map(k => ` "${k}":{h:${live[k].h},a:${live[k].a},st:"${live[k].st}"},`).join('\n');
const newLive = `const LIVE_BYKEY={\n${liveBody}\n};`;

const gKeys = Object.keys(goals).sort();
const goalsBody = gKeys.map(k => ` ${JSON.stringify(k)}:${JSON.stringify(goals[k])},`).join('\n');
const newGoals = `const GOALS_BYKEY={\n${goalsBody}\n};`;

const newScorers = `const SCORERS=${JSON.stringify(scorers)};`;

let out = src
  .replace(officialRe, newOfficial)
  .replace(/const LIVE_BYKEY=\{[\s\S]*?\n\};/, newLive)
  .replace(/const GOALS_BYKEY=\{[\s\S]*?\n\};/, newGoals)
  .replace(/const SCORERS=\[[\s\S]*?\];/, newScorers);

if (out === src) {
  console.log('No data changes; leaving index.html untouched.');
} else {
  const stamp = new Date().toISOString();
  out = out.replace(/const LAST_UPDATED="[^"]*";/, `const LAST_UPDATED="${stamp}";`);
  await writeFile(FILE, out);
  console.log(`Updated. results=${oKeys.length} (+${added}) live=${lKeys.length} goals=${gKeys.length} scorers=${scorers.length}. Stamped ${stamp}.`);
}
