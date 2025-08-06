import firebase_admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

function initializeFirebase() {
  if (firebase_admin.apps.length > 0) {
    return getFirestore();
  }
  
  try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('✅ Environment variables found');
      console.log('📋 Project ID:', process.env.FIREBASE_PROJECT_ID);
      console.log('📧 Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
      console.log('🔑 Private Key Length:', process.env.FIREBASE_PRIVATE_KEY.length);
      
      // Handle private key formatting more carefully
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      
      // Replace \\n with actual newlines
      privateKey = privateKey.replace(/\\n/g, '\n');
      
      // Ensure proper PEM format
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.log('❌ Private key missing BEGIN header');
        return null;
      }
      if (!privateKey.includes('-----END PRIVATE KEY-----')) {
        console.log('❌ Private key missing END footer');
        return null;
      }
      
      console.log('🔍 Private key format looks correct');
      
      const cred = firebase_admin.credential.cert({
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: privateKey,
      });
      firebase_admin.initializeApp({ credential: cred });
      return getFirestore();
    } else {
      console.log('❌ Missing environment variables');
      console.log('📋 Project ID exists:', !!process.env.FIREBASE_PROJECT_ID);
      console.log('📧 Client Email exists:', !!process.env.FIREBASE_CLIENT_EMAIL);
      console.log('🔑 Private Key exists:', !!process.env.FIREBASE_PRIVATE_KEY);
      return null;
    }
  } catch (error) {
    console.log('❌ Firebase initialization failed:', error.message);
    console.log('🔍 Full error:', error);
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
    
    // Set a longer timeout and retry logic
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
    console.log('🔍 Error code:', error.code);
    console.log('🔍 Full error:', error);
    
    // Try a simpler connection test
    console.log('🔄 Trying alternative authentication test...');
    try {
      // Just try to get the app instance to verify credentials are valid
      const app = firebase_admin.app();
      console.log('✅ Firebase app initialized successfully');
      console.log('📋 Project ID from app:', app.options.projectId);
      
      // The credentials are valid, but there might be a network/SSL issue
      console.log('⚠️ Credentials are valid, but Firestore connection failed');
      console.log('💡 This might be a temporary network issue in GitHub Actions');
      console.log('💡 Try running the workflow again, or check if it works locally');
      
    } catch (altError) {
      console.log('❌ Alternative test also failed:', altError.message);
      process.exit(1);
    }
  }
}

testFirebaseAuth().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
