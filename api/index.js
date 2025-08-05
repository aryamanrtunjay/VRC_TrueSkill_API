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

  const { query } = req;
  const path = query.path || [];

  try {
    // Route: /api/trueskill/:team
    if (path[0] === 'trueskill' && path[1]) {
      const teamName = path[1];
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

    // Route: /api/skills/:team
    if (path[0] === 'skills' && path[1]) {
      const teamName = path[1];
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

    // Route: /api/leaderboard/skills
    if (path[0] === 'leaderboard' && path[1] === 'skills') {
      const limit = parseInt(req.query.limit) || 50;
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

    // Route not found
    res.status(404).json({ error: 'Route not found' });

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Firebase error: ' + err.message });
  }
}
