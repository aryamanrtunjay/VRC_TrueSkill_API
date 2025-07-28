import pandas as pd
import numpy as np
from scipy.stats import norm
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr
from tqdm import tqdm
from collections import defaultdict

# TrueSkill parameters (defaults)
MU = 25.0
SIGMA = MU / 3
BETA = SIGMA / 2
TAU = SIGMA / 100
DRAW_PROB = 0.1  # Small draw probability for ties

# Gaussian functions
gaussian_pdf = norm.pdf
gaussian_cdf = norm.cdf

class Rating:
    def __init__(self, mu=MU, sigma=SIGMA):
        self.mu = mu
        self.sigma = sigma

def v_non_draw(t, e):
    return gaussian_pdf(t - e) / gaussian_cdf(t - e)

def w_non_draw(t, e):
    v = v_non_draw(t, e)
    return v * (v + t - e)

def v_draw(t, e):
    a = -e - t
    b = e - t
    den = gaussian_cdf(b) - gaussian_cdf(a)
    if den == 0:
        return 0
    return (gaussian_pdf(a) - gaussian_pdf(b)) / den

def w_draw(t, e):
    a = -e - t
    b = e - t
    den = gaussian_cdf(b) - gaussian_cdf(a)
    if den == 0:
        return 0
    pdf_a = gaussian_pdf(a)
    pdf_b = gaussian_pdf(b)
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

# Filter valid matches once
df_matches = df_matches.dropna(subset=['red1', 'red2', 'blue1', 'blue2'])

# Collect unique teams efficiently
teams = pd.unique(df_matches[['red1', 'red2', 'blue1', 'blue2']].stack().values)
team_to_idx = {team: i for i, team in enumerate(teams)}
n_teams = len(teams)

ratings = {team: Rating() for team in teams}

# Prepare for sparse matrix and counters
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

# Process matches in one loop using faster itertuples
for row in tqdm(df_matches.itertuples(), total=len(df_matches), desc="Processing matches"):
    red1 = ratings[row.red1]
    red2 = ratings[row.red2]
    blue1 = ratings[row.blue1]
    blue2 = ratings[row.blue2]
    
    if row.red_score > row.blue_score:
        outcome = 1
        wins[row.red1] += 1
        wins[row.red2] += 1
        losses[row.blue1] += 1
        losses[row.blue2] += 1
    elif row.red_score < row.blue_score:
        outcome = -1
        wins[row.blue1] += 1
        wins[row.blue2] += 1
        losses[row.red1] += 1
        losses[row.red2] += 1
    else:
        outcome = 0
        ties[row.red1] += 1
        ties[row.red2] += 1
        ties[row.blue1] += 1
        ties[row.blue2] += 1
    
    total_matches[row.red1] += 1
    total_matches[row.red2] += 1
    total_matches[row.blue1] += 1
    total_matches[row.blue2] += 1
    
    update_2v2(red1, red2, blue1, blue2, outcome)
    
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

# Build sparse matrix
A = coo_matrix((data, (row_indices, col_indices)), shape=(row_idx, n)).tocsr()
b = np.array(b_list)

# Solve least squares sparsely
x = lsqr(A, b)[0]
oprs = x[:n_teams]
dprs = x[n_teams:]

opr_dict = {teams[i]: oprs[i] for i in range(n_teams)}
dpr_dict = {teams[i]: dprs[i] for i in range(n_teams)}
ccvm_dict = {teams[i]: oprs[i] - dprs[i] for i in range(n_teams)}

# Compute win percentage
win_percentage = {}
for team in teams:
    total = total_matches[team]
    if total > 0:
        win_percentage[team] = ((wins[team] + 0.5 * ties[team]) / total) * 100
    else:
        win_percentage[team] = 0.0

# Rank by mu - 3*sigma (conservative rank)
leaderboard = sorted(ratings.items(), key=lambda x: x[1].mu - 3 * x[1].sigma, reverse=True)

# Prepare data for CSV
leaderboard_data = [
    {
        'Rank': rank,
        'Team': team,
        'Mu': round(r.mu, 2),
        'Sigma': round(r.sigma, 2),
        'Conservative Score': round(r.mu - 3 * r.sigma, 2),
        'OPR': round(opr_dict.get(team, 0), 2),
        'DPR': round(dpr_dict.get(team, 0), 2),
        'CCVM': round(ccvm_dict.get(team, 0), 2),
        'Win Percentage': round(win_percentage.get(team, 0), 2)
    }
    for rank, (team, r) in enumerate(leaderboard, 1)
]

# Create DataFrame and save to CSV
pd.DataFrame(leaderboard_data).to_csv('leaderboard.csv', index=False)
print("Leaderboard saved to leaderboard.csv")

# Display (optional, can remove for speed)
print("Team Leaderboard (TrueSkill Rating):")
for rank, (team, r) in enumerate(leaderboard, 1):
    print(f"Rank {rank}: Team {team} - Mu {r.mu:.2f}, Sigma {r.sigma:.2f}, Conservative Score {r.mu - 3*r.sigma:.2f}, OPR {opr_dict.get(team, 0):.2f}, DPR {dpr_dict.get(team, 0):.2f}, CCVM {ccvm_dict.get(team, 0):.2f}, Win Percentage {win_percentage.get(team, 0):.2f}%")