import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

/**
 * Returns how a player performs when any of their impact teammates are out.
 * Example: "Mitchell has averaged 30.6 PTS in 3 games without Evan Mobley."
 */
export async function getStatWithImpactPlayerOut({
  playerId,
  playerLastName = "Player",
  statType = "pts",
  supabase,
}) {
  const insightId = "injury_impact_stat";
  const insightTitle = "Impact Teammate Injury Effect";

  try {
    // Step 1: Get player's team_id
    const { data: playerRow, error: playerError } = await supabase
      .from("active_players")
      .select("team_id")
      .eq("player_id", playerId)
      .single();

    if (playerError || !playerRow) {
      throw new Error("Could not find player's team_id.");
    }

    const teamId = playerRow.team_id;

    // Step 2: Get list of currently OUT or GTD impact teammates (same team, excluding this player)
    const { data: injuredTeammates, error: injuryError } = await supabase
      .from("nbaplayer_injuries")
      .select("player_id, full_name")
      .eq("team_id", teamId)
      .neq("player_id", playerId)
      .ilike("status", "%out%") // fallback added below
      .or("status.ilike.%game time decision%,status.ilike.%questionable%")
      .in("player_id", supabase
        .from("impact_players")
        .select("player_id")
        .eq("is_impact_player", true)
      );

    if (injuryError) {
      throw new Error("Failed to fetch injured teammates.");
    }

    const insights = [];

    for (const teammate of injuredTeammates || []) {
      const teammateId = teammate.player_id;

      // Step 3: Get all games where that teammate logged 0 minutes
      const { data: zeroGames } = await supabase
        .from("player_stats")
        .select("game_id")
        .eq("player_id", teammateId)
        .in("min", ["0", "00", "00:00", null]);

      const zeroGameIds = (zeroGames || []).map((g) => g.game_id);

      if (zeroGameIds.length === 0) continue;

      // Step 4: Find games where playerId played in those games
      const { data: userGames } = await supabase
        .from("player_stats")
        .select("game_id, min, " + statType)
        .eq("player_id", playerId)
        .in("game_id", zeroGameIds)
        .not("min", "in", ["0", "00", "00:00", null])
        .order("game_id", { ascending: false })
        .limit(3);

      if (!userGames || userGames.length === 0) continue;

      const validStats = userGames
        .filter((g) => g[statType] !== null && !isNaN(g[statType]))
        .map((g) => g[statType]);

      if (validStats.length === 0) continue;

      const avg = (
        validStats.reduce((sum, val) => sum + val, 0) / validStats.length
      ).toFixed(1);

      insights.push({
        id: `${insightId}_${teammateId}`,
        title: insightTitle,
        value: `${avg} ${statType.toUpperCase()}`,
        context: `${playerLastName} has averaged ${avg} ${statType.toUpperCase()} in ${
          validStats.length
        } games without ${teammate.full_name}.`,
        status: "info",
        details: {
          statType,
          teammate: teammate.full_name,
          gamesUsed: validStats.length,
          avg: parseFloat(avg),
        },
      });
    }

    return insights.length
      ? insights
      : [
          {
            id: insightId,
            title: insightTitle,
            value: "N/A",
            context: `${playerLastName} has no injury-based stat changes worth highlighting.`,
            status: "info",
            details: { totalInsights: 0 },
          },
        ];
  } catch (err) {
    console.error(`❌ ${insightTitle} Error:`, err.message);
    return [
      {
        id: insightId,
        title: insightTitle,
        value: "Error",
        context: "Could not calculate this injury insight.",
        status: "danger",
        error: err.message,
      },
    ];
  }
}
