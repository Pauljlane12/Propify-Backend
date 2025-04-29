export async function getDefenseVsPosition({
  playerId,
  statType,
  teamId,
  opponentTeamId,
  supabase,
}) {
  try {
    // 1️⃣ Get the player's position
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

    // 2️⃣ Normalize statType aliases
    const normalizedStatTypeMap = {
      fgm: "fg_made",
      fgmade: "fg_made",
    };
    statType = normalizedStatTypeMap[statType] || statType;

    // 3️⃣ Stat-to-column map
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

    // 4️⃣ Pull the defense data for team vs position
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

    // 5️⃣ Prepare dynamic explanation
    const statLabel = statType.toUpperCase();
    const statAvg = +result[valueCol].toFixed(1);
    const statRank = result[rankCol];
    const defenseTeam = result.defense_team_name;
    const position = playerPosition;

    const tier =
      statRank >= 21
        ? "✅ Favorable matchup"
        : statRank <= 10
        ? "⚠️ Tough matchup"
        : "🟨 Neutral matchup";

    const verbMap = {
      pts: "give up",
      reb: "allow",
      ast: "allow",
      fg3m: "allow",
      pra: "give up",
      pts_ast: "surrender",
      fg_made: "allow",
      dreb: "allow",
      reb_ast: "allow",
      oreb: "give up",
      fg3a: "yield",
      ftm: "allow",
      fga: "allow",
      pts_reb: "give up",
      blk: "allow",
      stl: "allow",
      blk_stl: "allow",
      turnover: "force",
    };

    const verb = verbMap[statType] || "allow";

    const summary =
      statType === "turnover"
        ? `${tier} — The **${defenseTeam}** force an average of **${statAvg} TURNOVERS** from starting ${position}s this season, which ranks **#${statRank} in the NBA**.`
        : `${tier} — The **${defenseTeam}** ${verb} **${statAvg} ${statLabel}** to starting ${position}s this season, which ranks **#${statRank} in the NBA**.`;

    return {
      statType,
      position,
      value: statAvg,
      rank: statRank,
      summary,
    };
  } catch (err) {
    return { error: err.message };
  }
}
