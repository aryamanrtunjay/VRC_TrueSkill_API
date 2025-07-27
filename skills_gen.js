import 'dotenv/config';
import fs from 'node:fs/promises';

const TOKEN = process.env.ROBOT_EVENTS_TOKEN;
if (!TOKEN) {
  console.error('❌ Missing ROBOT_EVENTS_TOKEN in .env');
  process.exit(1);
}

const BASE_URL = 'https://www.robotevents.com/api/v2';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json'
};
const PROGRAM_ID = 1;

const BAR_WIDTH = 30;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetch(endpoint, params = {}, retries = 3) {
  const url = new URL(BASE_URL + endpoint);
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val)) {
      val.forEach(v => url.searchParams.append(`${key}[]`, v));
    } else {
      url.searchParams.append(key, val);
    }
  }

  console.log(`🌐 Fetching: ${url.toString()}`);
  await sleep(500); // rate limiting
  const res = await fetch(url, { headers: HEADERS });

  if (res.status === 429 && retries > 0) {
    console.warn(`⚠️ Rate limit hit. Retrying in 10s... (${retries} left)`);
    await sleep(10000);
    return apiFetch(endpoint, params, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ API ${res.status}: ${text}`);
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchAll(endpoint, params = {}) {
  let page = 1;
  let out = [];

  while (true) {
    const result = await apiFetch(endpoint, { ...params, page, per_page: 100 });
    out = out.concat(result.data);
    console.log(`🔍 Fetched ${out.length} teams so far...`);

    if (!result.meta || result.meta.current_page >= result.meta.last_page) break;

    page++;
  }

  return out;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function drawProgressBar(done, total, startTime) {
  const pct = done / total;
  const full = Math.round(pct * BAR_WIDTH);
  const now = Date.now();
  const elapsed = (now - startTime) / 1000;
  const estimatedTotalTime = elapsed / pct;
  const eta = estimatedTotalTime - elapsed;

  process.stdout.write(
    `\r[${'█'.repeat(full)}${' '.repeat(BAR_WIDTH - full)}] ${(pct * 100).toFixed(1)}%  ETA: ${formatTime(eta)} (${done}/${total})`
  );
}

async function main() {
  const startTime = Date.now();
  console.log('📡 Fetching seasons...');
  const seasons = await fetchAll('/seasons', { program: PROGRAM_ID });

  const targetSeasons = seasons.filter(s => s.id === 190);
  if (targetSeasons.length === 0) {
    console.log('❌ No matching seasons found (expecting ID 190)');
    return;
  }

  console.log(`🧭 Target seasons: ${targetSeasons.map(s => s.name).join(', ')}`);

  const rows = [];
  const header = 'team,season,driver,programming,combined';

  for (const season of targetSeasons) {
    console.log(`\n📅 Fetching teams for season: ${season.name}`);
    const teams = await fetchAll('/teams', {
      program: PROGRAM_ID,
      season: season.id
    });

    console.log(`   🔎 Found ${teams.length} teams`);

    let processedTeams = 0;
    const totalTeams = teams.length;

    for (const team of teams) {
      processedTeams++;
      drawProgressBar(processedTeams, totalTeams, startTime);

      const skills = await fetchAll(`/teams/${team.id}/skills`, {
        season: [season.id]
      });

      let maxDriver = 0;
      let maxProgramming = 0;

      for (const skill of skills) {
        if (skill.type === 'driver') {
          maxDriver = Math.max(maxDriver, skill.score);
        } else if (skill.type === 'programming') {
          maxProgramming = Math.max(maxProgramming, skill.score);
        }
      }

      const combined = maxDriver + maxProgramming;

      if (combined > 0) {  // Only add if has skills
        rows.push([
          team.number,
          season.name,
          maxDriver,
          maxProgramming,
          combined
        ]);
      }
    }
  }

  console.log('\n💾 Writing to skills.csv...');
  const csv = [header, ...rows.map(r => r.join(','))].join('\n');
  await fs.writeFile('skills.csv', csv, 'utf8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Done: ${rows.length} team skills saved to skills.csv`);
  console.log(`⏱️ Elapsed time: ${elapsed} seconds`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
});