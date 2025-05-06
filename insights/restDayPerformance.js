import { CURRENT_SEASON } from "./constants.js";

export async function getRestDayPerformance({
  playerId,
  teamId,
  statType,
  supabase,
}) {
  try {
    const statColumn = `avg_${statType}`;
    const lastSeason = CURRENT_SEASON - 1;

    // 1. Count how many games the player has played this season (min > 0)
    const { data: seasonGames, error: gamesError } = await supabase
      .from("player_stats")
      .select("game_id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0)
      .eq("game_season", CURRENT_SEASON);

    if (gamesError) {
      return { error: gamesError.message };
    }

    const currentSeasonGames = seasonGames?.length || 0;
    if (currentSeasonGames < 5) {
      return {
        info: `Not enough games played this season to generate rest-day performance insight (requires 5+).`,
      };
    }

    // 2. Get the next scheduled game for this team
    const { data: upcomingGames, error: upcomingError } = await supabase
      .from("games")
      .select("date")
      .neq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .gte("date", new Date().toISOString())
      .order("date", { ascending: true })
      .limit(1);

    const nextGameDate = upcomingGames?.[0]?.date;
    if (upcomingError || !nextGameDate) {
      return { info: "No upcoming game found for this team." };
    }

    // 3. Get last played game where player had minutes > 0
    const { data: lastPlayedStats, error: lastPlayedError } = await supabase
      .from("player_stats")
      .select("game_date")
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0)
      .order("game_date", { ascending: false })
      .limit(1);

    const lastPlayedDate = lastPlayedStats?.[0]?.game_date;
    if (lastPlayedError || !lastPlayedDate) {
      return { info: "No recent game found where player actually played." };
    }

    // 4. Calculate rest days
    const diffInDays = Math.floor(
      (new Date(nextGameDate) - new Date(lastPlayedDate)) / (1000 * 60 * 60 * 24)
    );
    const restDays = Math.max(0, diffInDays - 1);

    // 5. Try to get current season rest day data
    const { data: currentSeasonData, error: restError } = await supabase
      .from("player_rest_day_averages")
      .select(`${statColumn}, rest_days, games_played`)
      .eq("player_id", playerId)
      .eq("rest_days", restDays)
      .eq("game_season", CURRENT_SEASON)
      .limit(1);

    if (restError) {
      return { error: restError.message };
    }

    let restRow = currentSeasonData?.[0];

    // 6. Fallback: try previous season
    if (!restRow || restRow[statColumn] == null) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("player_rest_day_averages")
        .select(`${statColumn}, rest_days, games_played`)
        .eq("player_id", playerId)
        .eq("rest_days", restDays)
        .eq("game_season", lastSeason)
        .limit(1);

      if (fallbackError) {
        return { error: fallbackError.message };
      }

      restRow = fallbackData?.[0];

      if (!restRow || restRow[statColumn] == null) {
        return {
          rest_days: restDays,
          info: `No ${statType.toUpperCase()} data available for ${restDays} days rest.`,
        };
      }
    }

    return {
      rest_days: restRow.rest_days,
      games_played: restRow.games_played,
      [statColumn]: restRow[statColumn],
      context: `On ${restRow.rest_days} days rest, this player is averaging ${restRow[statColumn]} ${statType.toUpperCase()} (${restRow.games_played} games).`,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in restDayPerformance.js" };
  }
}
