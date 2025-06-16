import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLPlayerInjuryImpact({
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

    // Get player's team and position info
    const { data: playerInfo, error: playerError } = await supabase
      .from("players")
      .select("team_id, position, position_abbreviation")
      .eq("id", playerId)
      .maybeSingle();

    if (playerError) {
      return { error: playerError.message };
    }

    if (!playerInfo) {
      return { error: "Player not found" };
    }

    const { team_id: teamId, position, position_abbreviation: posAbbr } = playerInfo;

    // Get player's recent performance
    const { data: recentStats, error: recentError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType},
        games!inner(date, week, season)
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .not(normalizedStatType, "is", null)
      .order("games.date", { ascending: false })
      .limit(5);

    if (recentError) {
      return { error: recentError.message };
    }

    // Get teammates at key positions that could impact this player
    const keyPositionImpacts = {
      // QB impacts everyone
      "QB": ["WR", "TE", "RB", "K"],
      "Quarterback": ["WR", "TE", "RB", "K"],
      
      // RB impacts can affect passing game
      "RB": ["QB", "WR", "TE"],
      "Running Back": ["QB", "WR", "TE"],
      
      // WR/TE impacts
      "WR": ["QB", "RB"],
      "Wide Receiver": ["QB", "RB"],
      "TE": ["QB", "RB", "WR"],
      "Tight End": ["QB", "RB", "WR"],
      
      // Offensive line impacts skill positions
      "OL": ["QB", "RB", "WR", "TE"],
      "OT": ["QB", "RB", "WR", "TE"],
      "OG": ["QB", "RB", "WR", "TE"],
      "C": ["QB", "RB", "WR", "TE"],
      
      // Defense impacts
      "LB": ["QB", "RB", "WR", "TE"],
      "CB": ["WR", "TE"],
      "S": ["WR", "TE", "RB"],
      "DE": ["QB", "RB"],
      "DT": ["QB", "RB"],
    };

    // Determine which positions could impact this player
    const impactingPositions = [];
    for (const [pos, impacted] of Object.entries(keyPositionImpacts)) {
      if (impacted.includes(posAbbr) || impacted.includes(position)) {
        impactingPositions.push(pos);
      }
    }

    // Get teammates at impacting positions
    const { data: teammates, error: teammatesError } = await supabase
      .from("players")
      .select("id, first_name, last_name, position, position_abbreviation")
      .eq("team_id", teamId)
      .in("position_abbreviation", impactingPositions)
      .neq("id", playerId);

    if (teammatesError) {
      return { error: teammatesError.message };
    }

    // Analyze recent team performance trends
    const recentValues = (recentStats || [])
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null);

    const recentAvg = recentValues.length > 0 
      ? +(recentValues.reduce((a, b) => a + b, 0) / recentValues.length).toFixed(1)
      : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    // Generate context based on position and potential impacts
    let context;
    
    if (posAbbr === "QB" || position === "Quarterback") {
      context = `**${lastName}** (QB) performance can be significantly impacted by **offensive line health**, **key receiver availability**, and **running game support**. Monitor injury reports for OL, WR, TE, and RB positions.`;
    } else if (["WR", "TE"].includes(posAbbr) || ["Wide Receiver", "Tight End"].includes(position)) {
      context = `**${lastName}** (${posAbbr}) relies heavily on **quarterback play** and **offensive line protection**. QB injuries or OL issues could significantly impact receiving opportunities and ${statType.toUpperCase()}.`;
    } else if (posAbbr === "RB" || position === "Running Back") {
      context = `**${lastName}** (RB) performance depends on **offensive line health** and **game script**. OL injuries or negative game flow could limit rushing opportunities and ${statType.toUpperCase()}.`;
    } else if (posAbbr === "K" || position === "Kicker") {
      context = `**${lastName}** (K) opportunities depend on **offensive efficiency** and **red zone struggles**. Key offensive player injuries could impact scoring chances and ${statType.toUpperCase()}.`;
    } else if (["LB", "CB", "S", "DE", "DT"].includes(posAbbr)) {
      context = `**${lastName}** (${posAbbr}) defensive stats can be impacted by **opposing team injuries** and **game script**. Monitor opponent's key offensive player availability.`;
    } else {
      context = `**${lastName}** performance may be impacted by **key teammate availability** and **overall team health**. Monitor injury reports for potential opportunity changes.`;
    }

    // Add recent performance context
    if (recentAvg !== null) {
      context += ` Recent average: **${recentAvg} ${statType.toUpperCase()}** over last ${recentValues.length} games.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      playerPosition: position,
      playerPosAbbr: posAbbr,
      recentAverage: recentAvg,
      recentGames: recentValues.length,
      keyTeammates: teammates?.length || 0,
      impactingPositions,
    };
  } catch (err) {
    return { error: err.message };
  }
} 