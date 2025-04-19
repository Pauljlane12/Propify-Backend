import { getLast10ComboHitRate } from "./last10Combo.js";
import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js";
// import additional combo insights as you build them

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

  // 🧠 Add more combo insights here as you build them:
  // - matchup history (combo)
  // - home vs away (combo)
  // - pace/contextual logic (combo)
  // - rest day trend (combo)
  // - etc.

  return insights;
}
