import { CURRENT_SEASON } from "../constants.js";

export async function getPaceAdjustedPerformance({
  playerId,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const currentSeason = CURRENT_SEASON;
    const isComboStat = statType === "pras";

    // 1. Get opponent pace bucket (current season only)
    const { data: paceRow } = await supabase
      .from("team_pace_profiles")
      .select("pace_bucket")
      .eq("team_id", opponentTeamId)
      .eq("season", currentSeason)
      .maybeSingle();

    const paceBucket = paceRow?.pace_bucket;

    if (!paceBucket) {
      return { info: "No pace profile found for opponent (2024)." };
    }

    // 2. Get teams in same pace bucket (2024 only)
    const { data: paceTeams, error: paceError } = await supabase
      .from("team_pace_profiles")
      .select("team_id")
      .eq("pace_bucket", paceBucket)
      .eq("season", currentSeason);

    if (paceError || !paceTeams?.length) {
      return { info: "No pace bucket teams found (2024)." };
    }

    const paceTeamIds = paceTeams.map(t => t.team_id);

    // 3. Get player_stats with minutes
    const { data: statsData, error: statsError } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0);

    if (statsError || !statsData?.length) {
      return { info: "No valid player stat data." };
    }

    // 4. Get game metadata to infer opponent
    const gameIds = statsData.map(g => g.game_id);
    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("id, home_team_id, visitor_team_id, season")
      .in("id", gameIds);

    if (gamesError) return { error: gamesError.message };

    // 5. Infer opponent from game info
    const merged = statsData.map(g => {
      const game = gamesData.find(row => row.id === g.game_id);
      if (!game) return null;

      const opponentId =
        g.team_id === game.home_team_id ? game.visitor_team_id : game.home_team_id;

      return {
        ...g,
        game_season: game.season,
        opponent_team_id: opponentId,
      };
    }).filter(Boolean);

    // 6. Filter for 2024 games only
    const usedGames = merged.filter(
      g => g.game_season === currentSeason && paceTeamIds.includes(g.opponent_team_id)
    );

    if (usedGames.length === 0) {
      return { info: "No games found vs similar-paced teams in 2024." };
    }

    // 7. Compute average
    const average = isComboStat
      ? +(usedGames.reduce((sum, g) => sum + g.pts + g.reb + g.ast, 0) / usedGames.length).toFixed(2)
      : +(usedGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) / usedGames.length).toFixed(2);

    const context = `Against teams that play at a similar pace to tonight’s opponent, this player is averaging **${average} ${statType.toUpperCase()}** across **${usedGames.length} games** in 2024.`;

    return {
      statType,
      average,
      games_played: usedGames.length,
      season: currentSeason,
      context,
    };
  } catch (err) {
    return { error: err.message || "Unhandled error in getPaceAdjustedPerformance()" };
  }
}
