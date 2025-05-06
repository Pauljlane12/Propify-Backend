import { CURRENT_SEASON } from "../constants.js";

export async function getPaceAdjustedPerformance({
  playerId,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const statColumn = statType === "pras"
      ? ["pts", "reb", "ast"]
      : [statType];

    const currentSeason = CURRENT_SEASON;
    const lastSeason = currentSeason - 1;

    // 1. Get pace bucket for opponent
    const { data: paceRow } = await supabase
      .from("team_pace_profiles")
      .select("pace_bucket")
      .eq("team_id", opponentTeamId)
      .eq("season", currentSeason)
      .maybeSingle();

    let paceBucket = paceRow?.pace_bucket;

    if (!paceBucket) {
      const { data: fallbackPace } = await supabase
        .from("team_pace_profiles")
        .select("pace_bucket")
        .eq("team_id", opponentTeamId)
        .eq("season", lastSeason)
        .maybeSingle();

      paceBucket = fallbackPace?.pace_bucket;
    }

    if (!paceBucket) {
      return { info: "No pace profile found for opponent." };
    }

    // 2. Get teams in the same pace bucket
    const { data: paceTeams } = await supabase
      .from("team_pace_profiles")
      .select("team_id")
      .eq("pace_bucket", paceBucket)
      .eq("season", currentSeason);

    const fallbackTeams = !paceTeams?.length
      ? await supabase
          .from("team_pace_profiles")
          .select("team_id")
          .eq("pace_bucket", paceBucket)
          .eq("season", lastSeason)
      : null;

    const paceTeamIds =
      paceTeams?.map((t) => t.team_id) ??
      fallbackTeams?.data?.map((t) => t.team_id) ??
      [];

    if (paceTeamIds.length === 0) {
      return { info: "No teams found in this pace bucket." };
    }

    // 3. Join games to infer opponent
    const { data: playedGames, error } = await supabase
      .from("player_stats")
      .select(`
        game_id,
        min,
        pts,
        reb,
        ast,
        blk,
        stl,
        fg3m,
        fg3a,
        fga,
        ftm,
        fgm,
        oreb,
        dreb,
        turnover,
        game_season,
        team_id,
        games:game_id (
          home_team_id,
          visitor_team_id
        )
      `)
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0);

    if (error) return { error: error.message };

    // 4. Infer opponent team ID
    const withOpponent = (playedGames ?? []).map(g => {
      const opponentId =
        g.team_id === g.games?.home_team_id
          ? g.games?.visitor_team_id
          : g.games?.home_team_id;
      return { ...g, opponent_team_id: opponentId };
    });

    // 5. Filter games vs pace-matching teams
    const currentSeasonStats = withOpponent.filter(
      g => g.game_season === currentSeason && paceTeamIds.includes(g.opponent_team_id)
    );
    const lastSeasonStats = withOpponent.filter(
      g => g.game_season === lastSeason && paceTeamIds.includes(g.opponent_team_id)
    );

    const gameStats = currentSeasonStats.length > 0
      ? currentSeasonStats
      : lastSeasonStats;

    const usedSeason = currentSeasonStats.length > 0 ? currentSeason : lastSeason;

    if (gameStats.length === 0) {
      return { info: "No games found vs similar-paced teams." };
    }

    // 6. Calculate average
    const average =
      statType === "pras"
        ? +(gameStats.reduce((sum, g) => sum + g.pts + g.reb + g.ast, 0) / gameStats.length).toFixed(2)
        : +(gameStats.reduce((sum, g) => sum + (g[statType] ?? 0), 0) / gameStats.length).toFixed(2);

    const context = `Against teams that play at a similar pace to tonight’s opponent, this player is averaging **${average} ${statType.toUpperCase()}** across **${gameStats.length} games** in ${usedSeason}.`;

    return {
      statType,
      average,
      games_played: gameStats.length,
      season: usedSeason,
      context,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in getPaceAdjustedPerformance()" };
  }
}
