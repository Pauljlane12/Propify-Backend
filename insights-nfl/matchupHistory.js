import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLMatchupHistory({
  playerId,
  playerName,
  opponentTeamId,
  statType,
  bettingLine,
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
    const parsedLine = Number(bettingLine);
    const hasLine = !Number.isNaN(parsedLine);

    // Get current season matchup data
    const { data: currentSeasonStats, error: currentError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        games!inner(
          date, 
          week, 
          season, 
          home_team_id, 
          visitor_team_id
        )
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .not(normalizedStatType, "is", null)
      .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`, { foreignTable: "games" });

    if (currentError) {
      return { error: currentError.message };
    }

    // Get historical matchup data (previous seasons)
    const { data: historicalStats, error: historicalError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        games!inner(
          date, 
          week, 
          season, 
          home_team_id, 
          visitor_team_id
        )
      `)
      .eq("player_id", playerId)
      .lt("games.season", currentSeason)
      .not(normalizedStatType, "is", null)
      .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`, { foreignTable: "games" })
      .order("games.date", { ascending: false })
      .limit(5);

    if (historicalError) {
      return { error: historicalError.message };
    }

    // Get opponent team name
    const { data: teamRow, error: teamError } = await supabase
      .from("teams")
      .select("full_name")
      .eq("id", opponentTeamId)
      .maybeSingle();

    if (teamError) {
      return { error: teamError.message };
    }

    const teamName = teamRow?.full_name || "the opponent";
    
    // Process current season data
    const currentValues = (currentSeasonStats || [])
      .map(game => game[normalizedStatType])
      .filter(val => val !== null);
    
    const currentAvg = currentValues.length > 0 
      ? +(currentValues.reduce((a, b) => a + b, 0) / currentValues.length).toFixed(1) 
      : null;

    // Process historical data
    const historicalValues = (historicalStats || [])
      .map(game => game[normalizedStatType])
      .filter(val => val !== null);
    
    const historicalAvg = historicalValues.length > 0 
      ? +(historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length).toFixed(1) 
      : null;

    // Calculate hit rate if line provided
    const currentHitCount = hasLine && currentValues.length > 0 
      ? currentValues.filter(val => val >= parsedLine).length 
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    let context;
    if (currentAvg !== null && currentValues.length > 0) {
      const lineInfo = hasLine
        ? `, he has cleared the line (**${parsedLine}**) in **${currentHitCount} of ${currentValues.length} matchups**`
        : "";
      context = `In **${lastName}'s** last **${currentValues.length} matchups** vs the **${teamName}**${lineInfo}, averaging **${currentAvg} ${statType.toUpperCase()}**.`;
    } else if (historicalAvg !== null) {
      context = `**${lastName}** has not faced the **${teamName}** this season but averages **${historicalAvg} ${statType.toUpperCase()}** against them all-time.`;
    } else {
      context = `No matchup history found for **${lastName}** vs the **${teamName}**.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      currentSeasonAverage: currentAvg,
      historicalAverage: historicalAvg,
      currentSeasonGames: currentValues.length,
      historicalGames: historicalValues.length,
      hitCount: currentHitCount,
      currentValues,
      historicalValues,
    };
  } catch (err) {
    return { error: err.message };
  }
} 