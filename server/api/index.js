import express from 'express';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'node:path';

const app = express();

app.use(express.json());

// Endpoint: GET /trueskill/:team
app.get('/trueskill/:team', (req, res) => {
  const teamName = req.params.team;
  const results = [];
  const csvPath = path.join(process.cwd(), 'leaderboard.csv');

  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (data) => {
      results.push(data);
    })
    .on('end', () => {
      const teamData = results.find(row => row.Team === teamName);
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
    })
    .on('error', (err) => {
      res.status(500).json({ error: 'Error reading leaderboard file: ' + err.message });
    });
});

export default app;