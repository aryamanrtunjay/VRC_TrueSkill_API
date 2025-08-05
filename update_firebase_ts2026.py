import json
import firebase_admin
from firebase_admin import credentials, firestore
import os
from tqdm import tqdm

def initialize_firebase():
    """Initialize Firebase using environment variables or service account key"""
    if firebase_admin._apps:
        return firestore.client()
    
    try:
        # Method 1: Try environment variables (like your server)
        if all(key in os.environ for key in ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']):
            print("Initializing Firebase with environment variables...")
            
            # Debug: show all environment variables
            project_id = os.getenv('FIREBASE_PROJECT_ID')
            client_email = os.getenv('FIREBASE_CLIENT_EMAIL')
            raw_key = os.getenv('FIREBASE_PRIVATE_KEY', '')
            
            print(f"Project ID: {project_id}")
            print(f"Client Email: {client_email}")
            print(f"Raw private key length: {len(raw_key)}")
            print(f"Raw private key starts with: {raw_key[:50]}...")
            print(f"Raw private key ends with: ...{raw_key[-50:]}")
            
            # Handle private key the same way as Node.js version
            private_key = raw_key.replace('\\n', '\n')
            
            # Remove quotes if they exist
            if private_key.startswith('"') and private_key.endswith('"'):
                private_key = private_key[1:-1]
                print("Removed surrounding quotes from private key")
            
            print(f"Final Project ID: {project_id}")
            print(f"Final Client Email: {client_email}")
            print(f"Processed private key starts with: {private_key[:50]}...")
            print(f"Processed private key ends with: ...{private_key[-50:]}")
            
            cred_dict = {
                'type': 'service_account',
                'project_id': project_id,
                'client_email': client_email,
                'private_key': private_key,
                'token_uri': 'https://oauth2.googleapis.com/token'
            }
            
            print(f"Credential dict project_id: {cred_dict['project_id']}")
            
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
            return firestore.client()
    except Exception as e:
        print(f"Environment variables method failed: {e}")
    
    try:
        # Method 2: Try service account key file
        key_paths = [
            '../Keys/serviceAccountKey.json',
            './serviceAccountKey.json',
            './firebase-key.json'
        ]
        
        for key_path in key_paths:
            if os.path.exists(key_path):
                print(f"Initializing Firebase with key file: {key_path}")
                cred = credentials.Certificate(key_path)
                firebase_admin.initialize_app(cred)
                return firestore.client()
    except Exception as e:
        print(f"Service account key file method failed: {e}")
    
    print("Firebase initialization failed. Please ensure you have:")
    print("1. Environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY")
    print("2. OR a service account key file in one of these locations:")
    print("   - ../Keys/serviceAccountKey.json")
    print("   - ./serviceAccountKey.json") 
    print("   - ./firebase-key.json")
    return None

def update_firebase_with_ts2026():
    """Update Firebase documents with ts2026 field"""
    
    # Initialize Firebase
    db = initialize_firebase()
    if not db:
        return False
    
    # Load the calculated ratings
    try:
        with open('ts2026_ratings.json', 'r') as f:
            ratings_data = json.load(f)
    except FileNotFoundError:
        print("Error: ts2026_ratings.json not found. Please run calc_ts2026.py first.")
        return False
    
    print(f"Loaded ratings for {len(ratings_data)} teams")
    
    # Update Firestore in batches
    batch_size = 500
    batch = db.batch()
    count = 0
    updated_teams = 0
    failed_teams = []
    
    print("Updating Firestore documents with ts2026 field...")
    
    for team, data in tqdm(ratings_data.items(), desc="Updating teams"):
        try:
            doc_ref = db.collection('leaderboard').document(team)
            
            # Update the document with the new ts2026 field
            batch.update(doc_ref, {
                'ts2026': data['ts2026']
            })
            
            count += 1
            
            # Commit batch when it reaches the size limit
            if count == batch_size:
                try:
                    batch.commit()
                    updated_teams += count
                    batch = db.batch()
                    count = 0
                except Exception as e:
                    print(f"Error committing batch: {e}")
                    failed_teams.extend([team for team in list(ratings_data.keys())[updated_teams:updated_teams+count]])
                    batch = db.batch()
                    count = 0
                    
        except Exception as e:
            print(f"Error preparing update for team {team}: {e}")
            failed_teams.append(team)
    
    # Commit any remaining updates
    if count > 0:
        try:
            batch.commit()
            updated_teams += count
        except Exception as e:
            print(f"Error committing final batch: {e}")
            failed_teams.extend([team for team in list(ratings_data.keys())[-count:]])
    
    print(f"\nUpdate Summary:")
    print(f"✅ Successfully updated: {updated_teams} teams")
    print(f"❌ Failed updates: {len(failed_teams)} teams")
    
    if failed_teams:
        print("Failed teams:", failed_teams[:10])  # Show first 10 failed teams
        if len(failed_teams) > 10:
            print(f"... and {len(failed_teams) - 10} more")
    
    return updated_teams > 0

if __name__ == "__main__":
    success = update_firebase_with_ts2026()
    if success:
        print("\n🎉 TrueSkill ratings for 2025-2026 season successfully saved to Firestore as 'ts2026' field!")
    else:
        print("\n❌ Failed to update Firebase. Please check your credentials and try again.")
