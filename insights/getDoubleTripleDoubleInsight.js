import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getDoubleTripleDoubleInsight({ playerId, supabase }) {
  const statColumns = ["pts", "reb", "ast"];
  const columnList = ["game_id", "game_date", "min", ...statColumns].join(", ");

  const currentSeason = await getMostRecentSeason(supabase);
  const previousSeason = currentSeason - 1;

  // Fetch up to 30 from current, and 30 from previous if needed
  const fetchSeasonStats = async (season) => {
    const { data, error } = await supabase
      .from("player_stats")
      .select(columnList)
      .eq("player_id", playerId)
      .eq("game_season", season)
      .order("game_date", { ascending: false })
      .limit(30);

    if (error) return [];
    return (data || []).filter((g) => parseInt(g.min) >= 1);
  };

  const currentGames = await fetchSeasonStats(currentSeason);
  const previousGames = await fetchSeasonStats(previousSeason);

  const allGames = [...currentGames, ...previousGames]
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    .slice(0, 40); // extra buffer in case of some invalids

  const validGames = [];
  for (const g of allGames) {
    const hits = statColumns.reduce((count, stat) => count + (g[stat] >= 10 ? 1 : 0), 0);
    const isDouble = hits >= 2;
    const isTriple = hits >= 3;

    validGames.push({
      game_id: g.game_id,
      game_date: g.game_date,
      min: g.min,
      pts: g.pts,
      reb: g.reb,
      ast: g.ast,
      stat_hits: hits,
      is_double_double: isDouble,
      is_triple_double: isTriple,
    });

    if (validGames.length === 10) break;
  }

  const doubleDoubleCount = validGames.filter((g) => g.is_double_double).length;
  const tripleDoubleCount = validGames.filter((g) => g.is_triple_double).length;

  return {
    id: "double_triple_double_trend",
    title: "Double & Triple Double Trend",
    value: `${doubleDoubleCount} DD / ${tripleDoubleCount} TD in last ${validGames.length} games`,
    context: `Over the last ${validGames.length} games played, this player recorded ${doubleDoubleCount} double-doubles and ${tripleDoubleCount} triple-doubles.`,
    data: validGames,
    status: doubleDoubleCount >= 5 ? "success" : tripleDoubleCount >= 2 ? "warning" : "info",
  };
}
