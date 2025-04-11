export async function getDefenseVsPosition({
  playerId,
  statType,
  teamId,
  opponentTeamId,
  supabase,
}) {
  try {
    // Step 1: Get player position
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

    // Step 2: Pick correct column and rank key
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

    // Step 3: Query the table
    const { data: result, error } = await supabase
      .from("positional_defense_rankings_top_minute")
      .select(
        `${valueCol}, ${rankCol}, games_sampled, defense_team_name`
      )
      .eq("position", playerPosition)
      .eq("defense_team_id", opponentTeamId)
      .maybeSingle();

    if (error) {
      return { error: error.message };
    }

    if (!result) {
      return {
        info: "No positional defense data found for this team/position.",
      };
    }

    return {
      statType,
      position: playerPosition,
      value: result[valueCol],
      rank: result[rankCol],
      games_sampled: result.games_sampled,
      summary: `This season, ${playerPosition}s have averaged ${result[valueCol]} ${statType.toUpperCase()} vs the ${result.defense_team_name}, ranking #${result[rankCol]} in the NBA.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
