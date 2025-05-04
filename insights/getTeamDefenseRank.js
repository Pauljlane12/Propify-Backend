import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

const statToRankColumn = {
  pts: "pts_allowed_rank",
  reb: "reb_allowed_rank",
  ast: "ast_allowed_rank",
  blk: "blk_allowed_rank",
  stl: "stl_allowed_rank",
  fg3m: "fg3m_allowed_rank",
  fg3a: "fg3a_allowed_rank",
  turnover: "turnover_forced_rank", // LOWER rank is better for turnovers forced
};

const statToTitle = {
  pts: "Points Allowed Rank",
  reb: "Rebounds Allowed Rank",
  ast: "Assists Allowed Rank",
  blk: "Blocks Allowed Rank",
  stl: "Steals Allowed Rank",
  fg3m: "3PT Makes Allowed Rank",
  fg3a: "3PT Attempts Allowed Rank",
  turnover: "Turnovers Forced Rank",
};

export async function getTeamDefenseRankInsight({ teamId, statType, supabase }) {
  const insightId = `team_defense_rank_${statType}`;
  const title = statToTitle[statType];
  const rankColumn = statToRankColumn[statType];

  if (!rankColumn) {
    return {
      id: insightId,
      title,
      value: "N/A",
      context: `No defensive rank available for stat: ${statType}`,
      status: "info",
    };
  }

  try {
    const season = await getMostRecentSeason(supabase);

    const { data, error } = await supabase
      .from("team_defense_ranks")
      .select(`${rankColumn}`)
      .eq("team_id", teamId)
      .eq("season", season)
      .single();

    if (error || !data) {
      return {
        id: insightId,
        title,
        value: "N/A",
        context: `No ranking data found for team ${teamId} in season ${season}`,
        status: "info",
      };
    }

    const rank = data[rankColumn];

    const { data: teamInfo, error: teamError } = await supabase
      .from("teams")
      .select("abbreviation")
      .eq("id", teamId)
      .single();

    const teamAbbr = teamInfo?.abbreviation || "This team";

    return {
      id: insightId,
      title,
      value: `#${rank}`,
      context: `${teamAbbr} ranks ${rank} in the NBA for opponent ${statType.toUpperCase()} per game.`,
      status: rank <= 10 ? "success" : rank >= 21 ? "danger" : "warning",
      details: {
        rank,
        statType,
        teamId,
        season,
        teamAbbr,
      },
    };
  } catch (err) {
    return {
      id: insightId,
      title,
      value: "Error",
      context: "Failed to retrieve defensive rank.",
      status: "danger",
      error: err.message,
    };
  }
}
