// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLSeasonVsLast3({
  playerId,
  playerName,
  statType,
  supabase,
}) {
  try {
    const currentSeason = getCurrentSeason();

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

    // Get season stats - use limit(1) instead of single() to handle duplicates
    const { data: seasonStatsArray, error: seasonError } = await supabase
      .from("season_stats")
      .select(normalizedStatType)
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .eq("postseason", false)
      .limit(1);

    if (seasonError) {
      return { error: `Season stats query error: ${seasonError.message}` };
    }

    // Handle case where no season stats are found
    if (!seasonStatsArray || seasonStatsArray.length === 0) {
      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `No season stats available for **${lastName}** in ${currentSeason}. Unable to compare recent performance to season average.`,
        seasonAverage: null,
        last3Average: null,
        difference: null,
        percentChange: null,
        trend: "unknown",
        gameCount: 0,
      };
    }

    const seasonStats = seasonStatsArray[0]; // Get first record to handle duplicates

    // Get games for the player in current season, ordered by date
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week")
      .eq("season", currentSeason)
      .order("date", { ascending: false })
      .limit(10);

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    if (!games || games.length === 0) {
      return { error: "No games found for current season" };
    }

    // Get player stats for last 3 games
    const gameIds = games.slice(0, 3).map(g => g.id);
    const { data: last3Stats, error: last3Error } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", gameIds);

    if (last3Error) {
      return { error: `Last 3 games query error: ${last3Error.message}` };
    }

    // Calculate averages
    const seasonValue = seasonStats?.[normalizedStatType] || 0;
    
    const last3Values = (last3Stats || [])
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);
    
    const last3Average = last3Values.length > 0 
      ? +(last3Values.reduce((a, b) => a + b, 0) / last3Values.length).toFixed(1)
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Handle case where no recent game data is available
    if (last3Average === null) {
      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `**${lastName}** season average: **${seasonValue} ${statType.toUpperCase()}**. No recent game data available for comparison.`,
        seasonAverage: seasonValue,
        last3Average: null,
        difference: null,
        percentChange: null,
        trend: "unknown",
        gameCount: 0,
      };
    }

    // Calculate difference and trend
    const difference = last3Average - seasonValue;
    const percentChange = seasonValue > 0 ? ((difference / seasonValue) * 100).toFixed(1) : 0;
    
    let trend = "stable";
    let trendDescription = "";
    
    if (Math.abs(difference) < 1) {
      trend = "stable";
      trendDescription = "consistent with season average";
    } else if (difference > 0) {
      trend = "improving";
      trendDescription = `${percentChange}% above season average`;
    } else {
      trend = "declining";
      trendDescription = `${Math.abs(percentChange)}% below season average`;
    }

    const context = `**${lastName}** is averaging **${last3Average} ${statType.toUpperCase()}** in last 3 games vs **${seasonValue}** season average (${trendDescription}).`;

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      seasonAverage: seasonValue,
      last3Average,
      difference,
      percentChange: +percentChange,
      trend,
      gameCount: last3Values.length,
    };
  } catch (err) {
    return { error: `Season vs Last 3 error: ${err.message}` };
  }
} 