// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLTeamDefenseRank({
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const currentSeason = getCurrentSeason();

    // NFL stat type mapping for defensive stats
    const statTypeAliasMap = {
      // Passing stats (what defense allows)
      pass_yds: "passing_yards",
      pass_tds: "passing_touchdowns",
      pass_comp: "passing_completions",
      pass_att: "passing_attempts",
      pass_int: "passing_interceptions",
      
      // Rushing stats (what defense allows)
      rush_yds: "rushing_yards",
      rush_tds: "rushing_touchdowns",
      rush_att: "rushing_attempts",
      
      // Receiving stats (what defense allows)
      rec_yds: "receiving_yards",
      rec_tds: "receiving_touchdowns",
      receptions: "receptions",
      targets: "receiving_targets",
      
      // Defense stats
      tackles: "total_tackles",
      sacks: "defensive_sacks",
      ints: "defensive_interceptions",
      
      // Kicking stats
      fg_made: "field_goals_made",
      fg_att: "field_goal_attempts",
      xp_made: "extra_points_made",
    };

    const normalizedStatType = statTypeAliasMap[statType] || statType;

    if (!opponentTeamId) {
      return { error: "Missing opponent team ID" };
    }

    // Get opponent team info
    const { data: opponentTeam, error: teamError } = await supabase
      .from("teams")
      .select("name, abbreviation")
      .eq("id", opponentTeamId)
      .single();

    if (teamError) {
      return { error: `Team query error: ${teamError.message}` };
    }

    // Get all teams for ranking comparison
    const { data: allTeams, error: allTeamsError } = await supabase
      .from("teams")
      .select("id, name, abbreviation");

    if (allTeamsError) {
      return { error: `All teams query error: ${allTeamsError.message}` };
    }

    // Get games for current season to analyze defensive performance
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, home_team_id, visitor_team_id")
      .eq("season", currentSeason);

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    // Calculate defensive stats for each team
    const teamDefenseStats = {};

    for (const team of allTeams) {
      // Get games where this team was defending (both home and away)
      const teamGames = games.filter(g => 
        g.home_team_id === team.id || g.visitor_team_id === team.id
      );
      
      if (teamGames.length === 0) continue;

      const gameIds = teamGames.map(g => g.id);
      
      // Get stats allowed by this team (opponent stats in their games)
      const { data: allowedStats, error: allowedError } = await supabase
        .from("player_stats")
        .select(`${normalizedStatType}, team_id, game_id`)
        .in("game_id", gameIds)
        .neq("team_id", team.id) // Stats by opponents, not the team itself
        .not(normalizedStatType, "is", null);

      if (!allowedError && allowedStats && allowedStats.length > 0) {
        const statValues = allowedStats.map(s => s[normalizedStatType]);
        const totalAllowed = statValues.reduce((a, b) => a + b, 0);
        const gamesPlayed = teamGames.length;
        const averageAllowed = gamesPlayed > 0 ? +(totalAllowed / gamesPlayed).toFixed(1) : 0;
        
        teamDefenseStats[team.id] = {
          teamId: team.id,
          teamName: team.abbreviation,
          averageAllowed,
          gamesPlayed,
          totalAllowed,
        };
      }
    }

    // Rank teams by defensive performance (lower allowed stats = better defense)
    const rankedDefenses = Object.values(teamDefenseStats)
      .filter(team => team.gamesPlayed > 0)
      .sort((a, b) => a.averageAllowed - b.averageAllowed);

    // Find opponent's rank
    const opponentStats = teamDefenseStats[opponentTeamId];
    const opponentRank = rankedDefenses.findIndex(team => team.teamId === opponentTeamId) + 1;
    
    if (!opponentStats || opponentRank === 0) {
      return { error: "No defensive data found for opponent team" };
    }

    const totalTeams = rankedDefenses.length;
    const opponentName = opponentTeam?.abbreviation || "opponent";

    // Determine defensive strength
    let defenseStrength = "";
    let strengthDescription = "";
    
    if (opponentRank <= totalTeams * 0.25) {
      defenseStrength = "elite";
      strengthDescription = "top-tier defense";
    } else if (opponentRank <= totalTeams * 0.5) {
      defenseStrength = "good";
      strengthDescription = "above-average defense";
    } else if (opponentRank <= totalTeams * 0.75) {
      defenseStrength = "average";
      strengthDescription = "middle-of-the-pack defense";
    } else {
      defenseStrength = "poor";
      strengthDescription = "below-average defense";
    }

    const context = `**${opponentName}** ranks **#${opponentRank} of ${totalTeams}** in ${statType.toUpperCase()} defense, allowing **${opponentStats.averageAllowed}** per game (${strengthDescription}).`;

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      opponentTeamId,
      opponentName,
      rank: opponentRank,
      totalTeams,
      averageAllowed: opponentStats.averageAllowed,
      gamesPlayed: opponentStats.gamesPlayed,
      defenseStrength,
      strengthDescription,
      allRankings: rankedDefenses.slice(0, 10), // Top 10 for reference
    };
  } catch (err) {
    return { error: `Team defense rank error: ${err.message}` };
  }
} 