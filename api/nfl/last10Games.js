// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLLast10Games({
  playerId,
  playerName,
  statType,
  line,
  direction,
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

    // Get recent games for the current season
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week, home_team_id, visitor_team_id")
      .eq("season", currentSeason)
      .order("date", { ascending: false })
      .limit(20);

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    if (!games || games.length === 0) {
      return { error: "No games found for current season" };
    }

    // Get player stats for recent games
    const gameIds = games.map(g => g.id);
    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", gameIds)
      .order("game_id", { ascending: false })
      .limit(10);

    if (statsError) {
      return { error: `Player stats query error: ${statsError.message}` };
    }

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Handle case where no player_stats data is available
    if (!playerStats || playerStats.length === 0) {
      // Try to get season stats as fallback
      const { data: seasonStatsArray, error: seasonError } = await supabase
        .from("season_stats")
        .select(`${normalizedStatType}, games_played`)
        .eq("player_id", playerId)
        .eq("season", currentSeason)
        .eq("postseason", false)
        .limit(1);

      if (seasonError || !seasonStatsArray || seasonStatsArray.length === 0) {
        return {
          statType,
          normalizedStatType,
          season: currentSeason,
          context: `No recent game data available for **${lastName}**. Individual game stats may not be tracked for this player.`,
          averageValue: null,
          hitRate: null,
          gamesAnalyzed: 0,
          recommendation: "Unable to analyze recent performance due to missing game-by-game data.",
        };
      }

      const seasonStats = seasonStatsArray[0];
      const seasonValue = seasonStats?.[normalizedStatType] || 0;
      const gamesPlayed = seasonStats?.games_played || 0;
      const averagePerGame = gamesPlayed > 0 ? (seasonValue / gamesPlayed).toFixed(1) : 0;

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `**${lastName}** season average: **${averagePerGame} ${statType.toUpperCase()}** per game (${seasonValue} total in ${gamesPlayed} games). Individual game data not available.`,
        averageValue: +averagePerGame,
        hitRate: null,
        gamesAnalyzed: gamesPlayed,
        recommendation: `Based on season average of ${averagePerGame} ${statType.toUpperCase()} per game.`,
      };
    }

    // Process available game stats
    const validStats = playerStats
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);

    if (validStats.length === 0) {
      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `**${lastName}** has no valid ${statType.toUpperCase()} data in recent games.`,
        averageValue: 0,
        hitRate: 0,
        gamesAnalyzed: 0,
        recommendation: "Insufficient data for analysis.",
      };
    }

    // Calculate average
    const average = validStats.reduce((sum, val) => sum + val, 0) / validStats.length;

    // Calculate hit rate based on line and direction
    let hits = 0;
    if (line !== undefined && line !== null) {
      hits = validStats.filter(val => {
        return direction === 'over' ? val > line : val < line;
      }).length;
    }

    const hitRate = validStats.length > 0 ? ((hits / validStats.length) * 100).toFixed(1) : 0;

    // Generate context and recommendation
    const context = `**${lastName}** is averaging **${average.toFixed(1)} ${statType.toUpperCase()}** over last ${validStats.length} games.`;
    
    let recommendation = "";
    if (line !== undefined && line !== null) {
      const hitRateNum = parseFloat(hitRate);
      if (hitRateNum >= 70) {
        recommendation = `Strong trend: ${hitRate}% hit rate ${direction} ${line}`;
      } else if (hitRateNum >= 50) {
        recommendation = `Moderate trend: ${hitRate}% hit rate ${direction} ${line}`;
      } else {
        recommendation = `Weak trend: ${hitRate}% hit rate ${direction} ${line}`;
      }
    } else {
      recommendation = `Recent average: ${average.toFixed(1)} ${statType.toUpperCase()}`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      averageValue: +average.toFixed(1),
      hitRate: +hitRate,
      gamesAnalyzed: validStats.length,
      recommendation,
    };
  } catch (err) {
    return { error: `Last 10 games error: ${err.message}` };
  }
} 