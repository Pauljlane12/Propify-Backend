import { CURRENT_SEASON } from "./constants.js";

export async function getRestDayPerformance({
  playerId,
  teamId,
  statType,
  playerLastName,
  supabase,
}) {
  try {
    const statColumn = `avg_${statType}`;
    const lastSeason = CURRENT_SEASON - 1;

    const { count: currentSeasonGames, error: gamesError } = await supabase
      .from("player_stats")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0)
      .eq("game_season", CURRENT_SEASON);

    if (gamesError) return { error: gamesError.message };

    if (currentSeasonGames < 5) {
      return {
        info: `Not enough games played this season to generate rest-day performance insight (requires 5+).`,
      };
    }

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

    const diffInDays = Math.floor(
      (new Date(nextGameDate) - new Date(lastPlayedDate)) / (1000 * 60 * 60 * 24)
    );
    const restDays = Math.max(0, diffInDays - 1);

    const { data: currentRows, error: currentError } = await supabase
      .from("player_rest_day_averages")
      .select(`${statColumn}, rest_days, games_played`)
      .eq("player_id", playerId)
      .eq("rest_days", restDays)
      .eq("game_season", CURRENT_SEASON)
      .limit(1);

    if (currentError) return { error: currentError.message };

    let restRow = currentRows?.[0];

    if (!restRow || restRow[statColumn] == null) {
      const { data: fallbackRows, error: fallbackError } = await supabase
        .from("player_rest_day_averages")
        .select(`${statColumn}, rest_days, games_played`)
        .eq("player_id", playerId)
        .eq("rest_days", restDays)
        .eq("game_season", lastSeason)
        .limit(1);

      if (fallbackError) return { error: fallbackError.message };

      restRow = fallbackRows?.[0];

      if (!restRow || restRow[statColumn] == null) {
        return {
          rest_days: restDays,
          info: `No ${statType.toUpperCase()} data available for ${restDays} days rest.`,
        };
      }
    }

    // ✅ Final clean sentence
    const context = `**${playerLastName}** averages **${restRow[statColumn]} ${statType.toUpperCase()}** on **${restRow.rest_days} days of rest**.`;

    return {
      rest_days: restRow.rest_days,
      average: restRow[statColumn],
      season: restRow.game_season ?? CURRENT_SEASON,
      context,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in restDayPerformance.js" };
  }
}
