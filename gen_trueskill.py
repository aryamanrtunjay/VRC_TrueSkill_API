import pandas as pd
import numpy as np
from trueskill import Rating, rate, setup, global_env
from tqdm import tqdm
from collections import defaultdict
import firebase_admin
from firebase_admin import credentials, firestore
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr

# Initialize Firebase
cred = credentials.Certificate('../Keys/serviceAccountKey.json')  # Update path
firebase_admin.initialize_app(cred)
db = firestore.client()

# Configure TrueSkill environment
setup(mu=25.0, sigma=25.0/3, beta=25.0/6, tau=25.0/300, draw_probability=0.1)

# Load matches CSV
df_matches = pd.read_csv('matches.csv')
df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])

# Collect unique teams
teams = pd.unique(df_matches[['red1', 'red2', 'blue1', 'blue2']].stack().values)
ratings = {team: Rating() for team in teams}
team_to_idx = {team: i for i, team in enumerate(teams)}
n_teams = len(teams)

# Process matches with TrueSkill
for row in tqdm(df_matches.itertuples(), total=len(df_matches), desc="Processing matches with TrueSkill"):
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

# Compute win percentage
wins = defaultdict(int)
ties = defaultdict(int)
losses = defaultdict(int)
total_matches = defaultdict(int)

for row in df_matches.itertuples():
    red_teams = [row.red1, row.red2]
    blue_teams = [row.blue1, row.blue2]
    for team in red_teams + blue_teams:
        total_matches[team] += 1
    if row.red_score > row.blue_score:
        for team in red_teams: wins[team] += 1
        for team in blue_teams: losses[team] += 1
    elif row.blue_score > row.red_score:
        for team in blue_teams: wins[team] += 1
        for team in red_teams: losses[team] += 1
    else:
        for team in red_teams + blue_teams: ties[team] += 1

win_percentage = {team: ((wins[team] + 0.5 * ties[team]) / total_matches[team] * 100) if total_matches[team] > 0 else 0.0 for team in teams}

# Compute OPR and DPR using least squares with sparse matrix
m = len(df_matches) * 2
n = n_teams * 2
data = []
row_indices = []
col_indices = []
b_list = []
row_idx = 0

for row in df_matches.itertuples():
    r1_idx, r2_idx = team_to_idx[row.red1], team_to_idx[row.red2]
    b1_idx, b2_idx = team_to_idx[row.blue1], team_to_idx[row.blue2]
    
    # Red equation
    data.extend([1, 1, -1, -1])
    row_indices.extend([row_idx] * 4)
    col_indices.extend([r1_idx, r2_idx, n_teams + b1_idx, n_teams + b2_idx])
    b_list.append(row.red_score)
    row_idx += 1
    
    # Blue equation
    data.extend([1, 1, -1, -1])
    row_indices.extend([row_idx] * 4)
    col_indices.extend([b1_idx, b2_idx, n_teams + r1_idx, n_teams + r2_idx])
    b_list.append(row.blue_score)
    row_idx += 1

A = coo_matrix((data, (row_indices, col_indices)), shape=(row_idx, n)).tocsr()
b = np.array(b_list)
x = lsqr(A, b)[0]
oprs = x[:n_teams]
dprs = x[n_teams:]

opr_dict = dict(zip(teams, oprs))
dpr_dict = dict(zip(teams, dprs))
ccvm_dict = {team: opr_dict[team] - dpr_dict[team] for team in teams}

# Rank and save to Firestore in batches
leaderboard = sorted(ratings.items(), key=lambda x: x[1].mu - 3 * x[1].sigma, reverse=True)
batch_size = 500
batch = db.batch()
count = 0

for rank, (team, r) in enumerate(leaderboard, 1):
    doc_ref = db.collection('leaderboard').document(team)
    batch.set(doc_ref, {
        'rank': rank,
        'mu': round(r.mu, 2),
        'sigma': round(r.sigma, 2),
        'conservativeScore': round(r.mu - 3 * r.sigma, 2),
        'opr': round(opr_dict.get(team, 0), 2),
        'dpr': round(dpr_dict.get(team, 0), 2),
        'ccvm': round(ccvm_dict.get(team, 0), 2),
        'winPercentage': round(win_percentage.get(team, 0), 2)
    })
    count += 1
    if count == batch_size:
        batch.commit()
        batch = db.batch()
        count = 0

if count > 0:
    batch.commit()

print("Leaderboard saved to Firestore")