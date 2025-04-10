export async function getHomeAwaySplit({ playerId, teamId, statType, supabase }) {
  try {
    console.log("🟡 [homeAwaySplit] Starting...");

    const { data: statRows, error: statsError } = await supabase
      .from("player_stats")
      .select("game_id, min, " + statType)
      .eq("player_id", playerId);

    if (statsError) {
      console.error("❌ [homeAwaySplit] Error fetching player_stats:", statsError.message);
      return { error: statsError.message };
    }

    const validStats = (statRows || []).filter((g) => {
      return g.min && parseInt(g.min, 10) >= 10 && g[statType] != null;
    });

    console.log("📊 [homeAwaySplit] Valid stat rows:", validStats.length);

    const gameIds = validStats.map((row) => row.game_id).filter(Boolean);

    console.log("📅 [homeAwaySplit] Game IDs:", gameIds);

    const { data: games, error: gameError } = await supabase
      .from("games")
      .select("id, home_team_id")
      .in("id", gameIds);

    if (gameError) {
      console.error("❌ [homeAwaySplit] Error fetching games:", gameError.message);
      return { error: gameError.message };
    }

    const gameMap = Object.fromEntries(games.map((g) => [g.id, g.home_team_id]));

    const home = [];
    const away = [];

    for (const row of validStats) {
      const isHome = gameMap[row.game_id] === teamId;
      if (isHome) {
        home.push(row[statType]);
      } else {
        away.push(row[statType]);
      }
    }

    console.log("🏠 [homeAwaySplit] Home values:", home);
    console.log("🛫 [homeAwaySplit] Away values:", away);

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
    console.error("❌ [homeAwaySplit] Unhandled error:", err.message);
    return { error: err.message };
  }
}
