import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

// ✅ For single-stat props like points, rebounds, assists, etc.
export async function getLast10GameHitRate({ playerId, statType, line, supabase }) {
  const currentSeason = await getMostRecentSeason(supabase);

  const { data, error } = await supabase
    .from("player_stats")
    .select("min, game_date, pts, reb, ast, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, stl, blk, turnover, game_season")
    .eq("player_id", playerId)
    .eq("game_season", currentSeason)
    .order("game_date", { ascending: false })
    .limit(20); // grab extra in case some are under 10 mins

  if (error) return { error: error.message };

  // ✅ Only include games with ≥ 10 minutes and stat is not null
  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    return !isNaN(minutes) && minutes >= 10 && g[statType] != null;
  });

  // ✅ Grab the last 10 valid games
  const last10 = valid.slice(0, 10);
  const hitCount = last10.filter((g) => g[statType] >= line).length;

  return {
    hitRate: last10.length ? +(hitCount / last10.length).toFixed(2) : null,
    hitCount,
    totalGames: last10.length,
  };
}
