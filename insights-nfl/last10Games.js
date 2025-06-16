import { getMostRecentSeason } from "../../utils/getMostRecentSeason.js";

export async function getNFLLast10GameHitRate({
  playerId,
  playerName,
  statType,
  line,
  direction,
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
      
      // Combined stats
      "pass_yds+rush_yds": "passing_yards+rushing_yards",
      "rec_yds+rush_yds": "receiving_yards+rushing_yards",
      "pass_tds+rush_tds": "passing_touchdowns+rushing_touchdowns",
    };

    const normalizedStatType = statTypeAliasMap[statType] || statType;
    const parsedLine = Number(line);
    const hasLine = !Number.isNaN(parsedLine);

    // Get player stats for current season
    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`
        ${normalizedStatType.includes('+') ? normalizedStatType.split('+').join(', ') : normalizedStatType},
        game_id,
        games!inner(date, week, season)
      `)
      .eq("player_id", playerId)
      .eq("games.season", currentSeason)
      .order("games.date", { ascending: false })
      .limit(10);

    if (statsError) {
      return { error: statsError.message };
    }

    if (!playerStats || playerStats.length === 0) {
      return { error: "No recent games found for this player" };
    }

    // Calculate stat values and hit rate
    const statValues = [];
    const hitCount = hasLine ? 0 : null;
    let actualHitCount = 0;

    for (const game of playerStats) {
      let statValue;
      
      if (normalizedStatType.includes('+')) {
        // Handle combined stats
        const [stat1, stat2] = normalizedStatType.split('+');
        const val1 = game[stat1] || 0;
        const val2 = game[stat2] || 0;
        statValue = val1 + val2;
      } else {
        statValue = game[normalizedStatType];
      }

      if (statValue !== null && statValue !== undefined) {
        statValues.push(statValue);
        if (hasLine && statValue >= parsedLine) {
          actualHitCount++;
        }
      }
    }

    const gameCount = statValues.length;
    const average = gameCount > 0 ? +(statValues.reduce((a, b) => a + b, 0) / gameCount).toFixed(1) : null;
    const finalHitCount = hasLine ? actualHitCount : null;

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    let context;
    if (gameCount > 0) {
      const lineInfo = hasLine
        ? `, hitting the line (**${parsedLine}**) in **${finalHitCount} of ${gameCount} games**`
        : "";
      context = `In **${lastName}'s** last **${gameCount} games**${lineInfo}, averaging **${average} ${statType.toUpperCase()}**.`;
    } else {
      context = `No recent game data available for **${lastName}**.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      average,
      hitCount: finalHitCount,
      gameCount,
      statList: statValues,
    };
  } catch (err) {
    return { error: err.message };
  }
} 