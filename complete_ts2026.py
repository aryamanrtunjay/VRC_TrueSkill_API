import pandas as pd
import numpy as np
from trueskill import Rating, rate, setup, global_env
from tqdm import tqdm
from collections import defaultdict
import json
import firebase_admin
from firebase_admin import credentials, firestore
import os

def initialize_firebase():
    if firebase_admin._apps:
        return firestore.client()
    
    try:
        if all(key in os.environ for key in ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']):
            print("Initializing Firebase with environment variables...")
            cred = credentials.Certificate({
                'type': 'service_account',
                'project_id': os.getenv('FIREBASE_PROJECT_ID'),
                'client_email': os.getenv('FIREBASE_CLIENT_EMAIL'),
                'private_key': os.getenv('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n'),
            })
            firebase_admin.initialize_app(cred)
            return firestore.client()
    except Exception as e:
        print(f"Environment variables method failed: {e}")
    
    try:
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
    
    return None

def calculate_and_save_ts2026():
    
    setup(mu=25.0, sigma=25.0/3, beta=25.0/6, tau=25.0/300, draw_probability=0.1)
    
    print("Loading matches data...")
    df_matches = pd.read_csv('matches.csv')
    df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])
    
    season_matches = df_matches[df_matches['season'].str.contains('2025-2026.*Push Back', na=False)]
    print(f"Found {len(season_matches)} matches for the 2025-2026 Push Back season")
    
    if len(season_matches) == 0:
        print("No matches found for the 2025-2026 Push Back season. Exiting.")
        return False
    
    teams = pd.unique(season_matches[['red1', 'red2', 'blue1', 'blue2']].stack().values)
    print(f"Found {len(teams)} unique teams in the current season")
    
    ratings = {team: Rating() for team in teams}
    
    print("Processing matches with TrueSkill...")
    for row in tqdm(season_matches.itertuples(), total=len(season_matches), desc="Processing matches"):
        if pd.isna(getattr(row, 'red1')) or pd.isna(getattr(row, 'red2')) or pd.isna(getattr(row, 'blue1')) or pd.isna(getattr(row, 'blue2')):
            continue
        
        red_team = [ratings[row.red1], ratings[row.red2]]
        blue_team = [ratings[row.blue1], ratings[row.blue2]]
        
        if row.red_score > row.blue_score:
            new_red_ratings, new_blue_ratings = rate([red_team, blue_team], ranks=[0, 1])
            ratings[row.red1], ratings[row.red2] = new_red_ratings
            ratings[row.blue1], ratings[row.blue2] = new_blue_ratings
        elif row.red_score < row.blue_score:
            new_blue_ratings, new_red_ratings = rate([blue_team, red_team], ranks=[0, 1])
            ratings[row.blue1], ratings[row.blue2] = new_blue_ratings
            ratings[row.red1], ratings[row.red2] = new_red_ratings
        else:
            new_red_ratings, new_blue_ratings = rate([red_team, blue_team], ranks=[0, 0])
            ratings[row.red1], ratings[row.red2] = new_red_ratings
            ratings[row.blue1], ratings[row.blue2] = new_blue_ratings
    
    ts2026_data = {}
    for team, rating in ratings.items():
        conservative_score = rating.mu - 3 * rating.sigma
        ts2026_data[team] = {
            'mu': round(rating.mu, 2),
            'sigma': round(rating.sigma, 2),
            'ts2026': round(conservative_score, 2)
        }
    
    with open('ts2026_ratings.json', 'w') as f:
        json.dump(ts2026_data, f, indent=2)
    
    print(f"TrueSkill ratings calculated for {len(ts2026_data)} teams")
    print("Backup saved to 'ts2026_ratings.json'")
    
    db = initialize_firebase()
    if not db:
        print("\nFirebase not configured. Ratings saved to JSON file only.")
        print("Please configure Firebase credentials and run update_firebase_ts2026.py to update the database.")
        return True
    
    print("\nFetching all teams from leaderboard collection...")
    leaderboard_docs = db.collection('leaderboard').stream()
    all_teams = set()
    for doc in leaderboard_docs:
        all_teams.add(doc.id)
    
    print(f"Found {len(all_teams)} teams in leaderboard collection")
    
    # Add base ratings for teams that haven't played matches this season
    base_rating = Rating()  # Default: mu=25, sigma=25/3
    base_conservative_score = base_rating.mu - 3 * base_rating.sigma
    
    teams_without_matches = all_teams - set(ts2026_data.keys())
    print(f"Adding base ts2026 rating ({round(base_conservative_score, 2)}) for {len(teams_without_matches)} teams without matches")
    
    for team in teams_without_matches:
        ts2026_data[team] = {
            'mu': round(base_rating.mu, 2),
            'sigma': round(base_rating.sigma, 2),
            'ts2026': round(base_conservative_score, 2)
        }
    
    print("\nUpdating Firestore documents with ts2026 field...")
    batch_size = 500
    batch = db.batch()
    count = 0
    updated_teams = 0
    
    for team, data in tqdm(ts2026_data.items(), desc="Updating Firebase"):
        try:
            doc_ref = db.collection('leaderboard').document(team)
            batch.update(doc_ref, {'ts2026': data['ts2026']})
            count += 1
            
            if count == batch_size:
                batch.commit()
                updated_teams += count
                batch = db.batch()
                count = 0
                
        except Exception as e:
            print(f"Error updating team {team}: {e}")
    
    if count > 0:
        try:
            batch.commit()
            updated_teams += count
        except Exception as e:
            print(f"Error committing final batch: {e}")
    
    print(f"\n✅ Successfully updated {updated_teams} teams with ts2026 TrueSkill ratings")
    
    sorted_teams = sorted(ts2026_data.items(), key=lambda x: x[1]['ts2026'], reverse=True)
    print("\nTop 10 teams by ts2026 rating:")
    for i, (team, data) in enumerate(sorted_teams[:10], 1):
        print(f"{i:2d}. {team}: {data['ts2026']}")
    
    return True

if __name__ == "__main__":
    success = calculate_and_save_ts2026()
    if success:
        print("\n🎉 TrueSkill calculation completed!")
    else:
        print("\n❌ TrueSkill calculation failed.")
