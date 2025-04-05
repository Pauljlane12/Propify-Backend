// pointsInsights.js

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #1: Last 10 Game Hit Rate (Points + Rebounds > Line)
// (Your script is actually checking points > line, so we keep it as-is)
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_1_LAST_10_GAME_HIT_RATE = `
SELECT
  COUNT(*) FILTER (WHERE g.pts > :line) AS over_hits,
  COUNT(*) AS total_games,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(
      COUNT(*) FILTER (WHERE g.pts > :line) * 100.0 / COUNT(*),
      1
    )
  END AS hit_rate_percent
FROM (
  SELECT
    ps.pts,
    CAST(ps.min AS INTEGER) AS min_played
  FROM player_stats ps
  JOIN players p ON ps.player_id = p.player_id
  WHERE TRIM(LOWER(p.first_name)) = :firstName
    AND TRIM(LOWER(p.last_name)) = :lastName
    AND ps.pts IS NOT NULL
    AND ps.min IS NOT NULL
    AND ps.min ~ '^[0-9]+$'
    AND CAST(ps.min AS INTEGER) >= 10
  ORDER BY ps.game_date DESC
  LIMIT 10
) AS g;
`;

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #2: Season Average vs Last 3 Games
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_2_SEASON_AVG_VS_LAST_3 = `
WITH last_three AS (
  SELECT ps.pts
  FROM player_stats ps
  JOIN players p ON ps.player_id = p.player_id
  WHERE TRIM(LOWER(p.first_name)) = :firstName
    AND TRIM(LOWER(p.last_name)) = :lastName
    AND ps.pts IS NOT NULL
    AND ps.min IS NOT NULL
    AND ps.min ~ '^[0-9]+$'
    AND CAST(ps.min AS INTEGER) >= 10
  ORDER BY ps.game_date DESC
  LIMIT 3
)
SELECT
  ROUND((SELECT AVG(pts) FROM last_three), 1) AS avg_last_3_games,
  ROUND(AVG(ps.pts), 1) AS season_avg
FROM player_stats ps
JOIN players p ON ps.player_id = p.player_id
WHERE TRIM(LOWER(p.first_name)) = :firstName
  AND TRIM(LOWER(p.last_name)) = :lastName
  AND ps.pts IS NOT NULL
  AND ps.min IS NOT NULL
  AND ps.min ~ '^[0-9]+$'
  AND CAST(ps.min AS INTEGER) >= 10;
`;

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #3: Team Defense vs PGs
// (Originally locked to 'Miami Heat', now we use :defenseTeamName as a placeholder)
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_3_TEAM_DEFENSE_VS_PGS = `
WITH all_teams AS (
  SELECT id, full_name FROM teams
),
pg_stats AS (
  SELECT
    bs.player_id,
    ap.true_position,
    bs.pts,
    bs.team_id,
    g.id AS game_id,
    g.date AS game_date,
    CASE
      WHEN bs.team_id = g.home_team_id THEN g.visitor_team_id
      ELSE g.home_team_id
    END AS defense_team_id
  FROM box_scores bs
  JOIN active_players ap ON bs.player_id = ap.player_id
  JOIN games g ON bs.game_date = g.date
    AND bs.team_id IN (g.home_team_id, g.visitor_team_id)
  WHERE ap.true_position = 'PG'
    AND bs.pts IS NOT NULL
),
pg_points_by_game AS (
  SELECT
    defense_team_id,
    game_id,
    SUM(pts) AS total_pg_pts
  FROM pg_stats
  GROUP BY defense_team_id, game_id
),
pg_defense_by_team AS (
  SELECT
    t.full_name AS defense_team,
    COUNT(pg.game_id) AS games_sampled,
    ROUND(AVG(total_pg_pts), 2) AS avg_pg_pts_allowed,
    RANK() OVER (ORDER BY AVG(total_pg_pts) ASC) AS rank
  FROM pg_points_by_game pg
  JOIN teams t ON pg.defense_team_id = t.id
  GROUP BY t.full_name
)
SELECT *
FROM pg_defense_by_team
WHERE defense_team = :defenseTeamName;  -- e.g. 'Miami Heat'
`;

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #5: Home vs Away Performance
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_5_HOME_VS_AWAY = `
SELECT
  CASE
    WHEN g.home_team_id = ps.team_id THEN 'Home'
    ELSE 'Away'
  END AS location,
  ROUND(AVG(ps.pts), 2) AS avg_points
FROM player_stats ps
JOIN players p ON ps.player_id = p.player_id
JOIN games g ON ps.game_id = g.id
WHERE TRIM(LOWER(p.first_name)) = :firstName
  AND TRIM(LOWER(p.last_name)) = :lastName
  AND ps.pts IS NOT NULL
  AND ps.min ~ '^[0-9]+$'
  AND CAST(ps.min AS INTEGER) >= 10
GROUP BY location;
`;

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #6: Matchup History vs Specific Opponent
// (Originally locked to abbreviation='MIA', now uses :opponentAbbrev)
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_6_MATCHUP_HISTORY = `
SELECT
  ps.game_date,
  CONCAT(ht.abbreviation, ' vs ', vt.abbreviation) AS matchup,
  ps.pts AS points_scored
FROM player_stats ps
JOIN players p ON ps.player_id = p.player_id
JOIN games g ON ps.game_id = g.id
JOIN teams ht ON g.home_team_id = ht.id
JOIN teams vt ON g.visitor_team_id = vt.id
WHERE TRIM(LOWER(p.first_name)) = :firstName
  AND TRIM(LOWER(p.last_name)) = :lastName
  AND (
    g.home_team_id = (SELECT id FROM teams WHERE abbreviation = :opponentAbbrev)
    OR g.visitor_team_id = (SELECT id FROM teams WHERE abbreviation = :opponentAbbrev)
  )
  AND ps.pts IS NOT NULL
ORDER BY ps.game_date DESC;
`;

