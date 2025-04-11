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

    // 3. Calculate rest days (rounded down to whole days)
    const restDays = Math.max(
      0,
      Math.floor(
        (new Date(nextGameDate) - new Date(lastGameDate)) / (1000 * 60 * 60 * 24)
      )
    );

    const statColumn = `avg_${statType}`; // e.g. avg_pts, avg_reb

    // 4. Pull performance data from rest_day_averages table
    const { data: restRow, error: restError } = await supabase
      .from("player_rest_day_averages")
      .select(`${statColumn}, rest_days, games_played`)
      .eq("player_id", playerId)
      .eq("rest_days", restDays)
      .eq("game_season", CURRENT_SEASON)
      .maybeSingle();

    if (restError) {
      return { error: restError.message };
    }

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
