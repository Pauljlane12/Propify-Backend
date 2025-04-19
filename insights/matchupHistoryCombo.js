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
      .select([...statColumns, "min", "game_id", "game_season", "team_id", "game_date"].join(", "))
      .eq("player_id", playerId)
      .eq("game_season", season);

    if (error || !stats?.length) return [];

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

      const mins = parseInt(g.min, 10);
      return (
        isOpponent &&
        !isNaN(mins) &&
        mins >= 10 &&
        statColumns.every((col) => g[col] != null)
      );
    });
  };

  const sum = (arr, fn) =>
    arr.reduce((total, item) => total + fn(item), 0);

  const valueSum = (g) =>
    statColumns.reduce((sum, col) => sum + (g[col] || 0), 0);

  const currentMatchups = await fetchGames(currentSeason);
  const previousMatchups = await fetchGames(previousSeason);

  const currentAverage = currentMatchups.length
    ? +(sum(currentMatchups, valueSum) / currentMatchups.length).toFixed(1)
    : null;

  const previousAverage = previousMatchups.length
    ? +(sum(previousMatchups, valueSum) / previousMatchups.length).toFixed(1)
    : null;

  const currentGames = currentMatchups.map((g) => ({
    date: g.game_date,
    stats: Object.fromEntries(
      statColumns.map((col) => [col, g[col]])
    ),
    total: valueSum(g),
  }));

  return {
    currentSeason: {
      average: currentAverage,
      gamesAnalyzed: currentMatchups.length,
      context: currentMatchups.length
        ? `This season, the player has averaged ${currentAverage} across ${currentMatchups.length} matchups.`
        : "No current-season matchups found against this team.",
      games: currentGames,
    },
    previousSeason: {
      average: previousAverage,
      gamesAnalyzed: previousMatchups.length,
      context: previousMatchups.length
        ? `Last season, the player averaged ${previousAverage} in ${previousMatchups.length} matchups.`
        : "No previous-season matchups found against this team.",
    },
  };
}
