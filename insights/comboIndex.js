// ───── Core Combo Insights ─────
import { getLast10ComboHitRate }      from "./last10Combo.js";
import { getSeasonVsLast3Combo }      from "./seasonVsLast3Combo.js";
import { getMatchupHistoryCombo }     from "./matchupHistoryCombo.js";
import { getComboHomeAwaySplit }      from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getComboPaceContext }        from "./paceContextCombo.js";
import { getPositionalDefenseCombo }  from "./positionalDefenseCombo.js";

// ───── Reused Specialty Insights ─────
import { getFgaTrendLast3 }              from "./fgaTrendLast3.js";
import { getFgPercentTrend }             from "./getFgPercentTrend.js";
import { getUsageRateTrend }             from "./getUsageRateTrend.js";
import { getScoringSourceVs3ptDefense }  from "./getScoringSourceVs3ptDefense.js";
import { getTeamDefRatingRank }          from "./getTeamDefRatingRank.js";
import { getFgTrendLast3ForBothTeams }   from "./getFgTrendLast3ForBothTeams.js";
import { getTeamDefenseRankInsight }     from "./getTeamDefenseRank.js"; // ✅ NEW

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

    // ───── Points-Based Specialty Insights ─────
    if (["pra", "pr", "pa", "pts"].includes(statType)) {
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
    }

    // ───── FG% Trend Across Both Teams (Rebounds-Based) ─────
    if (["pra", "pr"].includes(statType)) {
      insights.advanced_fg_trend_both_teams = await getFgTrendLast3ForBothTeams({
        teamId,
        opponentTeamId,
        supabase,
      });
    }

    // ───── NEW: Team Defense Rank Insights ─────
    if (statType === "pra") {
      insights.def_rank_pts = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "pts", supabase });
      insights.def_rank_reb = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "reb", supabase });
      insights.def_rank_ast = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "ast", supabase });
    } else if (statType === "pr") {
      insights.def_rank_pts = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "pts", supabase });
      insights.def_rank_reb = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "reb", supabase });
    } else if (statType === "pa") {
      insights.def_rank_pts = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "pts", supabase });
      insights.def_rank_ast = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "ast", supabase });
    } else if (statType === "ra") {
      insights.def_rank_reb = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "reb", supabase });
      insights.def_rank_ast = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType: "ast", supabase });
    } else if (["blk", "stl"].includes(statType)) {
      insights.def_rank = await getTeamDefenseRankInsight({ teamId: opponentTeamId, statType, supabase });
    }

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
