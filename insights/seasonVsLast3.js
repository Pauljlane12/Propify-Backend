export async function getSeasonVsLast3({ playerId, statType, supabase }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select(`${statType}, min, game_date`)
    .eq("player_id", playerId);

  if (error) {
    return { error: error.message };
  }

  // Filter for games with ≥ 10 minutes
  const valid = (data || []).filter((g) => {
    const mins = parseInt(g.min, 10);
    return !isNaN(mins) && mins >= 10 && g[statType] != null;
  });

  // Season average
  const sum = valid.reduce((acc, cur) => acc + cur[statType], 0);
  const seasonAvg = valid.length ? sum / valid.length : 0;

  // Sort and get last 3 valid games
  valid.sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
  const last3 = valid.slice(0, 3);
  const sumLast3 = last3.reduce((acc, cur) => acc + cur[statType], 0);
  const last3Avg = last3.length ? sumLast3 / last3.length : 0;

  return {
    seasonAvg: +seasonAvg.toFixed(1),
    last3Avg: +last3Avg.toFixed(1),
  };
}
