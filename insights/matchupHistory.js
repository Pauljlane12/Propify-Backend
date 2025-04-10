export async function getMatchupHistory({ playerId, opponentTeamId, statType, supabase }) {
  try {
    const { data, error } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, hit_rate, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", statType)
      .maybeSingle();

    if (error) {
      return { error: error.message };
    }

    if (!data) {
      return {
        info: "No matchup history found for this stat vs this team.",
      };
    }

    return {
      gamesPlayed: data.games_played,
      average: +data.avg_value.toFixed(1),
      hitRatePercent: data.hit_rate ? (data.hit_rate * 100).toFixed(1) : null,
      statList: data.stat_list,
    };
  } catch (err) {
    return { error: err.message };
  }
}
