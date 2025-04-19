import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getComboPaceContext({ opponentTeamId, supabase }) {
  const currentSeason = await getMostRecentSeason(supabase);

  // 1. Pull team pace for the current season
  const { data, error } = await supabase
    .from("team_pace_rankings")
    .select("team_id, pace, rank, season")
    .eq("season", currentSeason)
    .eq("team_id", opponentTeamId)
    .maybeSingle();

  if (error || !data) {
    return {
      skip: true,
      context: "Pace data for the opponent is not yet available this season.",
    };
  }

  const { pace, rank } = data;

  let paceContext = "This team plays at an average pace.";
  if (rank <= 10) paceContext = "This team plays fast — great for PRA opportunities.";
  else if (rank >= 21) paceContext = "This team plays slow — may limit stat volume.";

  return {
    pace,
    rank,
    context: `The opponent ranks ${rank} in pace this season (${pace} possessions per game). ${paceContext}`,
  };
}
