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
    .limit(20); // fetch extra in case some are invalid

  if (error) {
    console.error("❌ Supabase error fetching player stats:", error.message);
    return { error: error.message };
  }

  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    const statValue = g[statType];
    return !isNaN(minutes) && minutes >= 10 && statValue !== null && statValue !== undefined;
  });

  const last10 = valid.slice(0, 10);
  const lineValue = parseFloat(line); // ensure it's a number
  const hitCount = last10.filter((g) => g[statType] >= lineValue).length;

  // ✅ Debug output
  console.log("📊 getLast10GameHitRate");
  console.log("▶ statType:", statType);
  console.log("▶ line:", lineValue);
  console.log("▶ playerId:", playerId);
  console.table(
    last10.map((g) => ({
      game_date: g.game_date,
      stat: g[statType],
      min: g.min,
      hit: g[statType] >= lineValue,
    }))
  );

  return {
    hitRate: last10.length ? +(hitCount / last10.length).toFixed(2) : null,
    hitCount,
    totalGames: last10.length,
  };
}
