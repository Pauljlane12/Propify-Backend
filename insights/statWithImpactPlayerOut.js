import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

/**
 * Returns how a player performs when any of their impact teammates are out.
 * Mirrors the same logic as the working SQL version.
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

    // Step 2: Get all impact player IDs
    const { data: impactRows, error: impactError } = await supabase
      .from("impact_players")
      .select("player_id")
      .eq("is_impact_player", true);

    if (impactError || !impactRows?.length) {
      throw new Error("Failed to fetch impact players.");
    }

    const impactIds = impactRows.map((r) => r.player_id);

    // Step 3: Get injured impact teammates on same team
    const { data: injuredTeammatesRaw, error: injuryError } = await supabase
      .from("nbaplayer_injuries")
      .select("player_id, full_name, status")
      .eq("team_id", teamId)
      .neq("player_id", playerId)
      .in("player_id", impactIds);

    if (injuryError) {
      throw new Error("Failed to fetch injured teammates.");
    }

    // Filter for OUT / EXPECTED / GTD / QUESTIONABLE
    const relevantKeywords = ["out", "expected", "game time", "questionable"];
    const injuredTeammates = (injuredTeammatesRaw || []).filter((t) =>
      relevantKeywords.some((kw) =>
        (t.status || "").toLowerCase().includes(kw)
      )
    );

    const insights = [];

    for (const teammate of injuredTeammates) {
      const teammateId = teammate.player_id;

      // Step 4: Find game_ids where teammate had 0 minutes
      const { data: zeroGames } = await supabase
        .from("player_stats")
        .select("game_id")
        .eq("player_id", teammateId)
        .in("min", ["0", "00", "00:00", null]);

      const zeroGameIds = (zeroGames || []).map((g) => g.game_id);
      if (!zeroGameIds.length) continue;

      // Step 5: Get current player's stats in those games (where they played)
      const { data: userGames } = await supabase
        .from("player_stats")
        .select("game_id, min, " + statType)
        .eq("player_id", playerId)
        .in("game_id", zeroGameIds)
        .order("game_id", { ascending: false });

      if (!userGames?.length) continue;

      // Include all valid games (no slice)
      const validStats = userGames
        .filter(
          (g) =>
            g.min &&
            !["0", "00", "00:00"].includes(g.min) &&
            g[statType] != null &&
            !isNaN(g[statType])
        )
        .map((g) => g[statType]);

      if (!validStats.length) continue;

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
