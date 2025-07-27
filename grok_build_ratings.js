/********************************************************************
 *  Optimized TrueSkill Computation for VEX V5RC
 *  - Computes ratings from High Stakes season onwards
 *  - Processes matches in chronological order
 *  - Stores historical ratings in ratings_history.json
 *  - Optimized with parallel fetches and progress bar
 *******************************************************************/

import 'dotenv/config';
import fs from 'fs';
import { setTimeout } from 'timers/promises';

// Inline progress bar helper
function renderProgress(current, total) {
  const width = 50;
  const filled = Math.floor((current / total) * width);
  const bar = '█'.repeat(filled) + '-'.repeat(width - filled);
  process.stdout.write(`\r[${bar}] ${((current / total) * 100).toFixed(1)}%`);
}

const ROBOT_EVENTS_TOKEN = process.env.ROBOT_EVENTS_TOKEN;
if (!ROBOT_EVENTS_TOKEN) {
  console.error('Missing ROBOT_EVENTS_TOKEN in .env');
  process.exit(1);
}

const BASE_URL = 'https://www.robotevents.com/api/v2';
const HEADERS = { Authorization: `Bearer ${ROBOT_EVENTS_TOKEN}`, Accept: 'application/json' };
const PROGRAM_ID = 1; // VEX V5RC
const BATCH_SIZE = 5; // Number of parallel API requests

// ────────────── Dynamic imports ──────────────
let TrueSkill, Rating;
let env;

const teamRatings = new Map();
const teamHistory = new Map();

/********************************************************************
 *  HTTP helpers
 *******************************************************************/
async function apiFetch(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(`${k}[]`, x));
    else url.searchParams.append(k, v);
  }
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAll(endpoint, params = {}) {
  let page = 1, done = false, out = [];
  while (!done) {
    const r = await apiFetch(endpoint, { ...params, page, per_page: 250 });
    out = out.concat(r.data);
    done = r.meta.current_page >= r.meta.last_page;
    page++;
    await setTimeout(200); // Reduced throttle for batching
  }
  return out;
}

/********************************************************************
 *  Module / environment initialisation
 *******************************************************************/
async function initModules() {
  const ts = await import('ts-trueskill');
  TrueSkill = ts.TrueSkill;
  Rating = ts.Rating;

  env = new TrueSkill({
    mu: 25, sigma: 25/3, beta: 25/6, tau: 25/300, drawProbability: 0.1,
  });

  // Quick token sanity-check
  await apiFetch('/teams', { 'number[]': '169X', 'program[]': PROGRAM_ID });
}

/********************************************************************
 *  Season-level computation
 *******************************************************************/