////////////////////////////////////////////////////////////////////////////////
// INSIGHT #7: Injury Report – Key Player Absences
// (Originally locked to t.abbreviation='LAL', we can parameterize it or keep it?)
////////////////////////////////////////////////////////////////////////////////
export const INSIGHT_7_INJURY_REPORT = `
SELECT
  pi.player_id,
  pi.first_name || ' ' || pi.last_name AS player_name,
  pi.position,
  pi.status,
  pi.return_date,
  pi.description
FROM player_injuries pi
JOIN teams t ON pi.team_id = t.id
WHERE t.abbreviation = :teamAbbrev  -- e.g. 'LAL'
  AND NOT EXISTS (
    SELECT 1
    FROM player_stats ps
    WHERE ps.player_id = pi.player_id
      AND ps.game_date >= TO_DATE(pi.return_date || ' 2025', 'Mon DD YYYY')
  );
`;

////////////////////////////////////////////////////////////////////////////////
// ADVANCED METRIC #1: Projected Game Pace (Two-Team Average)
// (Originally locked to 'LAL' vs 'MIA', now param-based)
////////////////////////////////////////////////////////////////////////////////
export const ADV_METRIC_1_PROJECTED_GAME_PACE = `
WITH team_possessions AS (
  SELECT
    bs.team_id,
    g.id AS game_id,
    g.date AS game_date,
    SUM(bs.fga) +
    0.44 * SUM(bs.fta) -
    SUM(bs.oreb) +
    SUM(bs.turnover) AS possessions
  FROM box_scores bs
  JOIN games g ON bs.game_date = g.date
  WHERE g.status = 'Final'
  GROUP BY bs.team_id, g.id, g.date
),
avg_team_pace AS (
  SELECT
    tp.team_id,
    t.abbreviation,
    COUNT(*) AS games_sampled,
    ROUND(AVG(tp.possessions), 2) AS avg_possessions_per_game
  FROM team_possessions tp
  JOIN teams t ON tp.team_id = t.id
  GROUP BY tp.team_id, t.abbreviation
)
SELECT
  l.abbreviation AS team_1,
  r.abbreviation AS team_2,
  ROUND((l.avg_possessions_per_game + r.avg_possessions_per_game) / 2, 2) AS projected_game_pace
FROM avg_team_pace l
JOIN avg_team_pace r
  ON l.abbreviation = :team1Abbrev  -- e.g. 'LAL'
  AND r.abbreviation = :team2Abbrev -- e.g. 'MIA'
`;

