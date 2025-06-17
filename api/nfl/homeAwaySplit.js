// Simple utility to get current season
const getCurrentSeason = () => 2024; // Current NFL season

export async function getNFLHomeAwaySplit({
  playerId,
  teamId,
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

    if (!teamId) {
      return { error: "Missing team ID" };
    }

    // Get home games for the team
    const { data: homeGames, error: homeGamesError } = await supabase
      .from("games")
      .select("id, date, week")
      .eq("season", currentSeason)
      .eq("home_team_id", teamId)
      .order("date", { ascending: false });

    if (homeGamesError) {
      return { error: `Home games query error: ${homeGamesError.message}` };
    }

    // Get away games for the team
    const { data: awayGames, error: awayGamesError } = await supabase
      .from("games")
      .select("id, date, week")
      .eq("season", currentSeason)
      .eq("visitor_team_id", teamId)
      .order("date", { ascending: false });

    if (awayGamesError) {
      return { error: `Away games query error: ${awayGamesError.message}` };
    }

    const homeGameIds = homeGames?.map(g => g.id) || [];
    const awayGameIds = awayGames?.map(g => g.id) || [];

    // Get player stats for home games
    const { data: homeStats, error: homeStatsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", homeGameIds);

    if (homeStatsError) {
      return { error: `Home stats query error: ${homeStatsError.message}` };
    }

    // Get player stats for away games
    const { data: awayStats, error: awayStatsError } = await supabase
      .from("player_stats")
      .select(`${normalizedStatType}, game_id`)
      .eq("player_id", playerId)
      .in("game_id", awayGameIds);

    if (awayStatsError) {
      return { error: `Away stats query error: ${awayStatsError.message}` };
    }

    // Calculate home averages
    const homeValues = (homeStats || [])
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);

    const homeAverage = homeValues.length > 0 
      ? +(homeValues.reduce((a, b) => a + b, 0) / homeValues.length).toFixed(1)
      : 0;

    // Calculate away averages
    const awayValues = (awayStats || [])
      .map(stat => stat[normalizedStatType])
      .filter(val => val !== null && val !== undefined);

    const awayAverage = awayValues.length > 0 
      ? +(awayValues.reduce((a, b) => a + b, 0) / awayValues.length).toFixed(1)
      : 0;

    // Calculate difference and determine better venue
    const difference = Math.abs(homeAverage - awayAverage);
    let betterVenue = "neutral";
    let splitDescription = "";

    if (difference < 1) {
      betterVenue = "neutral";
      splitDescription = "performs similarly";
    } else if (homeAverage > awayAverage) {
      betterVenue = "home";
      splitDescription = `performs better at home (+${difference.toFixed(1)})`;
    } else {
      betterVenue = "away";
      splitDescription = `performs better on the road (+${difference.toFixed(1)})`;
    }

    const context = `Home/Away split: **${homeAverage}** at home (${homeValues.length} games) vs **${awayAverage}** on road (${awayValues.length} games) - ${splitDescription}.`;

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      homeAverage,
      awayAverage,
      homeGames: homeValues.length,
      awayGames: awayValues.length,
      difference: +difference.toFixed(1),
      betterVenue,
      homeValues,
      awayValues,
    };
  } catch (err) {
    return { error: `Home/Away split error: ${err.message}` };
  }
} 