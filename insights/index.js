/**
 * insights/index.js
 * Orchestrates the fetching and generation of all relevant insights for a given player and stat type.
 * Includes minimal changes to accept player name, extract capitalized last name, pass it down, and add a debug log.
 */
import { getLast10GameHitRate } from "./last10Games.js";
// Assuming you have a separate orchestrator and individual files for combo stats,
// so we won't call combo insight functions directly from this single-stat orchestrator.
// import { getLast10ComboHitRate } from "./getLast10ComboHitRate.js"; // Removed import for combo insights

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
 * Helper to get the last name from a full name string and capitalize its first letter.
 * Defaults to "Player" if the input name is falsy or has only one part.
 * @param {string} name - The full player name.
 * @returns {string} - The player's last name with the first letter capitalized, or "Player".
 */
const getLastName = (name) => {
    if (!name) return "Player"; // Default if name is missing
    const parts = name.trim().split(" ");
    const lastName = parts.length > 1 ? parts[parts.length - 1] : name; // Get the last part or the name itself
    // Capitalize the first letter and add the rest of the string
    return lastName.charAt(0).toUpperCase() + lastName.slice(1);
};


export async function getInsightsForStat({
    playerId,
    playerName, // Accept player name from API endpoint
    statType,
    line,
    direction,
    teamId,
    opponentTeamId,
    supabase,
}) {
    // Initialize insights object (keeping original structure)
    const insights = {};

    // Get the capitalized last name using the helper
    const playerLastName = getLastName(playerName);
    console.log(`🔍 getInsightsForStat: Determined playerLastName as "${playerLastName}" from playerName "${playerName}"`); // DEBUG LOG


    // Keep statColumns as it was in your file
    const statColumns = [statType];

    // ✅ Hit Rate - passing capitalized last name
    // Assuming getLast10GameHitRate is updated to accept playerLastName
    insights.insight_1_hit_rate = await getLast10GameHitRate({
        playerId,
        playerLastName, // Pass the determined capitalized last name
        statType,
        statColumns, // Pass statColumns (even if getLast10GameHitRate doesn't use it)
        line,
        direction,
        supabase,
    });

    // --- Other insights (keeping original calls) ---
    // These calls remain unchanged for now. You will update them later
    // to accept playerLastName and return standardized objects.
    // Remember to pass playerLastName to them if they need it for context strings.

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

    // Return the insights object (keeping original structure)
    return insights;
}
