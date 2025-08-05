import firebase_admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

function initializeFirebase() {
  if (firebase_admin.apps.length > 0) {
    return getFirestore();
  }
  
  try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('✅ Environment variables found');
      const cred = firebase_admin.credential.cert({
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
      firebase_admin.initializeApp({ credential: cred });
      return getFirestore();
    } else {
      console.log('❌ Missing environment variables');
      return null;
    }
  } catch (error) {
    console.log('❌ Firebase initialization failed:', error.message);
    return null;
  }
}

async function testFirebaseAuth() {
  console.log('🔥 Testing Firebase authentication...');
  
  const db = initializeFirebase();
  
  if (!db) {
    console.log('❌ Firebase initialization failed');
    process.exit(1);
  }
  
  try {
    // Try to read a single document to test auth
    console.log('📡 Testing Firestore access...');
    const testRef = db.collection('leaderboard').limit(1);
    const snapshot = await testRef.get();
    
    console.log('✅ Firebase authentication successful!');
    console.log(`📊 Found ${snapshot.size} documents in leaderboard collection`);
    
    if (!snapshot.empty) {
      const firstDoc = snapshot.docs[0];
      console.log(`📝 Sample team: ${firstDoc.id}`);
    }
    
    console.log('🎉 Firebase is ready for skills data updates!');
    
  } catch (error) {
    console.log('❌ Firebase access failed:', error.message);
    process.exit(1);
  }
}

testFirebaseAuth().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
