export async function getPositionalDefenseCombo({
  playerId,          // 🆕  needed to find position
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    /* ──────────────────────────────
       1) Detect player position
    ────────────────────────────── */
    const { data: activeRow } = await supabase
      .from("active_players")
      .select("true_position")
      .eq("player_id", playerId)
      .maybeSingle();

    const { data: fallbackRow } = await supabase
      .from("players")
      .select("position")
      .eq("player_id", playerId)
      .maybeSingle();

    const position =
      activeRow?.true_position || fallbackRow?.position || "PG";

    /* ──────────────────────────────
       2) Map combo stat types → columns
    ────────────────────────────── */
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
        context: `Unsupported combo stat "${statType}" for positional defense.`,
      };
    }

    /* ──────────────────────────────
       3) Query defense rankings
    ────────────────────────────── */
    const { data, error } = await supabase
      .from("positional_defense_rankings_top_minute")
      .select(`${valueCol}, ${rankCol}, defense_team_name`)
      .eq("defense_team_id", opponentTeamId)
      .eq("position", position)
      .maybeSingle();

    if (error) {
      return { error: error.message };
    }
    if (!data || data[valueCol] == null || data[rankCol] == null) {
      return {
        skip: true,
        context:
          "No positional defense data available for this opponent / position.",
      };
    }

    /* ──────────────────────────────
       4) Build insight payload
    ────────────────────────────── */
    const allowed = +data[valueCol];
    const rank    = data[rankCol];
    const team    = data.defense_team_name;

    let descriptor = "average";
    if (rank <= 10) descriptor = "favorable";
    else if (rank >= 21) descriptor = "tough";

    return {
      statType,
      position,
      rank,
      allowed,
      context: `${team} rank #${rank} in the NBA for ${statType.toUpperCase()} allowed to ${position}s — a ${descriptor} matchup.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
