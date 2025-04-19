import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getComboPaceContext({ opponentTeamId, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    // 1. Get final games for this season
    const { data: finalGames, error: gameError } = await supabase
      .from("games")
      .select("id, date, status, season, home_team_id, visitor_team_id")
      .eq("status", "Final")
      .eq("season", currentSeason);

    if (gameError || !finalGames?.length) {
      return {
        skip: true,
        context: "No completed games this season to calculate opponent pace.",
      };
    }

    // 2. Get box scores for this team in those games
    const gameDates = finalGames.map((g) => g.date);

    const { data: finalBox, error: boxError } = await supabase
      .from("box_scores")
      .select("team_id, game_date, fga, fta, oreb, turnover")
      .eq("team_id", opponentTeamId)
      .in("game_date", gameDates);

    if (boxError || !finalBox?.length) {
      return {
        skip: true,
        context: "No opponent box score data available this season.",
      };
    }

    // 3. Group by game and calculate possessions
    const posByGame = {};

    for (const row of finalBox) {
      const key = row.game_date;
      if (!posByGame[key]) posByGame[key] = 0;

      posByGame[key] +=
        (row.fga || 0) +
        0.44 * (row.fta || 0) -
        (row.oreb || 0) +
        (row.turnover || 0);
    }

    const possessions = Object.values(posByGame);
    const avgPace = possessions.length
      ? +(possessions.reduce((a, b) => a + b, 0) / possessions.length).toFixed(1)
      : null;

    if (!avgPace) {
      return {
        skip: true,
        context: "Not enough data to calculate opponent pace.",
      };
    }

    let label = "average";
    if (avgPace >= 101) label = "fast";
    else if (avgPace <= 97) label = "slow";

    return {
      opponentAvgPossessions: avgPace,
      context: `The opponent team averages ${avgPace} possessions per game — a ${label} pace that may affect stat totals.`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
