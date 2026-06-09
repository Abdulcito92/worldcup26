// Auto-updates index.html OFFICIAL_BYKEY with finished 2026 World Cup results.
// Runs in GitHub Actions. Data source: football-data.org (free tier includes the World Cup).
// Set repo secret FOOTBALL_DATA_TOKEN. No other dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'index.html';
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const CANON = ["Mexico","South Africa","South Korea","Czechia","Canada","Bosnia & Herzegovina","Qatar","Switzerland","Brazil","Morocco","Haiti","Scotland","USA","Paraguay","Australia","Türkiye","Germany","Curaçao","Ivory Coast","Ecuador","Netherlands","Japan","Sweden","Tunisia","Belgium","Egypt","Iran","New Zealand","Spain","Cape Verde","Saudi Arabia","Uruguay","France","Senegal","Iraq","Norway","Argentina","Algeria","Austria","Jordan","Portugal","DR Congo","Uzbekistan","Colombia","England","Croatia","Ghana","Panama"];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const NAME = {};
for (const c of CANON) NAME[norm(c)] = c;
Object.entries({
  'unitedstates':'USA','unitedstatesofamerica':'USA',
  'turkey':'Türkiye',
  'czechrepublic':'Czechia',
  'korearepublic':'South Korea','republicofkorea':'South Korea','koreasouth':'South Korea',
  'iriran':'Iran',
  'cotedivoire':'Ivory Coast',
  'caboverde':'Cape Verde',
  'congodr':'DR Congo','drcongo':'DR Congo','democraticrepublicofcongo':'DR Congo','democraticrepublicofthecongo':'DR Congo',
  'bosniaandherzegovina':'Bosnia & Herzegovina'
}).forEach(([k,v]) => NAME[k] = v);
const toCanon = s => NAME[norm(s||'')] || null;

const src = await readFile(FILE, 'utf8');

// fixtures from the M array
const rows = src.match(/\["2026-\d\d-\d\d"[^\]]*\]/g) || [];
const fixtures = [];
for (const r of rows) { try { const a = JSON.parse(r); fixtures.push({date:a[0], home:a[2], away:a[3]}); } catch {} }
if (!fixtures.length) { console.error('No fixtures parsed from M array'); process.exit(1); }

// existing recorded results
const blockRe = /const OFFICIAL_BYKEY=\{([\s\S]*?)\n\};/;
const block = src.match(blockRe);
if (!block) { console.error('OFFICIAL_BYKEY block not found'); process.exit(1); }
const results = {};
const er = /"([^"]+)":\{h:(\d+),a:(\d+)\}/g; let em;
while ((em = er.exec(block[1]))) results[em[1]] = {h:+em[2], a:+em[3]};

if (!TOKEN) { console.log('FOOTBALL_DATA_TOKEN not set, skipping fetch.'); process.exit(0); }

let added = 0;
try {
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches?season=2026', { headers: { 'X-Auth-Token': TOKEN } });
  if (!res.ok) { console.error('API HTTP', res.status); process.exit(0); }
  const data = await res.json();
  for (const mt of (data.matches || [])) {
    if (mt.status !== 'FINISHED') continue;
    const ah = toCanon(mt.homeTeam && mt.homeTeam.name), aa = toCanon(mt.awayTeam && mt.awayTeam.name);
    const hs = mt.score && mt.score.fullTime && mt.score.fullTime.home;
    const as = mt.score && mt.score.fullTime && mt.score.fullTime.away;
    if (ah == null || aa == null || hs == null || as == null) continue;
    let fx = fixtures.find(f => f.home === ah && f.away === aa), h = hs, a = as;
    if (!fx) { fx = fixtures.find(f => f.home === aa && f.away === ah); if (fx) { h = as; a = hs; } }
    if (!fx) continue;
    const key = `${fx.date}|${fx.home}|${fx.away}`;
    const p = results[key];
    if (!p || p.h !== h || p.a !== a) { results[key] = {h, a}; added++; }
  }
} catch (e) { console.error('Fetch failed:', e.message); process.exit(0); }

const keys = Object.keys(results).sort();
const body = keys.map(k => `  "${k}":{h:${results[k].h},a:${results[k].a}},`).join('\n');
const newBlock = `const OFFICIAL_BYKEY={\n${body}\n};`;
await writeFile(FILE, src.replace(blockRe, newBlock));
console.log(`Updated ${added} result(s); ${keys.length} total recorded.`);
