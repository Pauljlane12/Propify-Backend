/**
 * insights/MLheadToHead.js
 * Returns the last 8 head-to-head matchups between two teams, ordered by recency.
 * Works across all seasons. Will return fewer if not available.
 */

export async function getHeadToHeadRecord({ teamId, opponentTeamId, supabase }) {
  const insightId = "moneyline_head_to_head";
  const insightTitle = "Head-to-Head Record";

  try {
    const { data: games, error } = await supabase
      .from("games")
      .select("id, date, season, home_team_id, visitor_team_id, home_team_score, visitor_team_score")
      .eq("status", "Final")
      .or(
        `(home_team_id.eq.${teamId},visitor_team_id.eq.${opponentTeamId}),(home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${teamId})`
      )
      .order("date", { ascending: false })
      .limit(8);

    if (error) throw error;

    if (!games.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: `No recent matchups found between Team ${teamId} and Team ${opponentTeamId}.`,
        status: "info",
        details: [],
      };
    }

    let wins = 0;
    let losses = 0;

    const breakdown = games.map((g) => {
      const isHome = g.home_team_id === teamId;
      const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
      const opponentScore = isHome ? g.visitor_team_score : g.home_team_score;
      const teamWon = teamScore > opponentScore;

      if (teamWon) wins++;
      else losses++;

      return {
        game_id: g.id,
        date: g.date,
        season: g.season,
        location: isHome ? "home" : "away",
        team_score: teamScore,
        opponent_score: opponentScore,
        team_won: teamWon,
      };
    });

    return {
      id: insightId,
      title: insightTitle,
      value: `${wins}W - ${losses}L`,
      context: `This team is ${wins}–${losses} in their last ${games.length} matchups vs this opponent.`,
      status: "info",
      details: breakdown,
    };
  } catch (err) {
    console.error(`❌ Error in ${insightTitle}:`, err.message);
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: "Could not retrieve head-to-head record.",
      status: "danger",
      error: err.message,
    };
  }
}