////////////////////////////////////////////////////////////////////////////////
// ADVANCED METRIC #2: Team Pace Rankings
// (Originally locked to 'MIA' - now use :teamAbbrev)
////////////////////////////////////////////////////////////////////////////////
export const ADV_METRIC_2_TEAM_PACE_RANK = `
WITH team_possessions AS (
  SELECT
    bs.team_id,
    g.id AS game_id,
    g.date AS game_date,
    SUM(bs.fga) +
    0.44 * SUM(bs.fta) -
    SUM(bs.oreb) +
    SUM(bs.turnover) AS possessions
  FROM box_scores bs
  JOIN games g ON bs.game_date = g.date
  WHERE g.status = 'Final'
  GROUP BY bs.team_id, g.id, g.date
),
avg_team_pace AS (
  SELECT
    tp.team_id,
    t.abbreviation,
    COUNT(DISTINCT tp.game_id) AS games_sampled,
    ROUND(AVG(tp.possessions), 2) AS avg_possessions_per_game,
    RANK() OVER (ORDER BY AVG(tp.possessions) DESC) AS pace_rank
  FROM team_possessions tp
  JOIN teams t ON tp.team_id = t.id
  GROUP BY tp.team_id, t.abbreviation
)
SELECT
  pace_rank,
  avg_possessions_per_game
FROM avg_team_pace
WHERE abbreviation = :teamAbbrev;  -- e.g. 'MIA'
`;

////////////////////////////////////////////////////////////////////////////////
// ADVANCED METRIC #3: PG Points Allowed by [Heat] – Last 5 Games
// (Hard-coded to 'Miami Heat', now uses :opponentFullName if needed)
////////////////////////////////////////////////////////////////////////////////
export const ADV_METRIC_3_PG_POINTS_ALLOWED_LAST_5 = `
WITH heat_id AS (
  SELECT id
  FROM teams
  WHERE full_name = :opponentFullName  -- e.g. 'Miami Heat'
),
heat_last_5_games AS (
  SELECT id AS game_id, date AS game_date, home_team_id, visitor_team_id
  FROM games
  WHERE status = 'Final'
    AND (home_team_id = (SELECT id FROM heat_id)
         OR visitor_team_id = (SELECT id FROM heat_id))
  ORDER BY date DESC
  LIMIT 5
),
opposing_pg_stats AS (
  SELECT
    bs.player_id,
    ap.true_position,
    bs.pts,
    bs.min,
    g.id AS game_id,
    g.date AS game_date,
    bs.team_id AS offense_team_id
  FROM box_scores bs
  JOIN active_players ap ON bs.player_id = ap.player_id
  JOIN games g ON bs.game_date = g.date
              AND bs.team_id IN (g.home_team_id, g.visitor_team_id)
  WHERE ap.true_position = 'PG'
    AND bs.pts IS NOT NULL
    AND g.id IN (SELECT game_id FROM heat_last_5_games)
    AND bs.team_id != (SELECT id FROM heat_id)
),
pg_pts_per_game AS (
  SELECT
    g.game_id,
    g.game_date,
    SUM(COALESCE(p.pts, 0)) AS total_pg_pts
  FROM heat_last_5_games g
  LEFT JOIN opposing_pg_stats p ON p.game_id = g.game_id
  GROUP BY g.game_id, g.game_date
),
final AS (
  SELECT
    :opponentFullName AS defense_team,
    COUNT(*) AS games_sampled,
    ROUND(AVG(total_pg_pts), 2) AS avg_pg_pts_allowed_last_5
  FROM pg_pts_per_game
)
SELECT *
FROM final;
`;
