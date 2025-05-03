/**
 * insights/MLhomeAwayLast5.js
 * Returns the last 5 home or away games for a team, with fallback to previous seasons if needed.
 */

import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getHomeAwayLast5({ teamId, location, supabase }) {
  const insightId = "moneyline_home_away_last5";
  const insightTitle = `Last 5 ${location === "home" ? "Home" : "Away"} Games`;

  try {
    if (!["home", "away"].includes(location)) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: `Invalid location: ${location}. Must be 'home' or 'away'.`,
        status: "danger",
        details: [],
      };
    }

    const locationColumn = location === "home" ? "home_team_id" : "visitor_team_id";
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    const fetchGames = async (season) => {
      const { data, error } = await supabase
        .from("games")
        .select("id, date, home_team_id, visitor_team_id, home_team_score, visitor_team_score, season")
        .eq(locationColumn, teamId)
        .eq("status", "Final")
        .eq("season", season)
        .order("date", { ascending: false })
        .limit(10); // buffer more than needed

      if (error) throw error;
      return data || [];
    };

    let currentGames = await fetchGames(currentSeason);
    let previousGames = [];

    if (currentGames.length < 5) {
      previousGames = await fetchGames(previousSeason);
    }

    const combinedGames = [...currentGames, ...previousGames].slice(0, 5);

    if (!combinedGames.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: `No recent ${location} games found across current or previous season.`,
        status: "info",
        details: [],
      };
    }

    const breakdown = combinedGames.map((g) => {
      const isHome = g.home_team_id === teamId;
      const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
      const opponentScore = isHome ? g.visitor_team_score : g.home_team_score;
      const opponentId = isHome ? g.visitor_team_id : g.home_team_id;
      const result = teamScore > opponentScore ? "W" : "L";

      return {
        game_id: g.id,
        date: g.date,
        season: g.season,
        opponent_team_id: opponentId,
        team_score: teamScore,
        opponent_score: opponentScore,
        result,
        location,
      };
    });

    const wins = breakdown.filter((g) => g.result === "W").length;
    const losses = breakdown.length - wins;

    return {
      id: insightId,
      title: insightTitle,
      value: `${wins}W - ${losses}L`,
      context: `This team is ${wins}–${losses} in their last ${breakdown.length} ${location} games (across seasons).`,
      status: "info",
      details: breakdown,
    };
  } catch (err) {
    console.error(`❌ Error in ${insightTitle}:`, err.message);
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: `Could not retrieve last 5 ${location} games.`,
      status: "danger",
      error: err.message,
    };
  }
}
