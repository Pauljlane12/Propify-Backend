/**
 * insights/MLhomeAwaySplit.js
 * Shows team's win/loss record at home or away — based on where they're playing tonight.
 * Falls back to previous season ONLY if there are zero current-season games at that location.
 */

import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getHomeAwaySplit({ teamId, opponentTeamId, supabase }) {
  const insightId = "moneyline_home_away_split";
  const insightTitle = "Home vs Away Win Rate";

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    // ───────────────────────────────────────────────
    // Step 1: Get upcoming game to check location
    // ───────────────────────────────────────────────
    const { data: nextGame, error: gameErr } = await supabase
      .from("games")
      .select("home_team_id, visitor_team_id, date")
      .neq("status", "Final")
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!nextGame) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: "No upcoming game found for this team.",
        status: "info",
        details: [],
      };
    }

    const isHome = nextGame.home_team_id === teamId;
    const location = isHome ? "home" : "away";
    const column = isHome ? "home_team_id" : "visitor_team_id";

    // ───────────────────────────────────────────────
    // Step 2: Fetch current season games
    // ───────────────────────────────────────────────
    const fetchGames = async (season) => {
      const { data, error } = await supabase
        .from("games")
        .select("home_team_id, visitor_team_id, home_team_score, visitor_team_score, status, season")
        .eq("season", season)
        .eq("status", "Final")
        .eq(column, teamId);

      if (error) throw error;
      return data || [];
    };

    let games = await fetchGames(currentSeason);

    // Fallback to previous season only if zero current season games at location
    if (games.length === 0) {
      const prevGames = await fetchGames(previousSeason);
      games = prevGames;
    }

    if (!games.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: `No ${location} game record found this or last season.`,
        status: "info",
        details: [],
      };
    }

    let wins = 0;
    let losses = 0;

    for (const game of games) {
      const teamScore = teamId === game.home_team_id ? game.home_team_score : game.visitor_team_score;
      const opponentScore = teamId === game.home_team_id ? game.visitor_team_score : game.home_team_score;
      if (teamScore > opponentScore) wins++;
      else losses++;
    }

    const total = wins + losses;
    const winRate = total > 0 ? (wins / total) : 0;

    return {
      id: insightId,
      title: insightTitle,
      value: `${wins}W - ${losses}L`,
      context: `This team is playing ${location.toUpperCase()} tonight and has a ${(
        winRate * 100
      ).toFixed(0)}% win rate (${wins}–${losses}) ${location} this season${games[0]?.season === previousSeason ? " (from last season)" : ""}.`,
      status: "info",
      details: {
        location,
        totalGames: total,
        wins,
        losses,
        winRate,
        seasonUsed: games[0]?.season,
      },
    };
  } catch (err) {
    console.error(`❌ Error in ${insightTitle}:`, err.message);
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: `Could not calculate home/away win rate.`,
      status: "danger",
      error: err.message,
    };
  }
}
