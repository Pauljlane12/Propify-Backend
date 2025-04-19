import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getMatchupHistoryCombo({
  playerId,
  opponentTeamId,
  statColumns,
  supabase,
}) {
  const currentSeason = await getMostRecentSeason(supabase);
  const previousSeason = currentSeason - 1;

  const fetchGames = async (season) => {
    const { data: stats, error } = await supabase
      .from("player_stats")
      .select([...statColumns, "min", "game_id", "team_id"].join(", "))
      .eq("player_id", playerId)
      .eq("game_season", season);

    if (error) return [];

    const gameIds = stats.map((g) => g.game_id).filter(Boolean);

    const { data: games } = await supabase
      .from("games")
      .select("id, home_team_id, visitor_team_id")
      .in("id", gameIds);

    return stats.filter((g) => {
      const game = games.find((gm) => gm.id === g.game_id);
      if (!game) return false;

      const isOpponent =
        (game.home_team_id === g.team_id && game.visitor_team_id === opponentTeamId) ||
        (game.visitor_team_id === g.team_id && game.home_team_id === opponentTeamId);

      const minutes = parseInt(g.min, 10);
      return (
        isOpponent &&
        !isNaN(minutes) &&
        minutes >= 10 &&
        statColumns.every((col) => g[col] != null)
      );
    });
  };

  const valueSum = (g) => statColumns.reduce((sum, col) => sum + (g[col] || 0), 0);

  const currentMatchups = await fetchGames(currentSeason);
  const prevMatchups = await fetchGames(previousSeason);

  const average = (arr) =>
    arr.length ? +(arr.reduce((t, g) => t + valueSum(g), 0) / arr.length).toFixed(1) : null;

  return {
    currentSeason: {
      average: average(currentMatchups),
      gamesAnalyzed: currentMatchups.length,
      context: currentMatchups.length
        ? `This season, the player has averaged ${average(currentMatchups)} in ${currentMatchups.length} matchups vs this team.`
        : "No current-season matchups available yet.",
    },
    previousSeason: {
      average: average(prevMatchups),
      gamesAnalyzed: prevMatchups.length,
      context: prevMatchups.length
        ? `Last season, the player averaged ${average(prevMatchups)} in ${prevMatchups.length} matchups vs this team.`
        : "No matchups found last season vs this team.",
    },
  };
}
