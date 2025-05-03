import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

/**
 * Returns last 10 completed games for a team, falling back to previous season if needed.
 */
export async function getLast10Results({ teamId, supabase }) {
  const insightId = "moneyline_last_10";
  const insightTitle = "Last 10 Games";
  const requiredGames = 10;

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    const fetchGames = async (season, limit) => {
      const { data, error } = await supabase
        .from("games")
        .select("id, date, season, home_team_id, visitor_team_id, home_team_score, visitor_team_score")
        .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
        .eq("season", season)
        .eq("status", "Final")
        .order("date", { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`❌ Supabase error fetching games for season ${season}:`, error.message);
        return [];
      }
      return data || [];
    };

    const currentGames = await fetchGames(currentSeason, requiredGames);
    let allGames = [...currentGames];

    if (currentGames.length < requiredGames) {
      const remaining = requiredGames - currentGames.length;
      const previousGames = await fetchGames(previousSeason, remaining);
      allGames = allGames.concat(previousGames);
    }

    if (!allGames.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: "No final games found for this team in recent seasons.",
        status: "info",
        details: [],
      };
    }

    const formatted = allGames.map((g) => {
      const isHome = g.home_team_id === teamId;
      const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
      const opponentScore = isHome ? g.visitor_team_score : g.home_team_score;
      const teamWon = teamScore > opponentScore;
      const opponentId = isHome ? g.visitor_team_id : g.home_team_id;

      return {
        game_id: g.id,
        date: g.date,
        season: g.season,
        location: isHome ? "home" : "away",
        team_score: teamScore,
        opponent_score: opponentScore,
        team_won: teamWon,
        opponent_team_id: opponentId,
      };
    });

    const wins = formatted.filter((g) => g.team_won).length;
    const losses = formatted.length - wins;

    return {
      id: insightId,
      title: insightTitle,
      value: `${wins}W - ${losses}L`,
      context: `Over their last ${formatted.length} games, this team has gone ${wins}–${losses}.`,
      status: "info",
      details: formatted,
    };
  } catch (err) {
    console.error(`❌ Error in ${insightTitle}:`, err.message);
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: "Could not fetch last 10 game results.",
      status: "danger",
      error: err.message,
    };
  }
}
