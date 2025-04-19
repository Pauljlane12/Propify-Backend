import { getLast10ComboHitRate } from "./last10Combo.js";
// import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js"; // removed for now

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

    // ⏳ Additional combo insights can be added below as you build them:
    // insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo(...)

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
