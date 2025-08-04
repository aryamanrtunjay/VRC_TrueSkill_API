import pandas as pd
import numpy as np
from trueskill import Rating, rate, setup, global_env
from tqdm import tqdm
from collections import defaultdict
import firebase_admin
from firebase_admin import credentials, firestore
import os

try:
    if not firebase_admin._apps:
        cred = credentials.Certificate({
            'type': 'service_account',
            'project_id': os.getenv('FIREBASE_PROJECT_ID'),
            'client_email': os.getenv('FIREBASE_CLIENT_EMAIL'),
            'private_key': os.getenv('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n') if os.getenv('FIREBASE_PRIVATE_KEY') else None,
        })
        firebase_admin.initialize_app(cred)
except Exception as e:
    print(f"Firebase initialization with environment variables failed: {e}")
    print("Please ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables are set.")
    exit(1)

db = firestore.client()

setup(mu=25.0, sigma=25.0/3, beta=25.0/6, tau=25.0/300, draw_probability=0.1)

df_matches = pd.read_csv('matches.csv')
df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])

season_matches = df_matches[df_matches['season'].str.contains('2025-2026.*Push Back', na=False)]
print(f"Found {len(season_matches)} matches for the 2025-2026 Push Back season")

if len(season_matches) == 0:
    print("No matches found for the 2025-2026 Push Back season. Exiting.")
    exit(1)

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

print("Updating Firestore documents with ts2026 field...")
batch_size = 500
batch = db.batch()
count = 0
updated_teams = 0

for team, rating in tqdm(ratings.items(), desc="Updating Firestore"):
    doc_ref = db.collection('leaderboard').document(team)
    
    conservative_score = rating.mu - 3 * rating.sigma
    
    batch.update(doc_ref, {
        'ts2026': round(conservative_score, 2)
    })
    
    count += 1
    updated_teams += 1
    
    if count == batch_size:
        try:
            batch.commit()
            batch = db.batch()
            count = 0
        except Exception as e:
            print(f"Error committing batch: {e}")

if count > 0:
    try:
        batch.commit()
    except Exception as e:
        print(f"Error committing final batch: {e}")

print(f"Successfully updated {updated_teams} teams with ts2026 TrueSkill ratings")
print("TrueSkill ratings for 2025-2026 season saved to Firestore as 'ts2026' field")
