import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLSeasonVsLast3({
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

    // Get all player stats for current season
    const { data: allStats, error: allStatsError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        game_id,
        games!inner(date, week, season)
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .not(normalizedStatType, "is", null)
      .order("games.date", { ascending: false });

    if (allStatsError) {
      return { error: allStatsError.message };
    }

    if (!allStats || allStats.length === 0) {
      return { error: "No season data found for this player" };
    }

    // Get last 3 games
    const last3Games = allStats.slice(0, 3);
    
    if (last3Games.length < 3) {
      return { error: "Not enough recent games (need at least 3)" };
    }

    // Calculate averages
    const seasonValues = allStats.map(game => game[normalizedStatType]).filter(val => val !== null);
    const last3Values = last3Games.map(game => game[normalizedStatType]).filter(val => val !== null);

    const seasonAvg = seasonValues.length > 0 
      ? +(seasonValues.reduce((a, b) => a + b, 0) / seasonValues.length).toFixed(1) 
      : null;
    
    const last3Avg = last3Values.length > 0 
      ? +(last3Values.reduce((a, b) => a + b, 0) / last3Values.length).toFixed(1) 
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    let context;
    if (seasonAvg !== null && last3Avg !== null) {
      const trend = last3Avg > seasonAvg ? "above" : last3Avg < seasonAvg ? "below" : "matching";
      const difference = Math.abs(last3Avg - seasonAvg);
      
      context = `**${lastName}** is averaging **${last3Avg} ${statType.toUpperCase()}** in his last 3 games, which is **${trend}** his season average of **${seasonAvg}** (difference: ${difference.toFixed(1)}).`;
    } else {
      context = `Insufficient data to compare **${lastName}'s** recent performance to season average.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      seasonAverage: seasonAvg,
      last3Average: last3Avg,
      seasonGames: seasonValues.length,
      last3Games: last3Values.length,
      seasonValues,
      last3Values,
    };
  } catch (err) {
    return { error: err.message };
  }
} 