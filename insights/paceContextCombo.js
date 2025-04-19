import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getComboPaceContext({ opponentTeamId, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    const { data: finalGames } = await supabase
      .from("games")
      .select("id, date, status, season, home_team_id, visitor_team_id")
      .eq("status", "Final")
      .eq("season", currentSeason);

    if (!finalGames?.length) {
      return {
        skip: true,
        context: "No completed games this season to calculate pace.",
      };
    }

    const gameDates = finalGames.map((g) => g.date);

    const { data: finalBox } = await supabase
      .from("box_scores")
      .select("team_id, game_date, fga, fta, oreb, turnover")
      .in("game_date", gameDates);

    if (!finalBox?.length) {
      return {
        skip: true,
        context: "No box score data available to calculate pace.",
      };
    }

    // 🔢 Compute possessions per team/game
    const posMap = {};

    for (const row of finalBox) {
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
      return {
        skip: true,
        context: "Opponent team pace ranking not available yet.",
      };
    }

    const avg = +teamAverages[rank].avg_possessions_per_game.toFixed(2);
    const paceRank = rank + 1;

    let label = "average";
    if (paceRank <= 10) label = "fast";
    if (paceRank >= 21) label = "slow";

    return {
      opponentAvgPossessions: avg,
      paceRank,
      context: `The opponent team ranks ${paceRank} in pace this season, averaging ${avg} possessions per game — a ${label} matchup that may affect stat volume.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
