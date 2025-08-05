import admin from 'firebase-admin';

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

export default async function handler(req, res) {
  console.log('API called with method:', req.method);
  console.log('Environment variables present:', {
    projectId: !!process.env.FIREBASE_PROJECT_ID,
    clientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    databaseUrl: !!process.env.FIREBASE_DATABASE_URL
  });

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { team } = req.query;
  console.log('Team parameter:', team);

  if (!team) {
    res.status(400).json({ error: 'Team parameter is required' });
    return;
  }

  try {
    console.log('Attempting to fetch team data from Firestore...');
    const snapshot = await admin.firestore().collection('leaderboard').doc(team).get();
    console.log('Snapshot exists:', snapshot.exists);
    
    if (snapshot.exists) {
      const data = snapshot.data();
      console.log('Team data found:', Object.keys(data));
      res.json({
        teamNumber: team,
        skillScore: data.skillScore || 0,
        skillsRank: data.skillsRank || null,
        driverScore: data.driverScore || 0,
        progScore: data.progScore || 0
      });
    } else {
      res.status(404).json({ error: 'Team not found' });
    }
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Firebase error: ' + err.message });
  }
}
