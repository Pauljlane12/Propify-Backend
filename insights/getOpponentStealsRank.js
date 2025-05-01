export async function getOpponentStealsRank({ opponentTeamId, supabase }) {
  const currentSeason = 2025;
  let data, error;

  // 1. Try current season first
  ({ data, error } = await supabase.rpc("get_team_steal_ranks", {
    season: currentSeason,
  }));

  // 2. If no data or empty, fallback to last season
  if (error || !data || data.length === 0) {
    console.warn("No data for current season. Falling back to 2024.");
    ({ data, error } = await supabase.rpc("get_team_steal_ranks", {
      season: currentSeason - 1,
    }));
  }

  if (error || !data || !Array.isArray(data)) {
    return {
      label: "Opponent Steal Pressure",
      value: "Unavailable",
      explanation: "Opponent steal data is currently unavailable.",
    };
  }

  const opponent = data.find((team) => team.team_id === opponentTeamId);

  if (!opponent) {
    return {
      label: "Opponent Steal Pressure",
      value: "Unavailable",
      explanation: "Could not locate opponent steal stats in the database.",
    };
  }

  const { avg_steals_per_game, steals_rank } = opponent;

  return {
    label: "Opponent Steal Pressure",
    value: `${avg_steals_per_game} SPG (Rank #${steals_rank})`,
    explanation: `This team forces an average of ${avg_steals_per_game} steals per game, ranking #${steals_rank} in the NBA — indicating higher turnover risk.`,
  };
}
