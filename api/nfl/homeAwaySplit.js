export async function getNFLHomeAwaySplit({ 
  playerId, 
  teamId, 
  statType, 
  supabase 
}) {
  try {
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

    // Get all player stats with game info
    const { data: statRows, error: statsError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType}, 
        team_id, 
        game_id,
        games!inner(home_team_id, visitor_team_id, date, season)
      `)
      .eq("player_id", playerId)
      .not(normalizedStatType, "is", null);

    if (statsError) {
      return { error: statsError.message };
    }

    if (!statRows || statRows.length === 0) {
      return { error: "No valid games found" };
    }

    // Separate home and away games
    const home = [];
    const away = [];

    for (const row of statRows) {
      const isHome = row.team_id === row.games.home_team_id;
      const statValue = row[normalizedStatType];
      
      if (statValue !== null && statValue !== undefined) {
        (isHome ? home : away).push(statValue);
      }
    }

    const avg = (arr) =>
      arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;

    const homeAvg = avg(home);
    const awayAvg = avg(away);

    // NFL-specific home field advantage analysis
    let homeFieldAdvantage = null;
    let advantageContext = "";

    if (homeAvg !== null && awayAvg !== null) {
      homeFieldAdvantage = +(homeAvg - awayAvg).toFixed(2);
      
      if (Math.abs(homeFieldAdvantage) >= 1) {
        const direction = homeFieldAdvantage > 0 ? "better" : "worse";
        const magnitude = Math.abs(homeFieldAdvantage);
        advantageContext = ` Shows a **${direction}** home performance by **${magnitude}** ${statType.toUpperCase()}.`;
      } else {
        advantageContext = " Shows **minimal home/away difference**.";
      }
    }

    // Context based on NFL home field advantages
    let context;
    if (homeAvg !== null && awayAvg !== null) {
      context = `**Home:** ${homeAvg} ${statType.toUpperCase()} (${home.length} games) vs **Away:** ${awayAvg} ${statType.toUpperCase()} (${away.length} games).${advantageContext}`;
    } else if (homeAvg !== null) {
      context = `Only **home** data available: ${homeAvg} ${statType.toUpperCase()} (${home.length} games).`;
    } else if (awayAvg !== null) {
      context = `Only **away** data available: ${awayAvg} ${statType.toUpperCase()} (${away.length} games).`;
    } else {
      context = "No home/away split data available.";
    }

    return {
      statType,
      normalizedStatType,
      context,
      homeAvg,
      awayAvg,
      homeGames: home.length,
      awayGames: away.length,
      homeFieldAdvantage,
      homeValues: home,
      awayValues: away,
    };
  } catch (err) {
    return { error: err.message };
  }
} 