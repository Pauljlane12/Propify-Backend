export async function getProjectedGamePace({ teamId, opponentTeamId, supabase }) {
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

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const t1Avg = avg(teamTotals[teamId] || []);
    const t2Avg = avg(teamTotals[opponentTeamId] || []);

    return {
      projected_game_pace: +((t1Avg + t2Avg) / 2).toFixed(2),
      team_1: teamId,
      team_2: opponentTeamId,
    };
  } catch (err) {
    return { error: err.message };
  }
}
