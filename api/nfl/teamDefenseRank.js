import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLTeamDefenseRank({
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    // NFL stat type mapping
    const statTypeAliasMap = {
      // Passing stats
      pass_yds: "passing_yards",
      pass_tds: "passing_touchdowns",
      pass_comp: "passing_completions",
      pass_att: "passing_attempts",
      pass_int: "passing_interceptions",
      qb_rating: "qb_rating",
      
      // Rushing stats
      rush_yds: "rushing_yards",
      rush_tds: "rushing_touchdowns",
      rush_att: "rushing_attempts",
      
      // Receiving stats
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

    // Get opponent team info
    const { data: teamInfo, error: teamError } = await supabase
      .from("teams")
      .select("full_name, abbreviation")
      .eq("id", opponentTeamId)
      .maybeSingle();

    if (teamError) {
      return { error: teamError.message };
    }

    const teamName = teamInfo?.full_name || "Unknown Team";
    const teamAbbr = teamInfo?.abbreviation || "UNK";

    // Get all games where this team was the opponent (either home or away)
    const { data: opponentGames, error: gamesError } = await supabase
      .from("games")
      .select("id, home_team_id, visitor_team_id")
      .eq("season", currentSeason)
      .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`);

    if (gamesError) {
      return { error: gamesError.message };
    }

    if (!opponentGames || opponentGames.length === 0) {
      return { error: `No games found for ${teamName} this season` };
    }

    // Get all player stats against this opponent
    const gameIds = opponentGames.map(game => game.id);
    
    const { data: statsAgainstOpponent, error: statsError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        team_id,
        game_id
      `)
      .in("game_id", gameIds)
      .not("team_id", "eq", opponentTeamId) // Exclude the opponent team's own stats
      .not(normalizedStatType, "is", null);

    if (statsError) {
      return { error: statsError.message };
    }

    if (!statsAgainstOpponent || statsAgainstOpponent.length === 0) {
      return { 
        error: `No ${statType} data found against ${teamName} this season`,
        context: `**${teamName}** defense data not available for **${statType.toUpperCase()}** analysis.`
      };
    }

    // Calculate average allowed by opponent defense
    const statValues = statsAgainstOpponent
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);

    const avgAllowed = statValues.length > 0 
      ? +(statValues.reduce((a, b) => a + b, 0) / statValues.length).toFixed(1)
      : null;

    // Get league average for comparison (all teams)
    const { data: leagueStats, error: leagueError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        games!inner(season)
      `)
      .eq("games.season", currentSeason)
      .not(normalizedStatType, "is", null);

    if (leagueError) {
      return { error: leagueError.message };
    }

    const leagueValues = (leagueStats || [])
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);

    const leagueAvg = leagueValues.length > 0 
      ? +(leagueValues.reduce((a, b) => a + b, 0) / leagueValues.length).toFixed(1)
      : null;

    // Determine defensive strength
    let defenseRating = "Average";
    let defenseContext = "";

    if (avgAllowed !== null && leagueAvg !== null) {
      const difference = avgAllowed - leagueAvg;
      const percentDiff = ((difference / leagueAvg) * 100).toFixed(1);

      if (difference > leagueAvg * 0.1) { // 10% above league average
        defenseRating = "Weak";
        defenseContext = `**${teamAbbr}** allows **${avgAllowed}** ${statType.toUpperCase()} per game (**${percentDiff}%** above league average of **${leagueAvg}**). **Favorable matchup**.`;
      } else if (difference < -leagueAvg * 0.1) { // 10% below league average
        defenseRating = "Strong";
        defenseContext = `**${teamAbbr}** allows only **${avgAllowed}** ${statType.toUpperCase()} per game (**${Math.abs(percentDiff)}%** below league average of **${leagueAvg}**). **Tough matchup**.`;
      } else {
        defenseRating = "Average";
        defenseContext = `**${teamAbbr}** allows **${avgAllowed}** ${statType.toUpperCase()} per game (near league average of **${leagueAvg}**). **Neutral matchup**.`;
      }
    } else if (avgAllowed !== null) {
      defenseContext = `**${teamAbbr}** allows **${avgAllowed}** ${statType.toUpperCase()} per game this season.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context: defenseContext,
      opponentTeam: teamName,
      opponentAbbr: teamAbbr,
      avgAllowed,
      leagueAvg,
      defenseRating,
      gamesAnalyzed: opponentGames.length,
      statsCount: statValues.length,
    };
  } catch (err) {
    return { error: err.message };
  }
} 