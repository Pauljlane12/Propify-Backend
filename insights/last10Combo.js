import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getLast10ComboHitRate({ playerId, statColumns, line, supabase }) {
  const currentSeason = await getMostRecentSeason(supabase);

  // 1. Check if player has at least 10 valid games this season
  const { data: currentGames, error: currentError } = await supabase
    .from("player_stats")
    .select([...statColumns, "min", "game_date"])
    .eq("player_id", playerId)
    .eq("game_season", currentSeason)
    .order("game_date", { ascending: false })
    .limit(20);

  if (currentError) return { error: currentError.message };

  const currentValid = (currentGames || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return (
      !isNaN(minutes) &&
      minutes >= 10 &&
      statColumns.every((col) => g[col] !== null && g[col] !== undefined)
    );
  });

  // 2. Use fallback season if not enough current games
  const seasonToUse = currentValid.length >= 10 ? currentSeason : currentSeason - 1;

  const { data: stats, error } = await supabase
    .from("player_stats")
    .select([...statColumns, "min", "game_date"])
    .eq("player_id", playerId)
    .eq("game_season", seasonToUse)
    .order("game_date", { ascending: false })
    .limit(20);

  if (error) return { error: error.message };

  // 3. Filter valid games
  const valid = (stats || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return (
      !isNaN(minutes) &&
      minutes >= 10 &&
      statColumns.every((col) => g[col] !== null && g[col] !== undefined)
    );
  });

  // 4. Get last 10 valid games
  const last10 = valid.slice(0, 10);

  // 5. Sum up combined stat value
  const valueSum = (g) =>
    statColumns.reduce((sum, col) => sum + (g[col] || 0), 0);

  const hitCount = last10.filter((g) => valueSum(g) >= line).length;

  return {
    hitRate: last10.length ? +(hitCount / last10.length).toFixed(2) : null,
    hitCount,
    totalGames: last10.length,
    seasonUsed: seasonToUse,
    context:
      `Using ${seasonToUse} data, this player has hit the line in ${hitCount} of their last ${last10.length} games.` +
      (seasonToUse !== currentSeason
        ? " No valid games from the current season yet, so data is based on the previous season."
        : ""),
  };
}
