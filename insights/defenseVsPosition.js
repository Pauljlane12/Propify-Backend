export async function getDefenseVsPosition({
  playerId,
  statType,
  teamId,
  opponentTeamId,
  supabase,
}) {
  try {
    // 1️⃣ Get player's position
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

    const playerPosition =
      activeRow?.true_position || fallbackRow?.position || "PG";

    // 2️⃣ Stat column + rank mapping
    const columnMap = {
      pts: ["points_allowed", "points_allowed_rank"],
      reb: ["rebounds_allowed", "rebounds_allowed_rank"],
      ast: ["assists_allowed", "assists_allowed_rank"],
      fg3m: ["threes_made_allowed", "threes_made_allowed_rank"],
      pra: ["pras_allowed", "pras_allowed_rank"],
      pts_ast: ["points_assists_allowed", "points_assists_allowed_rank"],
      fg_made: ["fg_made_allowed", "fg_made_allowed_rank"],
      dreb: ["defensive_rebounds_allowed", "defensive_rebounds_allowed_rank"],
      reb_ast: ["rebounds_assists_allowed", "rebounds_assists_allowed_rank"],
      oreb: ["offensive_rebounds_allowed", "offensive_rebounds_allowed_rank"],
      fg3a: ["threes_attempted_allowed", "threes_attempted_allowed_rank"],
      ftm: ["ft_made_allowed", "ft_made_allowed_rank"],
      fga: ["fg_attempts_allowed", "fg_attempts_allowed_rank"],
      pts_reb: ["points_rebounds_allowed", "points_rebounds_allowed_rank"],
      blk: ["blocks_allowed", "blocks_allowed_rank"],
      stl: ["steals_allowed", "steals_allowed_rank"],
      blk_stl: ["stocks_allowed", "stocks_allowed_rank"],
      turnover: ["turnovers_allowed", "turnovers_allowed_rank"],
    };

    const [valueCol, rankCol] = columnMap[statType] || [];
    if (!valueCol || !rankCol) {
      return { error: `Unsupported statType "${statType}"` };
    }

    // 3️⃣ Pull opponent defense data
    const { data: result, error } = await supabase
      .from("positional_defense_rankings_top_minute")
      .select(`${valueCol}, ${rankCol}, defense_team_name`)
      .eq("position", playerPosition)
      .eq("defense_team_id", opponentTeamId)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!result) {
      return {
        info: "No positional defense data found for this team/position.",
      };
    }

    // 4️⃣ Clean formatting
    const statLabel = statType.toUpperCase();
    const statAvg = +result[valueCol].toFixed(1);
    const statRank = result[rankCol];
    const defenseTeam = result.defense_team_name;
    const tier =
      statRank <= 10
        ? "✅ Favorable matchup"
        : statRank >= 21
        ? "⚠️ Tough matchup"
        : "🟨 Neutral matchup";

    // 5️⃣ Final summary string
    const summary = `${tier} — Starting ${playerPosition}s are averaging **${statAvg} ${statLabel}** vs the **${defenseTeam}**, which ranks **#${statRank} in the NBA this season**.`;

    return {
      statType,
      position: playerPosition,
      value: statAvg,
      rank: statRank,
      summary,
    };
  } catch (err) {
    return { error: err.message };
  }
}
