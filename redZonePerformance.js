import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLRedZonePerformance({
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

    // Get team info
    const { data: teamInfo, error: teamError } = await supabase
      .from("teams")
      .select("full_name, abbreviation")
      .eq("id", teamId)
      .maybeSingle();

    if (teamError) {
      return { error: teamError.message };
    }

    const teamName = teamInfo?.full_name || "Unknown Team";
    const teamAbbr = teamInfo?.abbreviation || "UNK";

    // Red zone relevant stats and positions
    const redZoneRelevantStats = [
      "passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns",
      "receptions", "receiving_targets", "rushing_attempts", "field_goals_made"
    ];

    const redZoneRelevantPositions = ["QB", "RB", "WR", "TE", "K"];

    const isRedZoneRelevant = redZoneRelevantStats.includes(normalizedStatType) ||
                             redZoneRelevantPositions.includes(posAbbr);

    // Get player's touchdown and scoring stats for context
    const { data: scoringStats, error: scoringError } = await supabase
      .from("player_stats")
      .select(`
        passing_touchdowns,
        rushing_touchdowns,
        receiving_touchdowns,
        receptions,
        receiving_targets,
        rushing_attempts,
        field_goals_made,
        games!inner(date, week, season)
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .order("games.date", { ascending: false })
      .limit(10);

    if (scoringError) {
      return { error: scoringError.message };
    }

    // Get team's red zone efficiency
    const { data: teamGames, error: teamGamesError } = await supabase
      .from("games")
      .select("id, home_team_score, visitor_team_score, home_team_id, visitor_team_id")
      .eq("season", currentSeason)
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`);

    if (teamGamesError) {
      return { error: teamGamesError.message };
    }

    // Calculate team scoring trends
    const teamScores = [];
    (teamGames || []).forEach(game => {
      const isHome = game.home_team_id === teamId;
      const teamScore = isHome ? game.home_team_score : game.visitor_team_score;
      if (teamScore !== null) {
        teamScores.push(teamScore);
      }
    });

    const avgTeamScore = teamScores.length > 0 
      ? +(teamScores.reduce((a, b) => a + b, 0) / teamScores.length).toFixed(1)
      : null;

    // Analyze player's scoring contributions
    let totalTouchdowns = 0;
    let recentTouchdowns = 0;
    let totalTargetsReceptions = 0;
    let totalFieldGoals = 0;

    (scoringStats || []).forEach((game, index) => {
      const passTds = game.passing_touchdowns || 0;
      const rushTds = game.rushing_touchdowns || 0;
      const recTds = game.receiving_touchdowns || 0;
      const gameTds = passTds + rushTds + recTds;
      
      totalTouchdowns += gameTds;
      if (index < 3) recentTouchdowns += gameTds; // Last 3 games
      
      totalTargetsReceptions += (game.receptions || 0);
      totalFieldGoals += (game.field_goals_made || 0);
    });

    const avgTouchdownsPerGame = scoringStats?.length > 0 
      ? +(totalTouchdowns / scoringStats.length).toFixed(2)
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Generate red zone context based on position and stat type
    let context;

    if (!isRedZoneRelevant) {
      context = `**${lastName}** (${posAbbr}) ${statType.toUpperCase()} is **not directly red zone dependent**. Performance less affected by goal-line situations.`;
    } else {
      if (posAbbr === "QB" || position === "Quarterback") {
        if (normalizedStatType === "passing_touchdowns") {
          context = `**${lastName}** (QB) **red zone efficiency** is crucial for passing TDs. `;
          if (avgTouchdownsPerGame !== null) {
            context += `Averaging **${avgTouchdownsPerGame} total TDs** per game this season. `;
          }
          context += `**${teamAbbr}** red zone play-calling and goal-line packages directly impact TD opportunities.`;
        } else {
          context = `**${lastName}** (QB) red zone performance affects **${teamAbbr}** scoring efficiency. Monitor goal-line tendencies and red zone play-calling.`;
        }
      } else if (posAbbr === "RB" || position === "Running Back") {
        if (normalizedStatType === "rushing_touchdowns") {
          context = `**${lastName}** (RB) **goal-line carries** are key for rushing TDs. `;
          if (avgTouchdownsPerGame !== null) {
            context += `Averaging **${avgTouchdownsPerGame} total TDs** per game. `;
          }
          context += `**${teamAbbr}** red zone usage and goal-line packages determine TD opportunities.`;
        } else {
          context = `**${lastName}** (RB) red zone role impacts overall touches and scoring chances. Monitor **${teamAbbr}** goal-line personnel usage.`;
        }
      } else if (["WR", "TE"].includes(posAbbr)) {
        if (normalizedStatType === "receiving_touchdowns") {
          context = `**${lastName}** (${posAbbr}) **red zone targets** are crucial for receiving TDs. `;
          if (avgTouchdownsPerGame !== null) {
            context += `Averaging **${avgTouchdownsPerGame} total TDs** per game. `;
          }
          context += `**${teamAbbr}** red zone passing tendencies and target distribution affect TD chances.`;
        } else if (normalizedStatType === "receptions" || normalizedStatType === "receiving_targets") {
          context = `**${lastName}** (${posAbbr}) red zone involvement affects target share. **${teamAbbr}** red zone passing frequency impacts ${statType.toUpperCase()} opportunities.`;
        } else {
          context = `**${lastName}** (${posAbbr}) performance can benefit from **${teamAbbr}** red zone efficiency and scoring drives.`;
        }
      } else if (posAbbr === "K" || position === "Kicker") {
        if (normalizedStatType === "field_goals_made") {
          context = `**${lastName}** (K) field goal opportunities depend on **${teamAbbr}** red zone struggles. `;
          if (totalFieldGoals > 0) {
            context += `**${totalFieldGoals} FGs** in recent games. `;
          }
          context += `Teams that stall in red zone create more FG attempts.`;
        } else {
          context = `**${lastName}** (K) scoring opportunities tied to **${teamAbbr}** offensive efficiency and red zone performance.`;
        }
      } else {
        context = `**${lastName}** (${posAbbr}) ${statType.toUpperCase()} may be influenced by **${teamAbbr}** red zone efficiency and scoring opportunities.`;
      }
    }

    // Add team scoring context
    if (avgTeamScore !== null) {
      context += ` **${teamAbbr}** averaging **${avgTeamScore} points** per game this season.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      playerPosition: position,
      playerPosAbbr: posAbbr,
      isRedZoneRelevant,
      avgTouchdownsPerGame,
      recentTouchdowns,
      totalTouchdowns,
      avgTeamScore,
      gamesAnalyzed: scoringStats?.length || 0,
    };
  } catch (err) {
    return { error: err.message };
  }
} 