import { CURRENT_SEASON } from "../constants.js";

export async function getPaceAdjustedPerformance({
  playerId,
  playerLastName,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
    const currentSeason = CURRENT_SEASON;
    const isComboStat = statType === "pras";

    const { data: paceRow } = await supabase
      .from("team_pace_profiles")
      .select("pace_bucket")
      .eq("team_id", opponentTeamId)
      .eq("season", currentSeason)
      .maybeSingle();

    const paceBucket = paceRow?.pace_bucket;
    if (!paceBucket) {
      return { info: "No pace profile found for opponent." };
    }

    const { data: paceTeams, error: paceError } = await supabase
      .from("team_pace_profiles")
      .select("team_id")
      .eq("pace_bucket", paceBucket)
      .eq("season", currentSeason);

    if (paceError || !paceTeams?.length) {
      return { info: "No teams found in this pace bucket." };
    }

    const paceTeamIds = paceTeams.map((t) => t.team_id);

    const { data: statsData, error: statsError } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .not("min", "is", null);

    if (statsError || !statsData?.length) {
      return { info: "No valid player stat data." };
    }

    const gameIds = statsData.map((g) => g.game_id);
    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, season")
      .in("id", gameIds);

    if (gamesError) return { error: gamesError.message };

    const merged = statsData
      .map((g) => {
        const game = gamesData.find((row) => row.id === g.game_id);
        if (!game) return null;

        const parsedMin = parseFloat(g.min);
        if (isNaN(parsedMin) || parsedMin === 0) return null;

        const opponentId =
          g.team_id === game.home_team_id ? game.visitor_team_id : game.home_team_id;

        return {
          ...g,
          min: parsedMin,
          game_date: game.date,
          game_season: game.season,
          opponent_team_id: opponentId,
        };
      })
      .filter(Boolean);

    const usedGames = merged.filter(
      (g) =>
        g.game_season === currentSeason &&
        paceTeamIds.includes(g.opponent_team_id)
    );

    if (usedGames.length === 0) {
      return { info: "No games found vs similar-paced teams in 2024." };
    }

    const average = isComboStat
      ? +(
          usedGames.reduce((sum, g) => sum + g.pts + g.reb + g.ast, 0) /
          usedGames.length
        ).toFixed(2)
      : +(
          usedGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) /
          usedGames.length
        ).toFixed(2);

    const context = `**${playerLastName}** is averaging **${average} ${statType.toUpperCase()}** against teams with a similar pace to tonight’s opponent.`;

    return {
      statType,
      average,
      season: currentSeason,
      context,
    };
  } catch (err) {
    return {
      error: err.message || "Unhandled error in getPaceAdjustedPerformance()",
    };
  }
}
