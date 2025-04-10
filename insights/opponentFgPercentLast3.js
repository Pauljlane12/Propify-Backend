export async function getOpponentFgPercentLast3({ opponentTeamId, supabase }) {
  try {
    // 1. Get last 3 completed games for this team
    const { data: recentGames, error: gamesError } = await supabase
      .from("games")
      .select("id, date")
      .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`)
      .eq("status", "Final")
      .order("date", { ascending: false })
      .limit(3);

    if (gamesError || !recentGames?.length) {
      return { error: "No recent final games found for opponent." };
    }

    const gameDates = recentGames.map((g) => g.date);

    // 2. Get box scores for those games (opponent team only)
    const { data: boxScores, error: boxError } = await supabase
      .from("box_scores")
      .select("fga, fgm")
      .eq("team_id", opponentTeamId)
      .in("game_date", gameDates);

    if (boxError || !boxScores?.length) {
      return { error: "No box scores found for opponent's recent games." };
    }

    // 3. Calculate FG%
    const totalFGA = boxScores.reduce((sum, row) => sum + (row.fga || 0), 0);
    const totalFGM = boxScores.reduce((sum, row) => sum + (row.fgm || 0), 0);
    const fgPct = totalFGA > 0 ? (totalFGM / totalFGA) * 100 : null;

    const leagueAvgFGPct = 47.0;
    const difference = fgPct ? +(fgPct - leagueAvgFGPct).toFixed(1) : null;

    return {
      fgPctLast3: fgPct ? +fgPct.toFixed(1) : null,
      leagueAvgFGPct,
      difference,
      gamesAnalyzed: gameDates.length,
      context: fgPct
        ? `The opponent has shot ${fgPct.toFixed(
            1
          )}% from the field over their last 3 games. League average is ~${leagueAvgFGPct}%. ${
            fgPct < leagueAvgFGPct
              ? "They’ve been shooting worse than average, which could lead to more rebound opportunities."
              : "They’ve been shooting well recently, which may reduce rebound volume."
          }`
        : "Could not calculate FG% over the last 3 games.",
    };
  } catch (err) {
    return { error: err.message };
  }
}
