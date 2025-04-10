import { CURRENT_SEASON } from "./constants.js";

export async function getRestDayPerformance({
  playerId,
  teamId,
  statType,
  supabase,
}) {
  try {
    // 1. Get next game for this team
    const { data: upcomingGames } = await supabase
      .from("games")
      .select("date")
      .neq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .order("date", { ascending: true })
      .limit(1);

    const nextGameDate = upcomingGames?.[0]?.date;
    if (!nextGameDate) return { error: "No upcoming game found." };

    // 2. Get last game date
    const { data: lastGames } = await supabase
      .from("games")
      .select("date")
      .eq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .order("date", { ascending: false })
      .limit(1);

    const lastGameDate = lastGames?.[0]?.date;
    if (!lastGameDate) return { error: "No previous game found." };

    // 3. Calculate rest days
    const restDays = Math.floor(
      (new Date(nextGameDate) - new Date(lastGameDate)) / (1000 * 60 * 60 * 24)
    );

    // 4. Get player's average for this rest day
    const { data: restRow } = await supabase
      .from("player_rest_day_averages")
      .select(`${statType}, rest_days, games_played`)
      .eq("player_id", playerId)
      .eq("rest_days", restDays)
      .eq("game_season", CURRENT_SEASON)
      .maybeSingle();

    if (!restRow) {
      return {
        rest_days: restDays,
        info: `No ${statType.toUpperCase()} data available for ${restDays} days rest.`,
      };
    }

    return {
      rest_days: restRow.rest_days,
      games_played: restRow.games_played,
      [`avg_${statType}`]: restRow[statType],
      context: `This player is averaging ${restRow[statType]} ${statType.toUpperCase()} on ${restRow.rest_days} days rest this season (${restRow.games_played} games).`,
    };
  } catch (err) {
    return { error: err.message };
  }
}
