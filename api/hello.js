export default function handler(req, res) {
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
      "GET /api/skills?team={team}": "Get skills data for a specific team",
      "GET /api/trueskill?team={team}": "Get TrueSkill data for a specific team", 
      "GET /api/leaderboard?limit={number}": "Get skills leaderboard",
      "GET /api/hello": "API documentation and test endpoint"
    },
    examples: {
      skills: "/api/skills?team=1234A",
      trueskill: "/api/trueskill?team=1234A", 
      leaderboard: "/api/leaderboard?limit=25"
    },
    status: "Active",
    timestamp: new Date().toISOString()
  });
}
