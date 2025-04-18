export async function getHomeAwaySplit({ playerId, teamId, statType, supabase }) {
  try {
    // Step 1: Get all player stats with min, statType, team_id, and game_id
    const { data: statRows, error: statsError } = await supabase
      .from("player_stats")
      .select("game_id, min, team_id, " + statType)
      .eq("player_id", playerId);

    if (statsError) {
      return { error: statsError.message };
    }

    // Filter: min ≥ 10 and stat not null
    const validStats = (statRows || []).filter((g) => {
      const minutes = parseInt(g.min, 10);
      return !isNaN(minutes) && minutes >= 10 && g[statType] != null;
    });

    const gameIds = validStats.map((row) => row.game_id).filter(Boolean);

    if (!gameIds.length) {
      return { error: "No valid games found with game_id" };
    }

    // Step 2: Get home_team_id for those game IDs
    const { data: games, error: gameError } = await supabase
      .from("games")
      .select("id, home_team_id")
      .in("id", gameIds);

    if (gameError) {
      return { error: gameError.message };
    }

    const gameMap = Object.fromEntries(games.map((g) => [g.id, g.home_team_id]));

    // Step 3: Compare player's team_id in each stat row to the game's home_team_id
    const home = [];
    const away = [];

    for (const row of validStats) {
      const homeTeamId = gameMap[row.game_id];
      if (homeTeamId === undefined) continue;

      const isHome = row.team_id === homeTeamId;
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
