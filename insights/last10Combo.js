import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getLast10ComboHitRate({
  playerId,
  statColumns,   // e.g. ["pts", "reb", "ast"]
  line,
  supabase,
}) {
  const currentSeason = await getMostRecentSeason(supabase);

  // Helper: build the column list string once
  const columnList = [...statColumns, "min", "game_date"].join(", ");

  /* ---------- 1. How many valid games this season? ---------- */
  const { data: currentGames, error: currentErr } = await supabase
    .from("player_stats")
    .select(columnList)                 // ✅ pass string, not array
    .eq("player_id", playerId)
    .eq("game_season", currentSeason)
    .order("game_date", { ascending: false })
    .limit(20);                         // pull extras in case of DNPs

  if (currentErr) return { error: currentErr.message };

  const currentValid = (currentGames || []).filter((g) => {
    const mins = parseInt(g.min, 10);
    return (
      !isNaN(mins) &&
      mins >= 10 &&
      statColumns.every((col) => g[col] != null)
    );
  });

  /* ---------- 2. Decide which season to use ---------- */
  const seasonToUse =
    currentValid.length >= 10 ? currentSeason : currentSeason - 1;

  /* ---------- 3. Pull games from the chosen season ---------- */
  const { data: stats, error } = await supabase
    .from("player_stats")
    .select(columnList)                 // ✅ same fix here
    .eq("player_id", playerId)
    .eq("game_season", seasonToUse)
    .order("game_date", { ascending: false })
    .limit(20);

  if (error) return { error: error.message };

  /* ---------- 4. Filter valid games ---------- */
  const valid = (stats || []).filter((g) => {
    const mins = parseInt(g.min, 10);
    return (
      !isNaN(mins) &&
      mins >= 10 &&
      statColumns.every((col) => g[col] != null)
    );
  });

  const last10 = valid.slice(0, 10);

  /* ---------- 5. Calculate hit rate ---------- */
  const valueSum = (g) =>
    statColumns.reduce((sum, col) => sum + (g[col] || 0), 0);

  const hitCount = last10.filter((g) => valueSum(g) >= line).length;

  return {
    hitRate: last10.length ? +(hitCount / last10.length).toFixed(2) : null,
    hitCount,
    totalGames: last10.length,
    seasonUsed: seasonToUse,
    context:
      `Using ${seasonToUse} data, this player has hit the line in ` +
      `${hitCount} of their last ${last10.length} games.` +
      (seasonToUse !== currentSeason
        ? " No valid games from the current season yet; using previous season."
        : ""),
  };
}
