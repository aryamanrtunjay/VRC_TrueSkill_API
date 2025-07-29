import express from 'express';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'node:path';

const app = express();
const csvCache = new Map();

function loadCSV() {
  return new Promise((resolve, reject) => {
    const csvPath = path.join(process.cwd(), 'leaderboard.csv');
    const results = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        results.forEach(row => csvCache.set(row.Team, row));
        resolve();
      })
      .on('error', reject);
  });
}

loadCSV().catch(err => console.error('CSV load error:', err));

app.use(express.json());

// Endpoint: GET /trueskill/:team
app.get('/trueskill/:team', (req, res) => {
  const teamName = req.params.team;
  if (!csvCache.size) {
    return res.status(503).json({ error: 'Service initializing, try again shortly' });
  }

  const teamData = csvCache.get(teamName);
  if (teamData) {
    res.json({
      trueSkill: parseFloat(teamData['Conservative Score']),
      trueSkillRanking: parseInt(teamData.Rank),
      opr: parseFloat(teamData.OPR),
      dpr: parseFloat(teamData.DPR),
      ccvm: parseFloat(teamData.CCVM),
      winPercentage: parseFloat(teamData['Win Percentage'])
    });
  } else {
    res.status(404).json({ error: 'Team not found' });
  }
});

export default app;