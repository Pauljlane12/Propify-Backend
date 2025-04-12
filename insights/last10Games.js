import { computeStatValue } from "../utils/computeStatValue.js";

export async function getSeasonVsLast3({ playerId, statColumns, supabase }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select("min, pts, reb, ast, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, stl, blk, turnover, game_date")
    .eq("player_id", playerId);

  if (error) {
    return { error: error.message };
  }

  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return !isNaN(minutes) && minutes >= 10 && statColumns.every(col => g[col] !== null && g[col] !== undefined);
  });

  if (valid.length === 0) {
    return { error: "No valid games with required stat data" };
  }

  // Season average
  const seasonTotal = valid.reduce((sum, g) => sum + computeStatValue(g, statColumns), 0);
  const seasonAvg = seasonTotal / valid.length;

  // Last 3 games
  valid.sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
  const last3 = valid.slice(0, 3);
  const last3Total = last3.reduce((sum, g) => sum + computeStatValue(g, statColumns), 0);
  const last3Avg = last3.length ? last3Total / last3.length : 0;

  return {
    seasonAvg: +seasonAvg.toFixed(1),
    last3Avg: +last3Avg.toFixed(1),
  };
}
