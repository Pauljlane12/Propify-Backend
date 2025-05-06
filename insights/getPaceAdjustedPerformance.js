import { CURRENT_SEASON } from "../constants.js";

export async function getPaceAdjustedPerformance({
  playerId,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const currentSeason = CURRENT_SEASON;
    const lastSeason = currentSeason - 1;
    const isComboStat = statType === "pras";

    // Step 1: Get pace bucket for opponent
    const { data: paceRow } = await supabase
      .from("team_pace_profiles")
      .select("pace_bucket")
      .eq("team_id", opponentTeamId)
      .eq("season", currentSeason)
      .maybeSingle();

    let paceBucket = paceRow?.pace_bucket;

    if (!paceBucket) {
      const { data: fallbackRow } = await supabase
        .from("team_pace_profiles")
        .select("pace_bucket")
        .eq("team_id", opponentTeamId)
        .eq("season", lastSeason)
        .maybeSingle();
      paceBucket = fallbackRow?.pace_bucket;
    }

    if (!paceBucket) {
      return { info: "No pace profile found for opponent." };
    }

    // Step 2: Get all teams in that pace bucket (this season, fallback to last)
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

    // Step 3: Get all games the player played
    const { data: statsData, error: statsError } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0);

    if (statsError) return { error: statsError.message };
    if (!statsData?.length) return { info: "No games played by player." };

    const gameIds = statsData.map((s) => s.game_id);
    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("id, home_team_id, visitor_team_id, season")
      .in("id", gameIds);

    if (gamesError) return { error: gamesError.message };

    // Step 4: Join player_stats + games and infer opponent team
    const merged = statsData.map((s) => {
      const game = gamesData.find((g) => g.id === s.game_id);
      if (!game) return null;

      const opponentTeamId =
        s.team_id === game.home_team_id ? game.visitor_team_id : game.home_team_id;

      return {
        ...s,
        game_season: game.season,
        opponent_team_id: opponentTeamId,
      };
    }).filter(Boolean);

    // Step 5: Filter by season + pace bucket
    const currentGames = merged.filter(
      (g) => g.game_season === currentSeason && paceTeamIds.includes(g.opponent_team_id)
    );
    const lastGames = merged.filter(
      (g) => g.game_season === lastSeason && paceTeamIds.includes(g.opponent_team_id)
    );

    const usedGames = currentGames.length > 0 ? currentGames : lastGames;
    const usedSeason = currentGames.length > 0 ? currentSeason : lastSeason;

    if (usedGames.length === 0) {
      return { info: "No games found vs similar-paced teams." };
    }

    // Step 6: Calculate stat average
    const average = isComboStat
      ? +(usedGames.reduce((sum, g) => sum + g.pts + g.reb + g.ast, 0) / usedGames.length).toFixed(2)
      : +(usedGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) / usedGames.length).toFixed(2);

    const context = `Against teams that play at a similar pace to tonight’s opponent, this player is averaging **${average} ${statType.toUpperCase()}** across **${usedGames.length} games** in ${usedSeason}.`;

    return {
      statType,
      average,
      games_played: usedGames.length,
      season: usedSeason,
      context,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in getPaceAdjustedPerformance()" };
  }
}
