import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getSeasonVsLast3Combo({ playerId, statColumns, supabase }) {
  const currentSeason = await getMostRecentSeason(supabase);
  const previousSeason = currentSeason - 1;

  const fetchGames = async (season) => {
    const { data, error } = await supabase
      .from("player_stats")
      .select([...statColumns, "min", "game_date"].join(", "))
      .eq("player_id", playerId)
      .eq("game_season", season)
      .order("game_date", { ascending: false })
      .limit(20);

    if (error) {
      console.error(`❌ Error fetching ${season} data:`, error.message);
      return [];
    }

    return (data || []).filter((g) => {
      const mins = parseInt(g.min, 10);
      return !isNaN(mins) && mins >= 10 &&
        statColumns.every((col) => g[col] !== null && g[col] !== undefined);
    });
  };

  const current = await fetchGames(currentSeason);
  const previous = await fetchGames(previousSeason);

  const last3 = current.slice(0, 3);
  const fullSet = current.length > 0 ? current : previous;
  const last3Fallback = last3.length === 3 ? last3 : previous.slice(0, 3);

  const sum = (arr) =>
    arr.reduce(
      (total, g) =>
        total + statColumns.reduce((s, col) => s + (g[col] || 0), 0),
      0
    );

  const seasonAvg = fullSet.length ? +(sum(fullSet) / fullSet.length).toFixed(1) : null;
  const last3Avg = last3Fallback.length ? +(sum(last3Fallback) / last3Fallback.length).toFixed(1) : null;

  const contextParts = [];
  if (current.length === 0) {
    contextParts.push("No valid games this season. Using last season's full-season data.");
  }
  if (last3.length < 3) {
    contextParts.push("Less than 3 current-season games played. Using last season for recent form.");
  }

  return {
    seasonAvg,
    last3Avg,
    gamesUsed: {
      season: fullSet.length,
      last3: last3Fallback.length,
    },
    context: contextParts.length
      ? contextParts.join(" ")
      : `Season average is ${seasonAvg}. Last 3-game average is ${last3Avg}.`,
  };
}
