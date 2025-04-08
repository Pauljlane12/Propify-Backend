// /api/next-game-insights.js
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

// Hardcode your Supabase credentials if you want, or read from ENV
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Postgres pool (if you prefer direct pg for final snippet queries)
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_CONNECTION_STRING,
});

// Hardcoded snippet #1: Last 5 Games vs Position
const LAST_5_GAMES_TEMPLATE = `
WITH team_id AS (
  SELECT id FROM teams WHERE full_name = 'TEAM_FULL_NAME'
),
team_last_5_games AS (
  SELECT g.id AS game_id, g.date AS game_date, g.home_team_id, g.visitor_team_id
  FROM games g
  WHERE g.status = 'Final'
    AND (
      g.home_team_id = (SELECT id FROM team_id)
      OR g.visitor_team_id = (SELECT id FROM team_id)
    )
  ORDER BY g.date DESC
  LIMIT 5
),
opposing_stats AS (
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
  JOIN games g ON g.date = bs.game_date
    AND (g.home_team_id = bs.team_id OR g.visitor_team_id = bs.team_id)
  WHERE ap.true_position = 'POSITION_PLACEHOLDER'
    AND bs.pts IS NOT NULL
    AND g.id IN (SELECT game_id FROM team_last_5_games)
    AND bs.team_id != (SELECT id FROM team_id)
),
stats_by_game AS (
  SELECT
    t.game_id,
    t.game_date,
    SUM(COALESCE(t.pts, 0)) AS total_pts
  FROM team_last_5_games g
  LEFT JOIN opposing_stats t ON t.game_id = g.game_id
  GROUP BY t.game_id, t.game_date
),
final AS (
  SELECT
    'TEAM_FULL_NAME' AS defense_team,
    COUNT(*) AS games_sampled,
    ROUND(AVG(total_pts), 2) AS avg_pts_allowed_last_5
  FROM stats_by_game
)
SELECT * FROM final;
`;

// Hardcoded snippet #2: Matchup History vs Opponent
const MATCHUP_TEMPLATE = `
SELECT
  ps.game_date,
  CONCAT(ht.abbreviation, ' vs ', vt.abbreviation) AS matchup,
  ps.pts AS points_scored
FROM player_stats ps
JOIN players p ON ps.player_id = p.player_id
JOIN games g ON ps.game_id = g.id
JOIN teams ht ON g.home_team_id = ht.id
JOIN teams vt ON g.visitor_team_id = vt.id
WHERE TRIM(LOWER(p.first_name)) = 'PLAYER_FIRST'
  AND TRIM(LOWER(p.last_name)) = 'PLAYER_LAST'
  AND (
    g.home_team_id = (
      SELECT id FROM teams WHERE abbreviation = 'TEAM_ABBR'
    )
    OR g.visitor_team_id = (
      SELECT id FROM teams WHERE abbreviation = 'TEAM_ABBR'
    )
  )
  AND ps.pts IS NOT NULL
ORDER BY ps.game_date DESC;
`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { playerName } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Missing playerName in request body.' });
  }

  try {
    // 1. Parse the user's requested player name
    const [firstName, ...lastParts] = playerName.trim().split(' ');
    const lastName = lastParts.join(' ');

    // 2. Look up the player in 'players' or 'active_players' to find their team_id + position
    const { data: playerRow, error: plErr } = await supabase
      .from('players')
      .select('player_id, team_id')
      .ilike('first_name', `%${firstName}%`)
      .ilike('last_name', `%${lastName}%`)
      .maybeSingle();

    if (plErr) throw plErr;
    if (!playerRow) {
      return res.status(404).json({ error: 'Player not found in players table.' });
    }

    const { player_id, team_id } = playerRow;

    // 3. Find the player's true_position from 'active_players'
    const { data: activeRow, error: acErr } = await supabase
      .from('active_players')
      .select('true_position')
      .eq('player_id', player_id)
      .maybeSingle();

    if (acErr) throw acErr;
    const playerPosition = activeRow?.true_position || 'PG'; // fallback to PG

    // 4. Find the player's next scheduled game -> see the opponent
    const todayIso = new Date().toISOString();
    const { data: upcomingGame, error: upErr } = await supabase
      .from('games')
      .select('id, date, home_team_id, visitor_team_id')
      .gt('date', todayIso)
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (upErr) throw upErr;
    if (!upcomingGame) {
      return res.status(200).json({
        message: 'No upcoming games found for this player. Cannot get advanced stats.',
      });
    }

    // Next game found - determine the opponent
    const { home_team_id, visitor_team_id } = upcomingGame;
    const opponentTeamId = (home_team_id === team_id) ? visitor_team_id : home_team_id;

    // 5. Look up the opponent's full_name + abbreviation
    const { data: oppTeam, error: otErr } = await supabase
      .from('teams')
      .select('full_name, abbreviation')
      .eq('id', opponentTeamId)
      .maybeSingle();

    if (otErr) throw otErr;
    if (!oppTeam) {
      return res.status(200).json({
        message: 'Opponent team not found in teams table. Cannot get advanced stats.',
      });
    }

    const { full_name: oppFullName, abbreviation: oppAbbr } = oppTeam;

    // 6. Now we run two snippet-based queries:
    //    A) Last 5 Games vs Position for the OPponent
    //    B) Matchup History for the player vs that OPponent

    // => A) Last 5 Games vs Position
    let last5SQL = LAST_5_GAMES_TEMPLATE
      .replace(/TEAM_FULL_NAME/g, oppFullName)
      .replace('POSITION_PLACEHOLDER', playerPosition);

    // => B) Matchup History
    let matchupSQL = MATCHUP_TEMPLATE
      .replace('PLAYER_FIRST', firstName.toLowerCase())
      .replace('PLAYER_LAST', lastName.toLowerCase())
      .replace(/TEAM_ABBR/g, oppAbbr);

    // 7. Query Postgres for each snippet
    const { rows: last5Rows } = await pool.query(last5SQL);
    const { rows: matchupRows } = await pool.query(matchupSQL);

    // 8. Return combined data
    return res.status(200).json({
      playerName,
      nextOpponent: oppTeam,
      playerPosition,
      last5Defense: last5Rows,
      matchupHistory: matchupRows,
    });

  } catch (err) {
    console.error('❌ next-game-insights error:', err);
    return res.status(500).json({ error: err.message });
  }
};
