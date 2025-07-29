import pandas as pd
import numpy as np
from scipy.stats import norm
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

# TrueSkill parameters (defaults)
MU = 25.0
SIGMA = MU / 3
BETA = SIGMA / 2
TAU = SIGMA / 100
DRAW_PROB = 0.1

# Define Rating class
class Rating:
    def __init__(self, mu=MU, sigma=SIGMA):
        self.mu = mu
        self.sigma = sigma

def v_non_draw(t, e):
    return norm.pdf(t - e) / norm.cdf(t - e)

def w_non_draw(t, e):
    v = v_non_draw(t, e)
    return v * (v + t - e)

def v_draw(t, e):
    a = -e - t
    b = e - t
    den = norm.cdf(b) - norm.cdf(a)
    if den == 0:
        return 0
    return (norm.pdf(a) - norm.pdf(b)) / den

def w_draw(t, e):
    a = -e - t
    b = e - t
    den = norm.cdf(b) - norm.cdf(a)
    if den == 0:
        return 0
    pdf_a = norm.pdf(a)
    pdf_b = norm.pdf(b)
    v = (pdf_a - pdf_b) / den
    term = (a * pdf_a - b * pdf_b) / den
    return v**2 - term

def update_2v2(red1, red2, blue1, blue2, outcome):
    # Outcome: 1 if red wins, -1 if blue wins, 0 if draw
    team1 = [red1, red2]
    team2 = [blue1, blue2]
    
    team1_mu = sum(r.mu for r in team1)
    team2_mu = sum(r.mu for r in team2)
    
    # Team performances variance
    c = np.sqrt(sum(r.sigma**2 for r in team1 + team2) + 4 * BETA**2)
    
    # Draw margin
    epsilon = np.sqrt(2) * BETA * norm.ppf(0.5 + DRAW_PROB / 2)
    
    if outcome == 0:
        delta_mu = team1_mu - team2_mu
        margin = epsilon
        sign = 1
    elif outcome == 1:
        delta_mu = team1_mu - team2_mu
        margin = 0
        sign = 1
    elif outcome == -1:
        delta_mu = team2_mu - team1_mu
        margin = 0
        sign = 1
        team1, team2 = team2, team1  # Swap so team1 is winner
    
    t = delta_mu / c
    e = margin / c
    
    if outcome != 0:
        v = v_non_draw(t, e)
        w = w_non_draw(t, e)
    else:
        v = v_draw(t, e)
        w = w_draw(t, e)
    
    # Update teams
    for r in team1:
        var_t = r.sigma**2 + TAU**2
        r.mu += sign * (var_t / c) * v
        r.sigma = np.sqrt(var_t * max(1 - (var_t / c**2) * w, 1e-9))  # Avoid negative sigma
    
    for r in team2:
        var_t = r.sigma**2 + TAU**2
        r.mu += -sign * (var_t / c) * v
        r.sigma = np.sqrt(var_t * max(1 - (var_t / c**2) * w, 1e-9))

# Load matches CSV
df_matches = pd.read_csv('matches.csv')
df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])

# Collect unique teams
teams = pd.unique(df_matches[['red1', 'red2', 'blue1', 'blue2']].stack().values)
team_to_idx = {team: i for i, team in enumerate(teams)}
n_teams = len(teams)

ratings = {team: Rating() for team in teams}

# Prepare for win percentage and sparse matrix
wins = defaultdict(int)
ties = defaultdict(int)
losses = defaultdict(int)
total_matches = defaultdict(int)

data = []
row_indices = []
col_indices = []
b_list = []
row_idx = 0
n = n_teams * 2

# Process matches in one loop
for row in tqdm(df_matches.itertuples(), total=len(df_matches), desc="Processing matches"):
    red1 = ratings[row.red1]
    red2 = ratings[row.red2]
    blue1 = ratings[row.blue1]
    blue2 = ratings[row.blue2]
    
    outcome = 1 if row.red_score > row.blue_score else -1 if row.red_score < row.blue_score else 0
    update_2v2(red1, red2, blue1, blue2, outcome)
    
    # Win percentage counters
    red_teams = [row.red1, row.red2]
    blue_teams = [row.blue1, row.blue2]
    for team in red_teams + blue_teams:
        total_matches[team] += 1
    if outcome == 1:
        for team in red_teams: wins[team] += 1
        for team in blue_teams: losses[team] += 1
    elif outcome == -1:
        for team in blue_teams: wins[team] += 1
        for team in red_teams: losses[team] += 1
    else:
        for team in red_teams + blue_teams: ties[team] += 1
    
    # Sparse matrix entries for OPR/DPR
    r1_idx = team_to_idx[row.red1]
    r2_idx = team_to_idx[row.red2]
    b1_idx = team_to_idx[row.blue1]
    b2_idx = team_to_idx[row.blue2]
    
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

# Build sparse matrix and solve
A = coo_matrix((data, (row_indices, col_indices)), shape=(row_idx, n)).tocsr()
b = np.array(b_list)
x = lsqr(A, b)[0]
oprs = x[:n_teams]
dprs = x[n_teams:]

opr_dict = dict(zip(teams, oprs))
dpr_dict = dict(zip(teams, dprs))
ccvm_dict = {team: opr_dict[team] - dpr_dict[team] for team in teams}

# Compute win percentage
win_percentage = {team: ((wins[team] + 0.5 * ties[team]) / total_matches[team] * 100) if total_matches[team] > 0 else 0.0 for team in teams}

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