import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const { player_id, statType, betLine, games } = req.query;

  if (!player_id || !statType || !betLine || !games) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  try {
    const betLineValue = parseFloat(betLine);
    const gameLimit = parseInt(games, 10);

    // Step 1: Fetch player stats (with minutes played and non-null stat)
    const { data: statsData, error: statsError } = await supabase
      .from('player_stats')
      .select(`game_id, game_date, min, ${statType}`)
      .eq('player_id', player_id)
      .neq('min', '00')
      .not(statType, 'is', null)
      .order('game_date', { ascending: false })
      .limit(gameLimit);

    if (statsError) {
      console.error("Supabase error in stats fetch:", statsError.message);
      return res.status(500).json({ error: 'Failed to fetch player stats.' });
    }

    if (!statsData || statsData.length === 0) {
      return res.status(404).json({ error: 'No valid games found.' });
    }

    const gameIds = statsData.map((g) => g.game_id);

    // Step 2: Fetch opponent team info
    const { data: gamesData, error: gamesError } = await supabase
      .from('games')
      .select('id, game_date, home_team_id, visitor_team_id, home_team_name, visitor_team_name')
      .in('id', gameIds);

    if (gamesError) {
      console.error("Supabase error in games fetch:", gamesError.message);
      return res.status(500).json({ error: 'Failed to fetch game data.' });
    }

    // Step 3: Merge stats and game info
    const chartData = statsData.map((stat) => {
      const game = gamesData.find((g) => g.id === stat.game_id);
      if (!game) return null;

      const isHomeGame = game.home_team_id === parseInt(player_id);
      const opponent = isHomeGame
        ? `vs ${game.visitor_team_name}`
        : `@ ${game.home_team_name}`;

      const statValue = stat[statType];

      return {
        game_date: game.game_date,
        opponent,
        stat_value: statValue,
        over_line: statValue >= betLineValue
      };
    }).filter((entry) => entry !== null);

    res.status(200).json(chartData);
  } catch (error) {
    console.error("Unhandled error in statChart:", error.message);
    return res.status(500).json({ error: 'Server error.' });
  }
}
