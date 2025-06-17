// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLRedZonePerformance({
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

    // Check if red zone stats table exists
    const { data: redZoneStats, error: redZoneError } = await supabase
      .from("red_zone_stats")
      .select(`${normalizedStatType}, player_id, season`)
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .single();

    // If no red zone data, provide general context based on position and stat type
    if (redZoneError || !redZoneStats) {
      // Get player position for context
      const { data: playerInfo, error: playerError } = await supabase
        .from("players")
        .select("position")
        .eq("id", playerId)
        .single();

      const position = playerInfo?.position || "Unknown";

      // Clean last name extraction
      if (!playerName) return { error: "Missing playerName" };
      const lastName = playerName.split(" ").pop();

      // Provide position-specific red zone context
      let contextByPosition = "";
      let redZoneRelevance = "medium";

      if (position.includes("QB") || position.includes("Quarterback")) {
        if (normalizedStatType.includes("touchdowns")) {
          contextByPosition = "Red zone is crucial for QB touchdown opportunities";
          redZoneRelevance = "high";
        } else if (normalizedStatType.includes("yards")) {
          contextByPosition = "Red zone limits QB passing yardage opportunities";
          redZoneRelevance = "low";
        } else {
          contextByPosition = "Red zone affects QB decision-making and play-calling";
          redZoneRelevance = "medium";
        }
      } else if (position.includes("RB") || position.includes("Running")) {
        if (normalizedStatType.includes("touchdowns")) {
          contextByPosition = "RBs often get increased red zone carries for TDs";
          redZoneRelevance = "high";
        } else if (normalizedStatType.includes("yards")) {
          contextByPosition = "Red zone limits RB yardage potential per carry";
          redZoneRelevance = "low";
        } else {
          contextByPosition = "Red zone typically increases RB usage";
          redZoneRelevance = "high";
        }
      } else if (position.includes("WR") || position.includes("TE") || position.includes("Receiver") || position.includes("End")) {
        if (normalizedStatType.includes("touchdowns")) {
          contextByPosition = "Red zone is prime scoring territory for receivers";
          redZoneRelevance = "high";
        } else if (normalizedStatType.includes("yards")) {
          contextByPosition = "Red zone limits receiver yardage opportunities";
          redZoneRelevance = "low";
        } else if (normalizedStatType.includes("receptions")) {
          contextByPosition = "Red zone targets often focus on reliable hands";
          redZoneRelevance = "medium";
        } else {
          contextByPosition = "Red zone affects receiver target distribution";
          redZoneRelevance = "medium";
        }
      } else if (position.includes("K") || position.includes("Kicker")) {
        if (normalizedStatType.includes("field_goal")) {
          contextByPosition = "Red zone reduces FG opportunities (more TDs)";
          redZoneRelevance = "high";
        } else if (normalizedStatType.includes("extra_point")) {
          contextByPosition = "Red zone success increases XP opportunities";
          redZoneRelevance = "high";
        } else {
          contextByPosition = "Red zone efficiency affects kicker opportunities";
          redZoneRelevance = "medium";
        }
      } else {
        contextByPosition = "Red zone performance affects overall team efficiency";
        redZoneRelevance = "medium";
      }

      return {
        statType,
        normalizedStatType,
        season: currentSeason,
        context: `Red zone data not available for **${lastName}**. ${contextByPosition}. Monitor team's red zone efficiency for context.`,
        hasRedZoneData: false,
        redZoneRelevance,
        recommendation: "Consider team's overall red zone performance when evaluating this prop.",
      };
    }

    // Get team red zone stats for context
    const { data: playerTeamInfo, error: teamInfoError } = await supabase
      .from("players")
      .select("team_id")
      .eq("id", playerId)
      .single();

    let teamRedZoneContext = "";
    if (!teamInfoError && playerTeamInfo?.team_id) {
      const { data: teamRedZoneStats, error: teamRedZoneError } = await supabase
        .from("team_stats")
        .select("red_zone_attempts, red_zone_touchdowns, red_zone_efficiency")
        .eq("team_id", playerTeamInfo.team_id)
        .eq("season", currentSeason)
        .single();

      if (!teamRedZoneError && teamRedZoneStats) {
        const efficiency = teamRedZoneStats.red_zone_efficiency || 
          (teamRedZoneStats.red_zone_touchdowns / teamRedZoneStats.red_zone_attempts * 100);
        teamRedZoneContext = ` Team red zone efficiency: **${efficiency.toFixed(1)}%**.`;
      }
    }

    // Analyze the red zone stat
    const redZoneValue = redZoneStats[normalizedStatType];
    
    // Get regular stats for comparison
    const { data: regularStats, error: regularError } = await supabase
      .from("season_stats")
      .select(normalizedStatType)
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .eq("postseason", false)
      .single();

    const regularValue = regularStats?.[normalizedStatType] || 0;

    // Calculate red zone impact
    let redZoneImpact = "neutral";
    let impactDescription = "";
    let recommendation = "";

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    if (redZoneValue !== null && redZoneValue !== undefined) {
      if (normalizedStatType.includes("touchdowns")) {
        // For TDs, higher red zone stats are better
        if (redZoneValue >= 5) {
          redZoneImpact = "high";
          impactDescription = "strong red zone touchdown producer";
          recommendation = "Excellent red zone opportunity - high TD potential.";
        } else if (redZoneValue >= 2) {
          redZoneImpact = "medium";
          impactDescription = "decent red zone touchdown threat";
          recommendation = "Moderate red zone opportunity for TDs.";
        } else {
          redZoneImpact = "low";
          impactDescription = "limited red zone touchdown production";
          recommendation = "Lower red zone TD probability.";
        }
      } else if (normalizedStatType.includes("yards")) {
        // For yards, red zone typically means fewer opportunities
        if (regularValue > 0) {
          const redZonePercentage = (redZoneValue / regularValue) * 100;
          if (redZonePercentage > 15) {
            redZoneImpact = "high";
            impactDescription = "gets significant red zone yardage";
            recommendation = "Good red zone yardage opportunity.";
          } else if (redZonePercentage > 8) {
            redZoneImpact = "medium";
            impactDescription = "moderate red zone yardage contributor";
            recommendation = "Some red zone yardage potential.";
          } else {
            redZoneImpact = "low";
            impactDescription = "limited red zone yardage role";
            recommendation = "Red zone may limit yardage opportunities.";
          }
        }
      } else if (normalizedStatType.includes("receptions") || normalizedStatType.includes("attempts")) {
        // For volume stats, analyze red zone usage
        if (redZoneValue >= 10) {
          redZoneImpact = "high";
          impactDescription = "heavily utilized in red zone";
          recommendation = "High red zone usage - good opportunity.";
        } else if (redZoneValue >= 5) {
          redZoneImpact = "medium";
          impactDescription = "moderate red zone usage";
          recommendation = "Decent red zone involvement.";
        } else {
          redZoneImpact = "low";
          impactDescription = "limited red zone involvement";
          recommendation = "Lower red zone usage.";
        }
      } else {
        // General analysis
        impactDescription = "has red zone involvement";
        recommendation = "Monitor red zone opportunities.";
      }
    } else {
      impactDescription = "minimal red zone data";
      recommendation = "Red zone impact unclear.";
    }

    // Build context
    let context = `**${lastName}** ${impactDescription}`;
    
    if (redZoneValue !== null && redZoneValue !== undefined) {
      context += ` with **${redZoneValue}** red zone ${statType.toUpperCase()} this season.`;
    }

    if (regularValue > 0 && redZoneValue !== null) {
      const percentage = ((redZoneValue / regularValue) * 100).toFixed(1);
      context += ` (**${percentage}%** of total ${statType.toUpperCase()}).`;
    }

    context += teamRedZoneContext;

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      hasRedZoneData: true,
      redZoneValue,
      regularValue,
      redZoneImpact,
      recommendation,
      redZonePercentage: regularValue > 0 ? +((redZoneValue / regularValue) * 100).toFixed(1) : null,
    };
  } catch (err) {
    return { error: `Red zone performance error: ${err.message}` };
  }
} 