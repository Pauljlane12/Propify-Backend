// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLWeatherImpact({
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

    // Check if weather table exists and get weather data
    const { data: weatherGames, error: weatherError } = await supabase
      .from("weather")
      .select("game_id, temperature, wind_speed, precipitation, conditions")
      .not("temperature", "is", null)
      .limit(100);

    // If no weather data, provide general context
    if (weatherError || !weatherGames || weatherGames.length === 0) {
      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `Weather data not available for **${lastName}**. Monitor game-day weather conditions for potential impact on ${statType.toUpperCase()}.`,
        hasWeatherData: false,
        weatherImpact: "unknown",
        recommendation: "Check weather conditions closer to game time.",
      };
    }

    // Get games for current and recent seasons
    const recentSeasons = [currentSeason, currentSeason - 1];
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week, season")
      .in("season", recentSeasons)
      .order("date", { ascending: false });

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    // Get player stats for games with weather data
    const weatherGameIds = weatherGames.map(w => w.game_id);
    const relevantGames = games?.filter(g => weatherGameIds.includes(g.id)) || [];
    const relevantGameIds = relevantGames.map(g => g.id);

    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", relevantGameIds);

    if (statsError) {
      return { error: `Player stats query error: ${statsError.message}` };
    }

    if (!playerStats || playerStats.length === 0) {
      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `No weather-tracked games found for **${lastName}**. Weather impact analysis not available.`,
        hasWeatherData: false,
        weatherImpact: "unknown",
        recommendation: "Monitor weather conditions for potential impact.",
      };
    }

    // Merge stats with weather data
    const statsWithWeather = playerStats
      .map(stat => {
        const weather = weatherGames.find(w => w.game_id === stat.game_id);
        const game = relevantGames.find(g => g.id === stat.game_id);
        return { ...stat, weather, game };
      })
      .filter(stat => stat.weather && stat.game && stat[normalizedStatType] !== null);

    if (statsWithWeather.length === 0) {
      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `Insufficient weather data for **${lastName}**. Monitor game-day conditions.`,
        hasWeatherData: false,
        weatherImpact: "unknown",
        recommendation: "Check weather forecast before game time.",
      };
    }

    // Categorize games by weather conditions
    const goodWeatherGames = [];
    const badWeatherGames = [];
    const coldWeatherGames = [];
    const windyGames = [];

    for (const statGame of statsWithWeather) {
      const { weather } = statGame;
      const temp = weather.temperature || 70;
      const wind = weather.wind_speed || 0;
      const precipitation = weather.precipitation || 0;
      const statValue = statGame[normalizedStatType];

      // Categorize weather conditions
      const isCold = temp < 40;
      const isWindy = wind > 15;
      const hasRain = precipitation > 0;
      const isBadWeather = isCold || isWindy || hasRain;

      if (isBadWeather) {
        badWeatherGames.push(statValue);
      } else {
        goodWeatherGames.push(statValue);
      }

      if (isCold) {
        coldWeatherGames.push(statValue);
      }

      if (isWindy) {
        windyGames.push(statValue);
      }
    }

    // Calculate averages
    const goodWeatherAvg = goodWeatherGames.length > 0 
      ? +(goodWeatherGames.reduce((a, b) => a + b, 0) / goodWeatherGames.length).toFixed(1)
      : null;

    const badWeatherAvg = badWeatherGames.length > 0 
      ? +(badWeatherGames.reduce((a, b) => a + b, 0) / badWeatherGames.length).toFixed(1)
      : null;

    const coldWeatherAvg = coldWeatherGames.length > 0 
      ? +(coldWeatherGames.reduce((a, b) => a + b, 0) / coldWeatherGames.length).toFixed(1)
      : null;

    const windyAvg = windyGames.length > 0 
      ? +(windyGames.reduce((a, b) => a + b, 0) / windyGames.length).toFixed(1)
      : null;

    // Determine weather impact
    let weatherImpact = "neutral";
    let impactDescription = "";
    let recommendation = "";

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    if (goodWeatherAvg !== null && badWeatherAvg !== null) {
      const difference = goodWeatherAvg - badWeatherAvg;
      const percentDiff = goodWeatherAvg > 0 ? ((difference / goodWeatherAvg) * 100).toFixed(1) : 0;

      if (Math.abs(difference) < 1) {
        weatherImpact = "minimal";
        impactDescription = "shows minimal weather sensitivity";
        recommendation = "Weather conditions unlikely to significantly impact performance.";
      } else if (difference > 0) {
        weatherImpact = "negative";
        impactDescription = `performs ${Math.abs(percentDiff)}% worse in bad weather`;
        recommendation = "Consider weather conditions - bad weather may hurt performance.";
      } else {
        weatherImpact = "positive";
        impactDescription = `performs ${Math.abs(percentDiff)}% better in challenging conditions`;
        recommendation = "Bad weather may actually benefit this player's performance.";
      }
    } else if (goodWeatherAvg !== null) {
      impactDescription = "limited weather data available";
      recommendation = "Monitor weather conditions for potential impact.";
    } else {
      impactDescription = "insufficient weather data";
      recommendation = "Weather impact unknown - check conditions before betting.";
    }

    // Build context
    let context = `**${lastName}** ${impactDescription}.`;
    
    if (goodWeatherAvg !== null && badWeatherAvg !== null) {
      context += ` Good weather: **${goodWeatherAvg}** (${goodWeatherGames.length} games) vs Bad weather: **${badWeatherAvg}** (${badWeatherGames.length} games).`;
    }

    if (coldWeatherAvg !== null && coldWeatherGames.length >= 2) {
      context += ` Cold weather (<40°F): **${coldWeatherAvg}** (${coldWeatherGames.length} games).`;
    }

    if (windyAvg !== null && windyGames.length >= 2) {
      context += ` Windy conditions (>15mph): **${windyAvg}** (${windyGames.length} games).`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      hasWeatherData: true,
      weatherImpact,
      recommendation,
      goodWeatherAverage: goodWeatherAvg,
      badWeatherAverage: badWeatherAvg,
      coldWeatherAverage: coldWeatherAvg,
      windyAverage: windyAvg,
      goodWeatherGames: goodWeatherGames.length,
      badWeatherGames: badWeatherGames.length,
      coldWeatherGames: coldWeatherGames.length,
      windyGames: windyGames.length,
      totalWeatherGames: statsWithWeather.length,
    };
  } catch (err) {
    return { error: `Weather impact error: ${err.message}` };
  }
} 