// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLLast10GameHitRate({
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
      
      // Combined stats
      "pass_yds+rush_yds": "passing_yards+rushing_yards",
      "rec_yds+rush_yds": "receiving_yards+rushing_yards",
      "pass_tds+rush_tds": "passing_touchdowns+rushing_touchdowns",
    };

    const normalizedStatType = statTypeAliasMap[statType] || statType;
    const parsedLine = Number(line);
    const hasLine = !Number.isNaN(parsedLine);

    // Get games for the player in current season, ordered by date
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week")
      .eq("season", currentSeason)
      .order("date", { ascending: false })
      .limit(50); // Get more games to ensure we have enough with player stats

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    if (!games || games.length === 0) {
      return { error: "No games found for current season" };
    }

    // Get player stats for these games
    const gameIds = games.map(g => g.id);
    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", gameIds)
      .limit(10);

    if (statsError) {
      return { error: `Player stats query error: ${statsError.message}` };
    }

    if (!playerStats || playerStats.length === 0) {
      return { error: "No recent games found for this player" };
    }

    // Merge stats with game info and sort by date
    const statsWithGames = playerStats
      .map(stat => {
        const game = games.find(g => g.id === stat.game_id);
        return { ...stat, game };
      })
      .filter(stat => stat.game)
      .sort((a, b) => new Date(b.game.date) - new Date(a.game.date))
      .slice(0, 10);

    // Calculate stat values and hit rate
    const statValues = [];
    let actualHitCount = 0;

    for (const statGame of statsWithGames) {
      const statValue = statGame[normalizedStatType];
      
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
    return { error: `Last 10 games error: ${err.message}` };
  }
} 