export async function getTeamPaceRank({ opponentTeamId, supabase }) {
  try {
    const { data: finalGames } = await supabase
      .from("games")
      .select("id, date, status, home_team_id, visitor_team_id")
      .eq("status", "Final");

    const { data: finalBox } = await supabase
      .from("box_scores")
      .select("team_id, game_date, fga, fta, oreb, turnover")
      .in("game_date", (finalGames || []).map((g) => g.date));

    const posMap = {};

    for (const row of finalBox || []) {
      const game = finalGames.find(
        (g) =>
          g.date === row.game_date &&
          (g.home_team_id === row.team_id || g.visitor_team_id === row.team_id)
      );
      if (!game) continue;

      const key = `${row.team_id}_${game.id}`;
      if (!posMap[key]) posMap[key] = 0;

      posMap[key] +=
        (row.fga || 0) +
        0.44 * (row.fta || 0) -
        (row.oreb || 0) +
        (row.turnover || 0);
    }

    const teamTotals = {};
    for (const key in posMap) {
      const teamIdFromKey = +key.split("_")[0];
      if (!teamTotals[teamIdFromKey]) teamTotals[teamIdFromKey] = [];
      teamTotals[teamIdFromKey].push(posMap[key]);
    }

    const teamAverages = Object.entries(teamTotals).map(([id, possessions]) => ({
      team_id: +id,
      avg_possessions_per_game:
        possessions.length > 0
          ? possessions.reduce((a, b) => a + b, 0) / possessions.length
          : 0,
    }));

    teamAverages.sort((a, b) => b.avg_possessions_per_game - a.avg_possessions_per_game);

    const rank = teamAverages.findIndex((team) => team.team_id === opponentTeamId);

    if (rank === -1) {
      return { error: "Opponent pace rank not found" };
    }

    return {
      abbreviation: null, // fill later if needed
      avg_possessions_per_game: +teamAverages[rank].avg_possessions_per_game.toFixed(2),
      pace_rank: rank + 1,
      team_id: opponentTeamId,
    };
  } catch (err) {
    return { error: err.message };
  }
}
