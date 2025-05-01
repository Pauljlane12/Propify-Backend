export async function getOpponentFoulTendencies({ opponentTeamId, supabase }) {
  const { data, error } = await supabase
    .from("box_scores")
    .select("pf, game_date, team_id")
    .eq("team_id", opponentTeamId)
    .eq("game_season", 2024);

  if (error || !data || data.length === 0) {
    return {
      label: "Opponent Foul Tendencies",
      value: "Unavailable",
      explanation: "Foul data for the opponent team is currently unavailable.",
    };
  }

  // Group by game_date and sum fouls per game
  const foulsPerGame = {};
  for (const row of data) {
    const date = row.game_date;
    if (!foulsPerGame[date]) foulsPerGame[date] = 0;
    foulsPerGame[date] += row.pf || 0;
  }

  const foulCounts = Object.values(foulsPerGame);
  const avgFouls = foulCounts.reduce((sum, val) => sum + val, 0) / foulCounts.length;

  return {
    label: "Opponent Foul Tendencies",
    value: `${avgFouls.toFixed(1)} fouls per game`,
    explanation: `The opposing team has committed an average of ${avgFouls.toFixed(
      1
    )} personal fouls per game this season — which can lead to more free throw opportunities for scorers.`,
  };
}
