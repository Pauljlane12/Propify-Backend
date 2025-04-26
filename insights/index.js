/**
 * insights/index.js
 * Orchestrates the fetching and generation of all relevant insights for a given player and stat type.
 * Collects standardized insight objects from individual insight functions.
 * Minimal changes to accept player name, extract last name, and pass it down for debugging.
 */
import { getLast10GameHitRate } from "./last10Games.js";
import { getLast10ComboHitRate } from "./getLast10ComboHitRate.js"; // Assuming you have this for combo props
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js"; // ✅ New import

/**
 * Helper to get the last name from a full name string.
 * Defaults to "Player" if the input name is falsy or has only one part.
 * @param {string} name - The full player name.
 * @returns {string} - The player's last name or "Player".
 */
const getLastName = (name) => {
    if (!name) return "Player"; // Default if name is missing
    const parts = name.trim().split(" ");
    return parts.length > 1 ? parts[parts.length - 1] : name; // Use last part if multiple, otherwise use the name itself
};


export async function getInsightsForStat({
    playerId,
    playerName, // <<-- ADDED: Accept player name from API endpoint
    statType,
    line,
    direction,
    teamId,
    opponentTeamId,
    supabase,
}) {
    // Initialize insights object (keeping original structure for now)
    const insights = {};

    // Get the last name using the helper
    const playerLastName = getLastName(playerName);
    console.log(`🔍 getInsightsForStat: Determined playerLastName as "${playerLastName}" from playerName "${playerName}"`); // <<-- ADDED DEBUG LOG

    const statColumns = [statType]; // Keep this as it was

    // ✅ Hit Rate - now direction-aware and passing last name
    // Assuming getLast10GameHitRate is updated to accept playerLastName
    insights.insight_1_hit_rate = await getLast10GameHitRate({
        playerId,
        playerLastName, // <<-- PASSING: Pass the determined last name
        statType,
        statColumns, // Note: getLast10GameHitRate might not use statColumns directly, but keeping for consistency if needed
        line,
        direction,
        supabase,
    });

    // --- Other insights (only passing playerLastName if the function is updated to accept it) ---
    // For now, we'll only pass it to the Last 10 scripts as they are updated.
    // You will need to update these functions individually later to accept playerLastName
    // and use it in their context strings if desired.

    insights.insight_2_season_vs_last3 = await getSeasonVsLast3({
        playerId,
        statType,
        supabase,
    });

    insights.insight_3_positional_defense = await getDefenseVsPosition({
        playerId,
        statType,
        teamId,
        opponentTeamId,
        supabase,
    });

    insights.insight_4_matchup_history = await getMatchupHistory({
        playerId,
        opponentTeamId,
        statType,
        bettingLine: line,
        supabase,
    });

    insights.insight_5_home_vs_away = await getHomeAwaySplit({
        playerId,
        teamId,
        statType,
        supabase,
    });

    insights.advanced_metric_1_projected_game_pace = await getProjectedGamePace({
        teamId,
        opponentTeamId,
        supabase,
    });

    insights.advanced_metric_2_opponent_pace_rank = await getTeamPaceRank({
        opponentTeamId,
        supabase,
    });

    insights.rest_day_performance = await getRestDayPerformance({
        playerId,
        teamId,
        statType,
        supabase,
    });

    if (statType === "reb") {
        insights.advanced_metric_4_opponent_fg_last3 = await getOpponentFgPercentLast3({
            opponentTeamId,
            supabase,
        });
    }

    if (statType === "pts") {
        insights.advanced_metric_4_fga_trend_last3 = await getFgaTrendLast3({
            playerId,
            supabase,
        });
    }

    // Note: If you have getLast10ComboHitRate, you'd pass playerLastName there too:
    // if (statColumns && statColumns.length > 1) {
    //      insights.insight_1_hit_rate = await getLast10ComboHitRate({
    //          playerId,
    //          playerLastName, // Pass last name
    //          statColumns,
    //          line,
    //          direction,
    //          supabase,
    //      });
    // } else {
    //      insights.insight_1_hit_rate = await getLast10GameHitRate({
    //          playerId,
    //          playerLastName, // Pass last name
    //          statType,
    //          line,
    //          direction,
    //          supabase,
    //      });
    // }


    return insights; // Return the insights object
}
