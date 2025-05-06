import { CURRENT_SEASON } from "../constants.js";
import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getPaceAdjustedPerformance({
  playerId,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const statColumn = statType === "pras" 
      ? "pts + ast + reb"
      : statType;

    const currentSeason = CURRENT_SEASON;
    const lastSeason = currentSeason - 1;

    // Step 1: Get pace bucket for the opponent
    const { data: paceRow, error: paceError } = await supabase
      .from("team_pace_profiles")
      .select("pace_bucket")
      .eq("team_id", opponentTeamId)
      .eq("season", currentSeason)
      .maybeSingle();

    // Fallback: use last season’s pace if none exists yet for this team
    let paceBucket = paceRow?.pace_bucket;
    if (!paceBucket) {
      const { data: fallbackPaceRow, error: fbError } = await supabase
        .from("team_pace_profiles")
        .select("pace_bucket")
        .eq("team_id", opponentTeamId)
        .eq("season", lastSeason)
        .maybeSingle();
      paceBucket = fallbackPaceRow?.pace_bucket;
    }

    if (!paceBucket) {
      return {
        info: `No pace profile found for opponent.`,
      };
    }

    // Step 2: Get team IDs in that pace bucket
    const { data: paceTeams, error: paceTeamsError } = await supabase
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
      return {
        info: `No teams found in this pace bucket.`,
      };
    }

    // Step 3: Query player_stats vs those teams
    const { data: playedGames, error: playedError } = await supabase
      .from("player_stats")
      .select("game_id, min, pts, reb, ast, blk, stl, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, turnover, game_season, team_id")
      .in("opponent_team_id", paceTeamIds)
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0);

    if (playedError) return { error: playedError.message };

    const currentSeasonStats = playedGames.filter(g => g.game_season === currentSeason);
    const lastSeasonStats = playedGames.filter(g => g.game_season === lastSeason);

    const gameStats = currentSeasonStats.length > 0 
      ? currentSeasonStats 
      : lastSeasonStats;

    const usedSeason = currentSeasonStats.length > 0 ? currentSeason : lastSeason;

    if (gameStats.length === 0) {
      return {
        info: `No games found vs similar-paced teams.`,
      };
    }

    // Step 4: Compute average
    const average =
      statType === "pras"
        ? +(gameStats.reduce((acc, g) => acc + g.pts + g.reb + g.ast, 0) / gameStats.length).toFixed(2)
        : +(gameStats.reduce((acc, g) => acc + (g[statType] ?? 0), 0) / gameStats.length).toFixed(2);

    const insight = `Against teams that play at a similar pace to tonight’s opponent, this player is averaging **${average} ${statType.toUpperCase()}** across **${gameStats.length} games** in ${usedSeason}.`;

    return {
      statType,
      average,
      games_played: gameStats.length,
      season: usedSeason,
      context: insight,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in getPaceAdjustedPerformance()" };
  }
}
