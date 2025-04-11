import { getLast10GameHitRate } from "./last10Games.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getInjuryReport } from "./injuryReport.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";

export async function getInsightsForStat({
  playerId,
  statType,
  line,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};

  // Helper to log and return errors per insight
  async function safe(key, fn) {
    try {
      insights[key] = await fn();
    } catch (err) {
      console.error(`❌ Insight "${key}" failed:`, err.message);
      insights[key] = { error: err.message };
    }
  }

  // ✅ Shared across all props
  await safe("insight_1_hit_rate", () =>
    getLast10GameHitRate({ playerId, statType, line, supabase })
  );

  await safe("insight_2_season_vs_last3", () =>
    getSeasonVsLast3({ playerId, statType, supabase })
  );

  await safe("insight_3_positional_defense", () =>
    getDefenseVsPosition({ playerId, statType, teamId, opponentTeamId, supabase })
  );

  await safe("insight_4_matchup_history", () =>
    getMatchupHistory({ playerId, opponentTeamId, statType, supabase })
  );

  await safe("insight_5_home_vs_away", () =>
    getHomeAwaySplit({ playerId, teamId, statType, supabase })
  );

  await safe("insight_7_injury_report", () =>
    getInjuryReport({ teamId, opponentTeamId, supabase })
  );

  // 🔍 Advanced Metrics (all props)
  await safe("advanced_metric_1_projected_game_pace", () =>
    getProjectedGamePace({ teamId, opponentTeamId, supabase })
  );

  await safe("advanced_metric_2_opponent_pace_rank", () =>
    getTeamPaceRank({ opponentTeamId, supabase })
  );

  // 🧠 Rest Day Insight (all props)
  await safe("rest_day_performance", () =>
    getRestDayPerformance({ playerId, teamId, statType, supabase })
  );

  // 🧠 Rebound-specific advanced insight
  if (statType === "reb") {
    await safe("advanced_metric_4_opponent_fg_last3", () =>
      getOpponentFgPercentLast3({ opponentTeamId, supabase })
    );
  }

  return insights;
}
