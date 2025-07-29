import express from 'express';
import admin from 'firebase-admin';

const app = express();

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

app.use(express.json());

app.get('/trueskill/:team', async (req, res) => {
  const teamName = req.params.team;
  try {
    const snapshot = await admin.firestore().collection('leaderboard').doc(teamName).get();
    if (snapshot.exists) {
      const data = snapshot.data();
      res.json({
        trueSkill: parseFloat(data.conservativeScore),
        trueSkillRanking: parseInt(data.rank),
        opr: parseFloat(data.opr),
        dpr: parseFloat(data.dpr),
        ccvm: parseFloat(data.ccvm),
        winPercentage: parseFloat(data.winPercentage)
      });
    } else {
      res.status(404).json({ error: 'Team not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Firebase error: ' + err.message });
  }
});

export default app;