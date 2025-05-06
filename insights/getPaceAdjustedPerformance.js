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

    // 1. Get opponent's pace bucket (2024+ only, no fallback for consistency with SQL)
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

    // 2. Get all teams in that pace bucket (no fallback)
    const { data: paceTeams, error: paceError } = await supabase
      .from("team_pace_profiles")
      .select("team_id")
      .eq("pace_bucket", paceBucket)
      .eq("season", currentSeason);

    if (paceError || !paceTeams?.length) {
      return { info: "No pace bucket teams found (2024)." };
    }

    const paceTeamIds = paceTeams.map((t) => t.team_id);

    // 3. Get all player games with valid minutes
    const { data: statsData, error: statsError } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .not("min", "is", null)
      .gt("min", 0);

    if (statsError || !statsData?.length) {
      return { info: "No valid player stat data." };
    }

    // 4. Get game metadata for opponent inference
    const gameIds = statsData.map((g) => g.game_id);
    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, season")
      .in("id", gameIds);

    if (gamesError) return { error: gamesError.message };

    // 5. Merge stats + games and infer opponent
    const merged = statsData
      .map((g) => {
        const game = gamesData.find((row) => row.id === g.game_id);
        if (!game) return null;

        const opponentId =
          g.team_id === game.home_team_id ? game.visitor_team_id : game.home_team_id;

        return {
          ...g,
          game_date: game.date,
          game_season: game.season,
          opponent_team_id: opponentId,
        };
      })
      .filter(Boolean);

    // 6. Filter games to matching pace teams in CURRENT_SEASON only
    const usedGames = merged.filter(
      (g) =>
        g.game_season === currentSeason &&
        paceTeamIds.includes(g.opponent_team_id)
    );

    if (usedGames.length === 0) {
      return { info: "No games found vs similar-paced teams in 2024." };
    }

    // 7. Calculate stat average
    const average = isComboStat
      ? +(
          usedGames.reduce((sum, g) => sum + g.pts + g.reb + g.ast, 0) /
          usedGames.length
        ).toFixed(2)
      : +(
          usedGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) /
          usedGames.length
        ).toFixed(2);

    // ✅ DEBUG LOGGING
    console.log("✅ Pace-Adjusted Performance Debug:");
    console.table(
      usedGames.map((g) => ({
        game_date: g.game_date,
        season: g.game_season,
        opponent_team_id: g.opponent_team_id,
        min: g.min,
        pts: g.pts,
        reb: g.reb,
        ast: g.ast,
        stat_value: isComboStat
          ? g.pts + g.reb + g.ast
          : g[statType] ?? 0,
      }))
    );
    console.log(
      `📊 Used ${usedGames.length} games in season ${currentSeason} for pace bucket '${paceBucket}'`
    );

    const context = `Against teams that play at a similar pace to tonight’s opponent, this player is averaging **${average} ${statType.toUpperCase()}** across **${usedGames.length} games** in ${currentSeason}.`;

    return {
      statType,
      average,
      games_played: usedGames.length,
      season: currentSeason,
      context,
    };
  } catch (err) {
    return {
      error: err.message || "Unhandled error in getPaceAdjustedPerformance()",
    };
  }
}
