export async function getHomeAwaySplit({ playerId, teamId, statType, supabase }) {
  try {
    // Step 1: Get all player stats with min + statType + game_id
    const { data: statRows, error: statsError } = await supabase
      .from("player_stats")
      .select("game_id, min, " + statType)
      .eq("player_id", playerId);

    if (statsError) {
      return { error: statsError.message };
    }

    // Filter: min ≥ 10 and stat not null
    const validStats = (statRows || []).filter((g) => {
      return g.min && parseInt(g.min, 10) >= 10 && g[statType] != null;
    });

    const gameIds = validStats.map((row) => row.game_id).filter(Boolean);

    if (!gameIds.length) {
      return { error: "No valid games found with game_id" };
    }

    // Step 2: Get game info for those game IDs
    const { data: games, error: gameError } = await supabase
      .from("games")
      .select("id, home_team_id")
      .in("id", gameIds);

    if (gameError) {
      return { error: gameError.message };
    }

    const gameMap = Object.fromEntries(games.map((g) => [g.id, g.home_team_id]));

    // Step 3: Split into home/away based on team_id
    const home = [];
    const away = [];

    for (const row of validStats) {
      const isHome = gameMap[row.game_id] === teamId;
      (isHome ? home : away).push(row[statType]);
    }

    const avg = (arr) =>
      arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;

    return {
      statType,
      homeAvg: avg(home),
      awayAvg: avg(away),
      homeGames: home.length,
      awayGames: away.length,
    };
  } catch (err) {
    return { error: err.message };
  }
}
