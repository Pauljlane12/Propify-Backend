export async function getPositionalDefenseCombo({
  opponentTeamId,
  position,
  statType,
  supabase,
}) {
  try {
    // Map combo stat types to the correct columns
    const columnMap = {
      pras: ["pras_allowed", "pras_allowed_rank"],
      pr:   ["points_rebounds_allowed", "points_rebounds_allowed_rank"],
      pa:   ["points_assists_allowed", "points_assists_allowed_rank"],
      ra:   ["rebounds_assists_allowed", "rebounds_assists_allowed_rank"],
    };

    const [valueCol, rankCol] = columnMap[statType] || [];

    if (!valueCol || !rankCol) {
      return {
        skip: true,
        context: `Unsupported stat type "${statType}" for combo positional defense.`,
      };
    }

    const { data, error } = await supabase
      .from("positional_defense_rankings_top_minute")
      .select(`${valueCol}, ${rankCol}, defense_team_name`)
      .eq("defense_team_id", opponentTeamId)
      .eq("position", position)
      .maybeSingle();

    if (error || !data) {
      return {
        skip: true,
        context: "Opponent positional defense data is unavailable.",
      };
    }

    const value = data[valueCol];
    const rank = data[rankCol];
    const teamName = data.defense_team_name;

    let label = "average";
    if (rank <= 10) label = "favorable";
    else if (rank >= 21) label = "tough";

    return {
      statType,
      position,
      rank,
      allowed: value,
      context: `${teamName} ranks #${rank} in the NBA for ${statType.toUpperCase()} allowed to ${position}s — a ${label} matchup.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
