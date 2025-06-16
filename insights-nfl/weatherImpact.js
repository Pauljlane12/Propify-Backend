import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLWeatherImpact({
  playerId,
  playerName,
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

    // Get player's position info
    const { data: playerInfo, error: playerError } = await supabase
      .from("players")
      .select("position, position_abbreviation, team_id")
      .eq("id", playerId)
      .maybeSingle();

    if (playerError) {
      return { error: playerError.message };
    }

    if (!playerInfo) {
      return { error: "Player not found" };
    }

    const { position, position_abbreviation: posAbbr, team_id: teamId } = playerInfo;

    // Get team info to determine if they play in a dome
    const { data: teamInfo, error: teamError } = await supabase
      .from("teams")
      .select("full_name, abbreviation, location")
      .eq("id", teamId)
      .maybeSingle();

    if (teamError) {
      return { error: teamError.message };
    }

    const teamName = teamInfo?.full_name || "Unknown Team";
    const teamAbbr = teamInfo?.abbreviation || "UNK";

    // Dome/Indoor stadiums (teams that primarily play indoors)
    const domeTeams = [
      "Atlanta Falcons", "New Orleans Saints", "Detroit Lions", 
      "Minnesota Vikings", "Indianapolis Colts", "Houston Texans",
      "Arizona Cardinals", "Las Vegas Raiders", "Los Angeles Rams",
      "Los Angeles Chargers" // SoFi Stadium has a roof
    ];

    const playsPrimarilyIndoors = domeTeams.includes(teamName);

    // Weather-sensitive positions and stats
    const weatherSensitivePositions = ["QB", "Quarterback", "K", "Kicker", "P", "Punter"];
    const weatherSensitiveStats = [
      "passing_yards", "passing_touchdowns", "passing_completions", "qb_rating",
      "field_goals_made", "field_goal_attempts", "extra_points_made",
      "receiving_yards", "receiving_touchdowns", "receptions"
    ];

    const isWeatherSensitivePosition = weatherSensitivePositions.includes(posAbbr) || 
                                     weatherSensitivePositions.includes(position);
    const isWeatherSensitiveStat = weatherSensitiveStats.includes(normalizedStatType);

    // Get player's recent performance for context
    const { data: recentStats, error: recentError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        games!inner(date, week, season, venue)
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .not(normalizedStatType, "is", null)
      .order("games.date", { ascending: false })
      .limit(8);

    if (recentError) {
      return { error: recentError.message };
    }

    // Analyze indoor vs outdoor performance (based on venue names)
    const indoorVenues = [
      "Mercedes-Benz Superdome", "Caesars Superdome", "Ford Field", 
      "U.S. Bank Stadium", "Lucas Oil Stadium", "NRG Stadium",
      "State Farm Stadium", "Allegiant Stadium", "SoFi Stadium",
      "Mercedes-Benz Stadium"
    ];

    const indoorStats = [];
    const outdoorStats = [];

    (recentStats || []).forEach(game => {
      const venue = game.games?.venue || "";
      const statValue = game[normalizedStatType];
      
      if (statValue !== null && statValue !== undefined) {
        const isIndoor = indoorVenues.some(indoor => venue.includes(indoor.split(" ")[0])) ||
                        venue.toLowerCase().includes("dome") ||
                        venue.toLowerCase().includes("stadium") && 
                        (venue.toLowerCase().includes("covered") || venue.toLowerCase().includes("indoor"));
        
        (isIndoor ? indoorStats : outdoorStats).push(statValue);
      }
    });

    const indoorAvg = indoorStats.length > 0 
      ? +(indoorStats.reduce((a, b) => a + b, 0) / indoorStats.length).toFixed(1)
      : null;
    
    const outdoorAvg = outdoorStats.length > 0 
      ? +(outdoorStats.reduce((a, b) => a + b, 0) / outdoorStats.length).toFixed(1)
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Generate weather impact context
    let context;

    if (isWeatherSensitivePosition && isWeatherSensitiveStat) {
      if (posAbbr === "K" || position === "Kicker") {
        context = `**${lastName}** (K) is **highly weather-sensitive**. Wind, rain, and cold significantly impact kicking accuracy and distance. `;
        if (playsPrimarilyIndoors) {
          context += `**${teamAbbr}** plays in a dome, providing **consistent conditions** for home games.`;
        } else {
          context += `**${teamAbbr}** plays outdoors - monitor weather conditions for **wind speed** and **precipitation**.`;
        }
      } else if (posAbbr === "QB" || position === "Quarterback") {
        context = `**${lastName}** (QB) passing performance can be impacted by **wind**, **rain**, and **cold temperatures**. `;
        if (playsPrimarilyIndoors) {
          context += `**${teamAbbr}** plays in a dome, providing **stable passing conditions** at home.`;
        } else {
          context += `**${teamAbbr}** plays outdoors - **adverse weather** may favor running game over passing.`;
        }
      } else {
        context = `**${lastName}** (${posAbbr}) performance in **${statType.toUpperCase()}** can be affected by weather conditions. `;
        if (playsPrimarilyIndoors) {
          context += `**${teamAbbr}** dome provides **consistent conditions**.`;
        } else {
          context += `Monitor weather for **${teamAbbr}** outdoor games.`;
        }
      }
    } else if (isWeatherSensitiveStat) {
      context = `**${lastName}** ${statType.toUpperCase()} may be impacted by **weather conditions** in outdoor games. `;
      if (playsPrimarilyIndoors) {
        context += `**${teamAbbr}** dome provides **weather protection** for home games.`;
      } else {
        context += `**${teamAbbr}** outdoor stadium - weather could affect passing game and ${statType.toUpperCase()}.`;
      }
    } else {
      context = `**${lastName}** (${posAbbr}) ${statType.toUpperCase()} generally **less weather-dependent**. `;
      if (playsPrimarilyIndoors) {
        context += `**${teamAbbr}** plays in controlled dome environment.`;
      } else {
        context += `**${teamAbbr}** outdoor games may still see minor weather effects.`;
      }
    }

    // Add performance split if available
    if (indoorAvg !== null && outdoorAvg !== null) {
      const difference = Math.abs(indoorAvg - outdoorAvg);
      if (difference >= 1) {
        const better = indoorAvg > outdoorAvg ? "indoor" : "outdoor";
        context += ` **Indoor:** ${indoorAvg} vs **Outdoor:** ${outdoorAvg} ${statType.toUpperCase()} (${better} advantage).`;
      }
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      playerPosition: position,
      playerPosAbbr: posAbbr,
      teamPlaysIndoors: playsPrimarilyIndoors,
      isWeatherSensitive: isWeatherSensitivePosition && isWeatherSensitiveStat,
      indoorAverage: indoorAvg,
      outdoorAverage: outdoorAvg,
      indoorGames: indoorStats.length,
      outdoorGames: outdoorStats.length,
    };
  } catch (err) {
    return { error: err.message };
  }
} 