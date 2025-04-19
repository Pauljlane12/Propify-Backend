export async function getPositionalDefenseCombo({
  opponentTeamId,
  position,
  statType,
  supabase,
}) {
  try {
    const { data, error } = await supabase
      .from("positional_defense_rankings")
      .select("defense_team_id, position, stat_type, value, rank")
      .eq("defense_team_id", opponentTeamId)
      .eq("position", position)
      .eq("stat_type", statType) // e.g., "pras", "pr", etc.
      .maybeSingle();

    if (error || !data) {
      return {
        skip: true,
        context: "Opponent positional defense data is unavailable.",
      };
    }

    const { value, rank } = data;

    let interpretation = "average";
    if (rank <= 10) interpretation = "favorable";
    if (rank >= 21) interpretation = "tough";

    return {
      allowed: value,
      rank,
      context: `This team ranks ${rank} in the NBA vs ${position}s for ${statType.toUpperCase()} — this is considered a ${interpretation} matchup.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
