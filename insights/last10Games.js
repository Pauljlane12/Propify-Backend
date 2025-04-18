import { computeStatValue } from "../utils/computeStatValue.js";

// ✅ Insight 1 – Last 10 Game Hit Rate
export async function getLast10GameHitRate({ playerId, statType, statColumns, line, supabase }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select("min, pts, reb, ast, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, stl, blk, turnover, game_date")
    .eq("player_id", playerId)
    .order("game_date", { ascending: false })
    .limit(10);

  if (error) {
    return { error: error.message };
  }

  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return !isNaN(minutes) &&
      minutes >= 10 &&
      statColumns.every((col) => g[col] !== null && g[col] !== undefined);
  });

  const hitCount = valid.filter((g) => computeStatValue(g, statColumns) >= line).length;

  return {
    hitRate: valid.length ? +(hitCount / valid.length).toFixed(2) : null,
    hitCount,
    totalGames: valid.length,
  };
}
