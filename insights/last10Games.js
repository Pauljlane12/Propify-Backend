import { computeStatValue } from "../utils/computeStatValue.js";

export async function getLast10GameHitRate({ playerId, statType, statColumns, line, supabase }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select("min, pts, reb, ast, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, stl, blk, turnover") // select all possible fields
    .eq("player_id", playerId)
    .order("game_date", { ascending: false })
    .limit(10);

  if (error) {
    return { error: error.message };
  }

  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return !isNaN(minutes) && minutes >= 10;
  });

  const hits = valid.filter((g) => computeStatValue(g, statColumns) >= line).length;

  return {
    statType,
    hitRatePercent: valid.length ? ((hits / valid.length) * 100).toFixed(1) : "0",
    overHits: hits,
    totalGames: valid.length,
  };
}
