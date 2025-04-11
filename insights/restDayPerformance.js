import { CURRENT_SEASON } from "./constants.js";

export async function getRestDayPerformance({
  playerId,
  teamId,
  statType,
  supabase,
}) {
  try {
    // 1. Get the next scheduled game for this team
    const { data: upcomingGames, error: upcomingError } = await supabase
      .from("games")
      .select("date")
      .neq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .order("date", { ascending: true })
      .limit(1);

    const nextGameDate = upcomingGames?.[0]?.date;
    if (upcomingError || !nextGameDate) {
      return { info: "No upcoming game found for this team." };
    }

    // 2. Get the most recent completed game for this team
    const { data: lastGames, error: lastError } = await supabase
      .from("games")
      .select("date")
      .eq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .order("date", { ascending: false })
      .limit(1);

    const lastGameDate = lastGames?.[0]?.date;
    if (lastError || !lastGameDate) {
      return { info: "No last completed game found for this team." };
    }

    // 3. Calculate rest days (NBA logic: subtract 1 day between games)
    const diffInDays = Math.floor(
      (new Date(nextGameDate) - new Date(lastGameDate)) / (1000 * 60 * 60 * 24)
    );
    const restDays = Math.max(0, diffInDays - 1); // ✅ Use GREATEST(diff - 1, 0)

    const statColumn = `avg_${statType}`;

    // 4. Lookup player's performance for this rest_days value
    const { data: rows, error: restError } = await supabase
      .from("player_rest_day_averages")
      .select(`${statColumn}, rest_days, games_played`)
      .eq("player_id", playerId)
      .eq("rest_days", restDays)
      .eq("game_season", CURRENT_SEASON)
      .limit(1);

    if (restError) {
      return { error: restError.message };
    }

    const restRow = rows?.[0];

    if (!restRow || restRow[statColumn] == null) {
      return {
        rest_days: restDays,
        info: `No ${statType.toUpperCase()} data available for ${restDays} days rest.`,
      };
    }

    return {
      rest_days: restRow.rest_days,
      games_played: restRow.games_played,
      [statColumn]: restRow[statColumn],
      context: `On ${restRow.rest_days} days rest this season, this player is averaging ${restRow[statColumn]} ${statType.toUpperCase()} (${restRow.games_played} games).`,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in restDayPerformance.js" };
  }
}
