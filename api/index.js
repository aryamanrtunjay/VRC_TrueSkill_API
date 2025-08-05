import admin from 'firebase-admin';

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(part => part !== '');
  
  // Remove 'api' from the path parts if it exists
  if (pathParts[0] === 'api') {
    pathParts.shift();
  }

  try {
    // Route: /api/skills/:team
    if (pathParts[0] === 'skills' && pathParts[1]) {
      const teamName = pathParts[1];
      const snapshot = await admin.firestore().collection('leaderboard').doc(teamName).get();
      if (snapshot.exists) {
        const data = snapshot.data();
        res.json({
          teamNumber: teamName,
          skillScore: data.skillScore || 0,
          skillsRank: data.skillsRank || null,
          driverScore: data.driverScore || 0,
          progScore: data.progScore || 0
        });
      } else {
        res.status(404).json({ error: 'Team not found' });
      }
      return;
    }

    // Route: /api/trueskill/:team
    if (pathParts[0] === 'trueskill' && pathParts[1]) {
      const teamName = pathParts[1];
      const snapshot = await admin.firestore().collection('leaderboard').doc(teamName).get();
      if (snapshot.exists) {
        const data = snapshot.data();
        res.json({
          trueSkill: parseFloat(data.conservativeScore),
          trueSkillRanking: parseInt(data.rank),
          opr: parseFloat(data.opr),
          dpr: parseFloat(data.dpr),
          ccvm: parseFloat(data.ccvm),
          winPercentage: parseFloat(data.winPercentage),
          ts2026: data.ts2026 || 0.0
        });
      } else {
        res.status(404).json({ error: 'Team not found' });
      }
      return;
    }

    // Route: /api/leaderboard/skills
    if (pathParts[0] === 'leaderboard' && pathParts[1] === 'skills') {
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      const snapshot = await admin.firestore()
        .collection('leaderboard')
        .orderBy('skillsRank', 'asc')
        .limit(limit)
        .get();
      
      const teams = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.skillScore && data.skillScore > 0) {
          teams.push({
            teamNumber: doc.id,
            skillScore: data.skillScore,
            skillsRank: data.skillsRank,
            driverScore: data.driverScore || 0,
            progScore: data.progScore || 0
          });
        }
      });
      
      res.json(teams);
      return;
    }

    // Route: /api/test
    if (pathParts[0] === 'test') {
      res.json({
        message: "Test endpoint working!",
        timestamp: new Date().toISOString(),
        pathParts: pathParts,
        originalUrl: req.url,
        environment: {
          nodeVersion: process.version,
          hasFirebaseEnv: {
            projectId: !!process.env.FIREBASE_PROJECT_ID,
            clientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: !!process.env.FIREBASE_PRIVATE_KEY,
            databaseUrl: !!process.env.FIREBASE_DATABASE_URL
          }
        }
      });
      return;
    }

    // Default API documentation
    if (pathParts.length === 0) {
      res.json({
        message: "VRC TrueSkill API",
        version: "1.0.0",
        endpoints: {
          "GET /api/skills/{team}": "Get skills data for a specific team",
          "GET /api/trueskill/{team}": "Get TrueSkill data for a specific team",
          "GET /api/leaderboard/skills?limit=50": "Get skills leaderboard",
          "GET /api/test": "Test endpoint for debugging"
        },
        examples: {
          skills: "/api/skills/1234A",
          trueskill: "/api/trueskill/1234A",
          leaderboard: "/api/leaderboard/skills?limit=25",
          test: "/api/test"
        },
        status: "Active"
      });
      return;
    }

    // Route not found
    res.status(404).json({ 
      error: 'Route not found',
      path: pathParts,
      availableRoutes: ['skills/{team}', 'trueskill/{team}', 'leaderboard/skills', 'test']
    });

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Firebase error: ' + err.message });
  }
}
