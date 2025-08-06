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

    if (!result.meta || result.meta.current_page >= result.meta.last_page) break;

    page++;
  }

  return out;
}

function extractTeams(alliance, teamMap) {
  return alliance.teams.filter(t => t.team && t.team.id && teamMap.has(t.team.id)).map(t => teamMap.get(t.team.id));
}

function sanitize(str) {
  return str.replace(/,/g, '').replace(/\s+/g, ' ').trim();
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
  const currentDate = new Date().toISOString(); // Format: 2025-08-05T04:21:39.290Z
  console.log(`📅 Current date: ${currentDate}`);
  
  console.log('📡 Fetching seasons...');
  const seasons = await fetchAll('/seasons', { program: PROGRAM_ID });

  const targetSeasons = seasons.filter(s => s.id === 197 || s.id === 190);
  if (targetSeasons.length === 0) {
    console.log('❌ No matching seasons found (expecting IDs 197 or 190)');
    return;
  }

  console.log(`🧭 Target seasons: ${targetSeasons.map(s => s.name).join(', ')}`);

  const rows = [];
  let totalEvents = 0;
  let totalMatches = 0;
  let processedMatches = 0;
  let filteredEvents = 0;

  for (const season of targetSeasons) {
    console.log(`\n📅 Fetching events for season: ${season.name}`);
    const events = await fetchAll('/events', {
      program: PROGRAM_ID,
      season: season.id
    });

    console.log(`   🔎 Found ${events.length} events`);

    for (const event of events) {
      // Filter out events that haven't started yet
      if (event.start && event.start > currentDate) {
        filteredEvents++;
        console.log(`   ⏭️ Skipping future event: ${event.name} (starts ${event.start})`);
        continue;
      }

      console.log(`   📍 Event: ${event.name} (ID: ${event.id})`);
      const eventDetails = await apiFetch(`/events/${event.id}`);
      const divisions = eventDetails.divisions || [];
      if (divisions.length === 0) {
        console.log('      ⚠️ No divisions found, skipping.');
        continue;
      }

      console.log(`      📥 Fetching teams for event`);
      const eventTeams = await fetchAll(`/events/${event.id}/teams`);
      const teamMap = new Map(eventTeams.map(team => [team.id, team.number]));

      for (const division of divisions) {
        console.log(`      📤 Fetching matches for division: ${division.name}`);
        const matches = await fetchAll(
          `/events/${event.id}/divisions/${division.id}/matches`,
          { scored: 1 }
        );

        totalMatches += matches.length;

        for (const match of matches) {
          processedMatches++;
          drawProgressBar(processedMatches, totalMatches || 1, startTime);

          const red = match.alliances.find(a => a.color === 'red');
          const blue = match.alliances.find(a => a.color === 'blue');

          if (!red || !blue) continue;

          const redTeams = extractTeams(red, teamMap);
          const blueTeams = extractTeams(blue, teamMap);

          if (redTeams.length !== 2 || blueTeams.length !== 2) continue;

          rows.push([
            sanitize(season.name),
            sanitize(event.name),
            match.id,
            match.round,
            redTeams[0], redTeams[1],
            blueTeams[0], blueTeams[1],
            red.score ?? 0,
            blue.score ?? 0
          ]);
        }
      }

      totalEvents++;
    }
  }

  console.log('\n💾 Writing to matches.csv...');
  const header = 'season,event,match_id,match_round,red1,red2,blue1,blue2,red_score,blue_score';
  const csv = [header, ...rows.map(r => r.join(','))].join('\n');
  await fs.writeFile('matches.csv', csv, 'utf8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Done: ${rows.length} matches saved to matches.csv`);
  console.log(`⏱️ Elapsed time: ${elapsed} seconds`);
  console.log(`📊 Events processed: ${totalEvents}, Matches processed: ${processedMatches}`);
  console.log(`⏭️ Future events filtered out: ${filteredEvents}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
});