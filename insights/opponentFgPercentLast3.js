export async function getFgTrendLast3ForBothTeams({ teamId, opponentTeamId, supabase }) {
  try {
    const getFgPctForTeam = async (teamIdToCheck) => {
      const { data: recentGames, error: gamesError } = await supabase
        .from("games")
        .select("id, date")
        .or(`home_team_id.eq.${teamIdToCheck},visitor_team_id.eq.${teamIdToCheck}`)
        .eq("status", "Final")
        .order("date", { ascending: false })
        .limit(3);

      if (gamesError || !recentGames?.length) {
        return { error: `No recent games found for team ${teamIdToCheck}.` };
      }

      const gameDates = recentGames.map((g) => g.date);

      const { data: boxScores, error: boxError } = await supabase
        .from("box_scores")
        .select("fga, fgm")
        .eq("team_id", teamIdToCheck)
        .in("game_date", gameDates);

      if (boxError || !boxScores?.length) {
        return { error: `No box scores found for team ${teamIdToCheck}.` };
      }

      const totalFGA = boxScores.reduce((sum, row) => sum + (row.fga || 0), 0);
      const totalFGM = boxScores.reduce((sum, row) => sum + (row.fgm || 0), 0);
      const fgPct = totalFGA > 0 ? (totalFGM / totalFGA) * 100 : null;

      return {
        fgPctLast3: fgPct ? +fgPct.toFixed(1) : null,
        gamesAnalyzed: gameDates.length,
      };
    };

    // ⏱ Analyze both teams
    const leagueAvgFGPct = 47.0;

    const oppResult = await getFgPctForTeam(opponentTeamId);
    const playerResult = await getFgPctForTeam(teamId);

    const context = {
      opponent: oppResult.fgPctLast3 !== null
        ? `Opponent has shot ${oppResult.fgPctLast3}% over their last 3 games.`
        : "Could not calculate opponent's FG%.",
      playerTeam: playerResult.fgPctLast3 !== null
        ? `Player's team has shot ${playerResult.fgPctLast3}% over their last 3 games.`
        : "Could not calculate player's team FG%.",
      reboundingOutlook: oppResult.fgPctLast3 < leagueAvgFGPct
        ? "✅ Opponent is shooting poorly — more missed shots could mean more rebounds."
        : "⚠️ Opponent is shooting well — fewer missed shots may limit rebounding chances.",
    };

    return {
      id: "fg_trend_last3_both_teams",
      title: "Recent FG% Trend (Both Teams)",
      fgPctOpponent: oppResult.fgPctLast3,
      fgPctPlayerTeam: playerResult.fgPctLast3,
      context,
      status: "info",
    };
  } catch (err) {
    return { error: err.message };
  }
}
