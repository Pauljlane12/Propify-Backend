// ───── Core Combo Insights ─────
import { getLast10ComboHitRate }      from "./last10Combo.js";
import { getSeasonVsLast3Combo }      from "./seasonVsLast3Combo.js";
import { getMatchupHistoryCombo }     from "./matchupHistoryCombo.js";
import { getComboHomeAwaySplit }      from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getComboPaceContext }        from "./paceContextCombo.js";
import { getPositionalDefenseCombo }  from "./positionalDefenseCombo.js";

// ───── Reused Specialty Insights ─────
// Points-based
import { getFgaTrendLast3 }              from "../points/getFgaTrendLast3.js";
import { getFgPercentTrend }             from "../points/getFgPercentTrend.js";
import { getUsageRateTrend }             from "../points/getUsageRateTrend.js";
import { getScoringSourceVs3ptDefense }  from "../points/getScoringSourceVs3ptDefense.js";
import { getTeamDefRatingRank }          from "../points/getTeamDefRatingRank.js";

// Rebounds-based
import { getOpponentFgPercentLast3 }     from "../rebounds/getOpponentFgPercentLast3.js";
import { getFgTrendLast3ForBothTeams }   from "../rebounds/getFgTrendLast3ForBothTeams.js";

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
    // ───── Core Combo Insights ─────
    insights.insight_1_hit_rate = await getLast10ComboHitRate({
      playerId,
      statColumns,
      line,
      supabase,
    });

    insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
      playerId,
      statColumns,
      supabase,
    });

    insights.insight_3_matchup_history = await getMatchupHistoryCombo({
      playerId,
      opponentTeamId,
      statColumns,
      supabase,
    });

    insights.insight_4_home_away_split = await getComboHomeAwaySplit({
      playerId,
      teamId,
      statColumns,
      supabase,
    });

    insights.insight_5_rest_day_performance = await getComboRestDayPerformance({
      playerId,
      statType,
      supabase,
    });

    insights.insight_6_pace_context = await getComboPaceContext({
      opponentTeamId,
      supabase,
    });

    insights.insight_7_positional_defense = await getPositionalDefenseCombo({
      playerId,
      opponentTeamId,
      statType,
      supabase,
    });

    // ───── Specialty Insights: Points-based ─────
    insights.advanced_fg_percent_trend = await getFgPercentTrend({ playerId, supabase });
    insights.advanced_usage_rate_trend = await getUsageRateTrend({ playerId, supabase });
    insights.advanced_fga_trend_last3 = await getFgaTrendLast3({ playerId, supabase });
    insights.advanced_3pt_scoring_vs_defense = await getScoringSourceVs3ptDefense({
      playerId,
      opponentTeamId,
      supabase,
    });
    insights.advanced_team_def_rating_rank = await getTeamDefRatingRank({
      opponentTeamId,
      supabase,
    });

    // ───── Specialty Insights: Rebounds-based ─────
    insights.advanced_opponent_fg_last3 = await getOpponentFgPercentLast3({
      opponentTeamId,
      supabase,
    });
    insights.advanced_fg_trend_both_teams = await getFgTrendLast3ForBothTeams({
      teamId,
      opponentTeamId,
      supabase,
    });

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
