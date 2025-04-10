export async function getLast10GameHitRate({ playerId, statType, line, supabase }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select(`${statType}, min`)
    .eq("player_id", playerId)
    .order("game_date", { ascending: false })
    .limit(10);

  if (error) {
    return { error: error.message };
  }

  const valid = (data || []).filter(
    (g) => g.min && parseInt(g.min, 10) >= 10 && g[statType] != null
  );

  const hits = valid.filter((g) => g[statType] >= line).length;

  return {
    statType,
    hitRatePercent: valid.length ? ((hits / valid.length) * 100).toFixed(1) : "0",
    overHits: hits,
    totalGames: valid.length,
  };
}
