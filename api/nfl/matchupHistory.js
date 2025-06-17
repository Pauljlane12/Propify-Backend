// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLMatchupHistory({
  playerId,
  playerName,
  opponentTeamId,
  statType,
  bettingLine,
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
    const parsedLine = Number(bettingLine);
    const hasLine = !Number.isNaN(parsedLine);

    if (!opponentTeamId) {
      return { error: "Missing opponent team ID" };
    }

    // Get games against this opponent in recent seasons (last 3 years)
    const recentSeasons = [currentSeason, currentSeason - 1, currentSeason - 2];
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, date, week, season, home_team_id, visitor_team_id")
      .in("season", recentSeasons)
      .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`)
      .order("date", { ascending: false });

    if (gamesError) {
      return { error: `Games query error: ${gamesError.message}` };
    }

    if (!games || games.length === 0) {
      return { error: "No games found against this opponent" };
    }

    // Get player stats for these games
    const gameIds = games.map(g => g.id);
    const { data: playerStats, error: statsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", gameIds);

    if (statsError) {
      return { error: `Player stats query error: ${statsError.message}` };
    }

    if (!playerStats || playerStats.length === 0) {
      return { error: "No historical matchup data found" };
    }

    // Merge stats with game info and sort by date
    const statsWithGames = playerStats
      .map(stat => {
        const game = games.find(g => g.id === stat.game_id);
        return { ...stat, game };
      })
      .filter(stat => stat.game)
      .sort((a, b) => new Date(b.game.date) - new Date(a.game.date));

    // Calculate stats
    const statValues = [];
    let hitCount = 0;

    for (const statGame of statsWithGames) {
      const statValue = statGame[normalizedStatType];
      
      if (statValue !== null && statValue !== undefined) {
        statValues.push(statValue);
        if (hasLine && statValue >= parsedLine) {
          hitCount++;
        }
      }
    }

    const gameCount = statValues.length;
    const average = gameCount > 0 ? +(statValues.reduce((a, b) => a + b, 0) / gameCount).toFixed(1) : null;

    // Get opponent team name
    const { data: opponentTeam, error: teamError } = await supabase
      .from("teams")
      .select("name, abbreviation")
      .eq("id", opponentTeamId)
      .single();

    const opponentName = opponentTeam?.abbreviation || "opponent";

    // Clean last name extraction
    if (!playerName) return { error: "Missing playerName" };
    const lastName = playerName.split(" ").pop();

    let context;
    if (gameCount > 0) {
      const lineInfo = hasLine
        ? ` and hit the line (**${parsedLine}**) in **${hitCount} of ${gameCount} games**`
        : "";
      context = `**${lastName}** has averaged **${average} ${statType.toUpperCase()}** in **${gameCount} career games** vs **${opponentName}**${lineInfo}.`;
    } else {
      context = `No historical matchup data available for **${lastName}** vs **${opponentName}**.`;
    }

    return {
      statType,
      normalizedStatType,
      context,
      average,
      hitCount: hasLine ? hitCount : null,
      gameCount,
      opponentTeamId,
      opponentName,
      statList: statValues,
      seasonsAnalyzed: recentSeasons,
    };
  } catch (err) {
    return { error: `Matchup history error: ${err.message}` };
  }
} 