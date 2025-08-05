export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // API Documentation
  res.json({
    message: "VRC TrueSkill API",
    version: "1.0.0",
    endpoints: {
      "GET /api/skills/{team}": "Get skills data for a specific team",
      "GET /api/trueskill/{team}": "Get TrueSkill data for a specific team",
      "GET /api/leaderboard/skills?limit=50": "Get skills leaderboard"
    },
    examples: {
      skills: "/api/skills/1234A",
      trueskill: "/api/trueskill/1234A",
      leaderboard: "/api/leaderboard/skills?limit=25"
    },
    status: "Active"
  });
}
