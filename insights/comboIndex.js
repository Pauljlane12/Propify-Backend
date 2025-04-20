import { getLast10ComboHitRate }      from "./last10Combo.js";
import { getSeasonVsLast3Combo }      from "./seasonVsLast3Combo.js";
import { getMatchupHistoryCombo }     from "./matchupHistoryCombo.js";
import { getComboHomeAwaySplit }      from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getComboPaceContext }        from "./paceContextCombo.js";
import { getPositionalDefenseCombo }  from "./positionalDefenseCombo.js";   // 🆕 auto‑position version

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
    /* ---------- Insight 1 — Last‑10 Hit Rate ---------- */
    insights.insight_1_hit_rate = await getLast10ComboHitRate({
      playerId,
      statColumns,
      line,
      supabase,
    });

    /* ---------- Insight 2 — Season Avg vs Last 3 ---------- */
    insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
      playerId,
      statColumns,
      supabase,
    });

    /* ---------- Insight 3 — Matchup History ---------- */
    insights.insight_3_matchup_history = await getMatchupHistoryCombo({
      playerId,
      opponentTeamId,
      statColumns,
      supabase,
    });

    /* ---------- Insight 4 — Home / Away Split ---------- */
    insights.insight_4_home_away_split = await getComboHomeAwaySplit({
      playerId,
      teamId,
      statColumns,
      supabase,
    });

    /* ---------- Insight 5 — Rest‑Day Performance ---------- */
    insights.insight_5_rest_day_performance = await getComboRestDayPerformance({
      playerId,
      statType,
      supabase,
    });

    /* ---------- Insight 6 — Opponent Pace Context ---------- */
    insights.insight_6_pace_context = await getComboPaceContext({
      opponentTeamId,
      supabase,
    });

    /* ---------- Insight 7 — Positional Defense (Combo) ---------- */
    insights.insight_7_positional_defense = await getPositionalDefenseCombo({
      playerId,          // 🆕 auto-detects position inside the helper
      opponentTeamId,
      statType,
      supabase,
    });

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
