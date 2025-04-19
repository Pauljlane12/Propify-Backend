import { getLast10ComboHitRate } from "./last10Combo.js";
import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js";
import { getMatchupHistoryCombo } from "./matchupHistoryCombo.js";

export async function getComboInsights({
  playerId,
  statType,
  statColumns,
  line,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};

  console.log("📦 [Combo] Running insights for:", statType);

  try {
    // ✅ Insight 1 — Last 10 Game Hit Rate (Combo)
    insights.insight_1_hit_rate = await getLast10ComboHitRate({
      playerId,
      statColumns,
      line,
      supabase,
    });

    // ✅ Insight 2 — Season Avg vs Last 3 Games (Combo)
    insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
      playerId,
      statColumns,
      supabase,
    });

    // ✅ Insight 3 — Matchup History (Combo, both seasons)
    insights.insight_3_matchup_history = await getMatchupHistoryCombo({
      playerId,
      opponentTeamId,
      statColumns,
      supabase,
    });

    // ⏳ Upcoming:
    // insights.insight_4_home_away_split = ...
    // insights.insight_5_rest_day_performance = ...

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
