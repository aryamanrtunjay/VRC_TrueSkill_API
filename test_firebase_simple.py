import json
import firebase_admin
from firebase_admin import credentials, firestore
import os

def initialize_firebase():
    """Initialize Firebase using environment variables"""
    
    # Clear any existing Firebase apps first
    for app in firebase_admin._apps.values():
        firebase_admin.delete_app(app)
    firebase_admin._apps.clear()
    
    try:
        if all(key in os.environ for key in ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']):
            print("Initializing Firebase with environment variables...")
            
            project_id = os.getenv('FIREBASE_PROJECT_ID')
            client_email = os.getenv('FIREBASE_CLIENT_EMAIL')
            raw_key = os.getenv('FIREBASE_PRIVATE_KEY', '')
            
            # Handle private key the same way as Node.js version
            private_key = raw_key.replace('\\n', '\n')
            
            # Remove quotes if they exist
            if private_key.startswith('"') and private_key.endswith('"'):
                private_key = private_key[1:-1]
            
            cred_dict = {
                'type': 'service_account',
                'project_id': project_id,
                'client_email': client_email,
                'private_key': private_key,
                'token_uri': 'https://oauth2.googleapis.com/token'
            }
            
            # Initialize with explicit project ID
            cred = credentials.Certificate(cred_dict)
            app = firebase_admin.initialize_app(cred, {
                'projectId': project_id
            })
            print(f"✅ Firebase initialized successfully for project: {project_id}")
            return firestore.client()
    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
    
    return None

def test_simple_update():
    """Test a simple Firestore update"""
    
    db = initialize_firebase()
    if not db:
        print("❌ Could not initialize Firebase")
        return False
    
    try:
        # Test with a simple document update
        test_doc_ref = db.collection('leaderboard').document('10B')
        
        print("🔍 Testing simple document update...")
        
        # Try to update with set + merge
        test_doc_ref.set({
            'ts2026': 1500.0,
            'test_timestamp': firestore.SERVER_TIMESTAMP
        }, merge=True)
        
        print("✅ Test update successful!")
        return True
        
    except Exception as e:
        print(f"❌ Test update failed: {e}")
        return False

if __name__ == "__main__":
    success = test_simple_update()
    if success:
        print("🎉 Firebase connection and update working!")
    else:
        print("❌ Firebase test failed")