async function rateSeason(season, totalMatches, progressOffset) {
  console.log(`▶ Rating season ${season.name}`);

  const events = await fetchAll('/events', {
    'program[]': PROGRAM_ID,
    'season[]': season.id,
  });
  if (!events.length) {
    console.log('  no events found — skipping');
    return { teamCount: 0, matchCount: 0 };
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  let matchCount = 0;
  let processedMatches = 0;

  for (const ev of events) {
    let divisions;
    try {
      divisions = (await apiFetch(`/events/${ev.id}/divisions`)).data;
    } catch {
      continue;
    }

    // Fetch matches for all divisions in parallel
    const divisionMatches = await Promise.all(
      divisions.map(async (div) => {
        const matches = await fetchAll(
          `/events/${ev.id}/divisions/${div.id}/matches`,
          { scored: 1 }
        );
        return matches.sort((a, b) => (a.round - b.round) || (a.matchnum - b.matchnum));
      })
    );

    const allMatches = divisionMatches.flat();
    matchCount += allMatches.length;

    for (const m of allMatches) {
      const red = m.alliances.find(a => a.color === 'red');
      const blue = m.alliances.find(a => a.color === 'blue');
      if (!red || !blue) continue;

      const redTeams = red.teams.filter(t => t.team).map(t => t.team.number);
      const blueTeams = blue.teams.filter(t => t.team).map(t => t.team.number);
      if (redTeams.length !== 2 || blueTeams.length !== 2) continue;

      const redRatings = redTeams.map(n => teamRatings.get(n) || new Rating());
      const blueRatings = blueTeams.map(n => teamRatings.get(n) || new Rating());

      const ranks =
        red.score > blue.score ? [0, 1] :
        red.score < blue.score ? [1, 0] : [0, 0];

      const [newRed, newBlue] = env.rate([redRatings, blueRatings], ranks);
      redTeams.forEach((n, i) => teamRatings.set(n, newRed[i]));
      blueTeams.forEach((n, i) => teamRatings.set(n, newBlue[i]));

      // Record history
      redTeams.forEach((n, i) => {
        let hist = teamHistory.get(n) || [];
        hist.push({
          match_id: m.id,
          scheduled: m.scheduled,
          mu: newRed[i].mu,
          sigma: newRed[i].sigma
        });
        teamHistory.set(n, hist);
      });
      blueTeams.forEach((n, i) => {
        let hist = teamHistory.get(n) || [];
        hist.push({
          match_id: m.id,
          scheduled: m.scheduled,
          mu: newBlue[i].mu,
          sigma: newBlue[i].sigma
        });
        teamHistory.set(n, hist);
      });

      processedMatches++;
      renderProgress(progressOffset + processedMatches, totalMatches);
    }
  }

  console.log(`\n  finished — teams rated: ${teamRatings.size}, matches processed: ${matchCount}`);
  return { teamCount: teamRatings.size, matchCount };
}

/********************************************************************
 *  Global compute — rates from High Stakes onwards
 *******************************************************************/
async function computeTrueSkills() {
  console.time('TrueSkill overall pass');
  teamRatings.clear();
  teamHistory.clear();

  const seasons = await fetchAll('/seasons', { program: PROGRAM_ID });
  const ordered = [...seasons].sort((a, b) => a.id - b.id); // oldest to newest

  const highStakesIndex = ordered.findIndex(s => s.name.includes('High Stakes'));
  if (highStakesIndex === -1) {
    throw new Error('High Stakes season not found');
  }

  const seasonsToRate = ordered.slice(highStakesIndex);

  // Precompute total matches for progress bar
  let totalMatches = 0;
  const matchCounts = [];
  for (const season of seasonsToRate) {
    const events = await fetchAll('/events', {
      'program[]': PROGRAM_ID,
      'season[]': season.id,
    });
    let seasonMatches = 0;
    for (const ev of events.slice(0, BATCH_SIZE)) { // Sample for estimation
      const divisions = (await apiFetch(`/events/${ev.id}/divisions`)).data;
      for (const div of divisions) {
        const matches = await fetchAll(`/events/${ev.id}/divisions/${div.id}/matches`, { scored: 1 });
        seasonMatches += matches.length;
      }
    }
    matchCounts.push(seasonMatches * (events.length / Math.min(events.length, BATCH_SIZE)));
    totalMatches += matchCounts[matchCounts.length - 1];
  }

  let progressOffset = 0;
  let totalTeams = 0;

  for (let i = 0; i < seasonsToRate.length; i++) {
    const season = seasonsToRate[i];
    try {
      const { teamCount, matchCount } = await rateSeason(season, totalMatches, progressOffset);
      if (teamCount) totalTeams = Math.max(totalTeams, teamCount);
      progressOffset += matchCount;
    } catch (e) {
      console.warn(`⚠ Season ${season.id} failed:`, e.message);
    }
  }

  if (teamHistory.size === 0) {
    throw new Error('No scored matches found in selected seasons');
  }

  // Store history to file
  const historyObj = Object.fromEntries(teamHistory);
  fs.writeFileSync('ratings_history.json', JSON.stringify(historyObj, null, 2));

  console.log(`\n✔ History stored for ${teamHistory.size} teams`);
  console.timeEnd('TrueSkill overall pass');
}

/********************************************************************
 *  Boot
 *******************************************************************/
initModules()
  .then(computeTrueSkills)
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });