// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLPlayerInjuryImpact({
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

    // Check if injuries table exists and get injury data
    const { data: injuries, error: injuryError } = await supabase
      .from("injuries")
      .select("player_id, injury_status, week, season")
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .order("week", { ascending: false });

    // If no injury data or error, provide general context
    if (injuryError || !injuries || injuries.length === 0) {
      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `No current injury concerns reported for **${lastName}**. Monitor injury reports leading up to game time.`,
        hasInjuryData: false,
        injuryStatus: "healthy",
        injuryRisk: "low",
        recommendation: "No injury-related concerns for this prop bet.",
      };
    }

    // Get recent games to analyze performance patterns
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week")
      .eq("season", currentSeason)
      .order("date", { ascending: false })
      .limit(20);

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    // Get player stats for recent games
    const gameIds = games?.map(g => g.id) || [];
    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", gameIds);

    if (statsError) {
      return { error: `Player stats query error: ${statsError.message}` };
    }

    // Merge stats with game info
    const statsWithGames = (playerStats || [])
      .map(stat => {
        const game = games.find(g => g.id === stat.game_id);
        return { ...stat, game };
      })
      .filter(stat => stat.game)
      .sort((a, b) => new Date(b.game.date) - new Date(a.game.date));

    // Analyze injury impact
    const currentInjury = injuries[0]; // Most recent injury status
    const injuryWeeks = injuries.map(inj => inj.week);
    
    // Categorize games as pre-injury, during injury, post-injury
    const preInjuryGames = [];
    const duringInjuryGames = [];
    const postInjuryGames = [];

    for (const statGame of statsWithGames) {
      const gameWeek = statGame.game.week;
      const statValue = statGame[normalizedStatType];
      
      if (statValue !== null && statValue !== undefined) {
        if (injuryWeeks.includes(gameWeek)) {
          duringInjuryGames.push(statValue);
        } else if (gameWeek < Math.min(...injuryWeeks)) {
          preInjuryGames.push(statValue);
        } else {
          postInjuryGames.push(statValue);
        }
      }
    }

    // Calculate averages
    const preInjuryAvg = preInjuryGames.length > 0 
      ? +(preInjuryGames.reduce((a, b) => a + b, 0) / preInjuryGames.length).toFixed(1)
      : null;

    const duringInjuryAvg = duringInjuryGames.length > 0 
      ? +(duringInjuryGames.reduce((a, b) => a + b, 0) / duringInjuryGames.length).toFixed(1)
      : null;

    const postInjuryAvg = postInjuryGames.length > 0 
      ? +(postInjuryGames.reduce((a, b) => a + b, 0) / postInjuryGames.length).toFixed(1)
      : null;

    // Determine injury risk and impact
    let injuryRisk = "low";
    let impactDescription = "";
    let recommendation = "";

    const injuryStatus = currentInjury.injury_status?.toLowerCase() || "unknown";

    if (injuryStatus.includes("out") || injuryStatus.includes("ir")) {
      injuryRisk = "high";
      impactDescription = "player is currently out";
      recommendation = "Avoid this prop bet - player unlikely to play.";
    } else if (injuryStatus.includes("doubtful")) {
      injuryRisk = "high";
      impactDescription = "player is doubtful to play";
      recommendation = "High risk prop bet - monitor injury reports closely.";
    } else if (injuryStatus.includes("questionable")) {
      injuryRisk = "medium";
      impactDescription = "player is questionable";
      recommendation = "Medium risk - check final injury report before betting.";
    } else if (injuryStatus.includes("probable") || injuryStatus.includes("limited")) {
      injuryRisk = "low";
      impactDescription = "player has minor injury concerns";
      recommendation = "Low risk - player expected to play but monitor snap count.";
    } else {
      injuryRisk = "low";
      impactDescription = "no significant injury concerns";
      recommendation = "No injury-related concerns for this prop bet.";
    }

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Build context based on available data
    let context = `**${lastName}** injury status: ${impactDescription}.`;
    
    if (duringInjuryAvg !== null && preInjuryAvg !== null) {
      const impact = duringInjuryAvg - preInjuryAvg;
      const impactPercent = preInjuryAvg > 0 ? ((impact / preInjuryAvg) * 100).toFixed(1) : 0;
      context += ` Performance during injury: **${duringInjuryAvg}** vs **${preInjuryAvg}** pre-injury (${impact > 0 ? '+' : ''}${impactPercent}% change).`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      hasInjuryData: true,
      injuryStatus,
      injuryRisk,
      recommendation,
      preInjuryAverage: preInjuryAvg,
      duringInjuryAverage: duringInjuryAvg,
      postInjuryAverage: postInjuryAvg,
      preInjuryGames: preInjuryGames.length,
      duringInjuryGames: duringInjuryGames.length,
      postInjuryGames: postInjuryGames.length,
    };
  } catch (err) {
    return { error: `Player injury impact error: ${err.message}` };
  }
} 