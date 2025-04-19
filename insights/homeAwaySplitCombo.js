import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getComboHomeAwaySplit({ playerId, teamId, statColumns, supabase }) {
  const currentSeason = await getMostRecentSeason(supabase);

  // 1. Get all player stats for this season with min, team_id, game_id, stat fields
  const { data: statRows, error: statsError } = await supabase
    .from("player_stats")
    .select([...statColumns, "min", "team_id", "game_id"].join(", "))
    .eq("player_id", playerId)
    .eq("game_season", currentSeason);

  if (statsError || !statRows?.length) {
    return { error: "Failed to fetch player stats." };
  }

  // 2. Filter valid stat lines
  const validStats = statRows.filter((g) => {
    const mins = parseInt(g.min, 10);
    return !isNaN(mins) &&
      mins >= 10 &&
      statColumns.every((col) => g[col] !== null && g[col] !== undefined);
  });

  const gameIds = validStats.map((row) => row.game_id);

  // 3. Get game info for those IDs
  const { data: games, error: gameError } = await supabase
    .from("games")
    .select("id, home_team_id")
    .in("id", gameIds);

  if (gameError || !games?.length) {
    return { error: "Failed to fetch game info." };
  }

  const gameMap = Object.fromEntries(games.map((g) => [g.id, g.home_team_id]));

  const home = [];
  const away = [];

  for (const row of validStats) {
    const homeTeamId = gameMap[row.game_id];
    if (homeTeamId === undefined) continue;

    const isHome = row.team_id === homeTeamId;

    const total = statColumns.reduce((sum, col) => sum + (row[col] || 0), 0);
    if (isHome) home.push(total);
    else away.push(total);
  }

  const avg = (arr) =>
    arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

  return {
    homeAvg: avg(home),
    awayAvg: avg(away),
    homeGames: home.length,
    awayGames: away.length,
    context: `At home, this player has averaged ${avg(home) || 0} in ${home.length} games. On the road, they’ve averaged ${avg(away) || 0} in ${away.length} games.`,
  };
}
