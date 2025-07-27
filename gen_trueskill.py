import pandas as pd
import numpy as np
from scipy.stats import norm
from tqdm import tqdm

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

# Load CSV
df = pd.read_csv('matches.csv')

# Collect unique teams
teams = set(df[['red1', 'red2', 'blue1', 'blue2']].values.flatten())
ratings = {team: Rating() for team in teams if pd.notna(team)}

# Process matches with progress bar
for _, row in tqdm(df.iterrows(), total=len(df), desc="Processing matches"):
    if pd.isna(row['red1']) or pd.isna(row['red2']) or pd.isna(row['blue1']) or pd.isna(row['blue2']):
        continue
    red1, red2, blue1, blue2 = ratings[row['red1']], ratings[row['red2']], ratings[row['blue1']], ratings[row['blue2']]
    if row['red_score'] > row['blue_score']:
        outcome = 1
    elif row['red_score'] < row['blue_score']:
        outcome = -1
    else:
        outcome = 0
    update_2v2(red1, red2, blue1, blue2, outcome)

# Rank by mu - 3*sigma (conservative rank)
leaderboard = sorted(ratings.items(), key=lambda x: x[1].mu - 3 * x[1].sigma, reverse=True)

# Prepare data for CSV
leaderboard_data = []
for rank, (team, r) in enumerate(leaderboard, 1):
    leaderboard_data.append({
        'Rank': rank,
        'Team': team,
        'Mu': round(r.mu, 2),
        'Sigma': round(r.sigma, 2),
        'Conservative Score': round(r.mu - 3 * r.sigma, 2)
    })

# Create DataFrame and save to CSV
leaderboard_df = pd.DataFrame(leaderboard_data)
leaderboard_df.to_csv('leaderboard.csv', index=False)
print("Leaderboard saved to leaderboard.csv")

# Display
print("Team Leaderboard (TrueSkill Rating):")
for rank, (team, r) in enumerate(leaderboard, 1):
    print(f"Rank {rank}: Team {team} - Mu {r.mu:.2f}, Sigma {r.sigma:.2f}, Conservative Score {r.mu - 3*r.sigma:.2f}")