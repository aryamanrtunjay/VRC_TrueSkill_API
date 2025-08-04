import pandas as pd
import numpy as np
from trueskill import Rating, rate, setup, global_env
from tqdm import tqdm
from collections import defaultdict
import json

# Configure TrueSkill environment
setup(mu=25.0, sigma=25.0/3, beta=25.0/6, tau=25.0/300, draw_probability=0.1)

# Load matches CSV and filter for 2025-2026 Push Back season (ID 197)
print("Loading matches data...")
df_matches = pd.read_csv('matches.csv')
df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])

# Filter for the current season (2025-2026: Push Back)
season_matches = df_matches[df_matches['season'].str.contains('2025-2026.*Push Back', na=False)]
print(f"Found {len(season_matches)} matches for the 2025-2026 Push Back season")

if len(season_matches) == 0:
    print("No matches found for the 2025-2026 Push Back season. Exiting.")
    exit(1)

# Collect unique teams from this season only
teams = pd.unique(season_matches[['red1', 'red2', 'blue1', 'blue2']].stack().values)
print(f"Found {len(teams)} unique teams in the current season")

# Initialize ratings for all teams
ratings = {team: Rating() for team in teams}

# Process matches with TrueSkill for the current season only
print("Processing matches with TrueSkill...")
for row in tqdm(season_matches.itertuples(), total=len(season_matches), desc="Processing matches"):
    if pd.isna(getattr(row, 'red1')) or pd.isna(getattr(row, 'red2')) or pd.isna(getattr(row, 'blue1')) or pd.isna(getattr(row, 'blue2')):
        continue
    
    # Define alliances
    red_team = [ratings[row.red1], ratings[row.red2]]
    blue_team = [ratings[row.blue1], ratings[row.blue2]]
    
    # Rate the match (TrueSkill handles 2v2 natively)
    if row.red_score > row.blue_score:
        new_red_ratings, new_blue_ratings = rate([red_team, blue_team], ranks=[0, 1])  # Red wins (rank 0), Blue loses (rank 1)
        ratings[row.red1], ratings[row.red2] = new_red_ratings
        ratings[row.blue1], ratings[row.blue2] = new_blue_ratings
    elif row.red_score < row.blue_score:
        new_blue_ratings, new_red_ratings = rate([blue_team, red_team], ranks=[0, 1])  # Blue wins, Red loses
        ratings[row.blue1], ratings[row.blue2] = new_blue_ratings
        ratings[row.red1], ratings[row.red2] = new_red_ratings
    else:
        new_red_ratings, new_blue_ratings = rate([red_team, blue_team], ranks=[0, 0])  # Draw (same rank)
        ratings[row.red1], ratings[row.red2] = new_red_ratings
        ratings[row.blue1], ratings[row.blue2] = new_blue_ratings

# Calculate conservative scores and prepare data for export
ts2026_data = {}
for team, rating in ratings.items():
    conservative_score = rating.mu - 3 * rating.sigma
    ts2026_data[team] = {
        'mu': round(rating.mu, 2),
        'sigma': round(rating.sigma, 2),
        'ts2026': round(conservative_score, 2)
    }

# Sort by ts2026 score (highest first)
sorted_teams = sorted(ts2026_data.items(), key=lambda x: x[1]['ts2026'], reverse=True)

# Save to JSON file
with open('ts2026_ratings.json', 'w') as f:
    json.dump(ts2026_data, f, indent=2)

print(f"TrueSkill ratings calculated for {len(ts2026_data)} teams")
print("Ratings saved to 'ts2026_ratings.json'")
print("\nTop 10 teams by ts2026 rating:")
for i, (team, data) in enumerate(sorted_teams[:10], 1):
    print(f"{i:2d}. {team}: {data['ts2026']}")

print(f"\nRatings have been calculated and saved to ts2026_ratings.json")
print("You can now use these ratings to update your Firebase database.")
