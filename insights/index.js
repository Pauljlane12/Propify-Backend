/**
 * insights/index.js
 * Orchestrates the fetching and generation of all relevant insights for a given player and stat type.
 * Collects standardized insight objects from individual insight functions.
 * Accepts player name, extracts last name, and passes it down to insight functions.
 * Includes debug log for playerLastName.
 * Now includes the call to NBAgraphs.js for recent game performance chart data.
 */
import { getLast10GameHitRate } from "./last10Games.js";
// Assuming you have a separate orchestrator and individual files for combo stats.
// import { getLast10ComboHitRate } from "./getLast10ComboHitRate.js"; // Removed import for combo insights

import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js";
import { getRecentGamePerformance } from "./NBAgraphs.js"; // <<-- Import your new script

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


/**
 * Fetches and compiles all relevant insights for a player and single stat type.
 * This orchestrator is specifically for single-stat props.
 * @param {Object} params - Parameters for insight generation.
 * @param {number} params.playerId - The ID of the player.
 * @param {string} params.playerName - The full name of the player (e.g., "LeBron James").
 * @param {string} params.statType - The type of statistic (e.g., "pts", "reb", "ast", "blk").
 * // statColumns parameter is typically used by the combo orchestrator,
 * // but keeping it here in case it's passed, though not used for logic in this file.
 * @param {string[]} [params.statColumns] - Array of columns for combo stats (not used in this single-stat orchestrator).
 * @param {number} params.line - The betting line for the prop.
 * @param {string} params.direction - The bet direction ("over" or "under").
 * @param {number} params.teamId - The player's team ID.
 * @param {number} [params.opponentTeamId] - The opponent team ID for the next game (optional).
 * @param {Object} params.supabase - The Supabase client instance.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of standardized insight objects.
 */
export async function getInsightsForStat({
    playerId,
    playerName,
    statType,
    statColumns,
    line,
    direction,
    teamId,
    opponentTeamId,
    supabase,
}) {
    // Initialize an array to hold all standardized insight objects
    const insightsArray = [];

    // Get the capitalized last name using the helper
    const playerLastName = getLastName(playerName);
    console.log(`🔍 getInsightsForStat: Determined playerLastName as "${playerLastName}" from playerName "${playerName}"`); // DEBUG LOG


    // --- Core Insights (Applicable to most/all single stat types) ---

    // 1. Last 10 Games Hit Rate (Single Stat)
    // Pass playerLastName to the insight function
    const last10SingleInsight = await getLast10GameHitRate({
        playerId,
        playerLastName, // Pass last name
        statType,
        line,
        direction,
        supabase,
        // statColumns is not needed by getLast10GameHitRate
    });
     // Add the returned standardized insight object to the array
     if (last10SingleInsight) insightsArray.push(last10SingleInsight);


    // 2. Recent Game Performance for Charts (NBAgraphs.js)
    // Call the new insight function and add its result to the array
    const recentGamePerformanceInsight = await getRecentGamePerformance({
        playerId,
        statType,
        line,
        direction,
        supabase,
        // gameRanges defaults to [5, 10, 15] in NBAgraphs.js, pass here if you want to override
        // gameRanges: [5, 10, 15, 20],
    });
    if (recentGamePerformanceInsight) insightsArray.push(recentGamePerformanceInsight);


    // 3. Season Average vs Last 3 Games
    // Assuming getSeasonVsLast3 is updated to return standardized object and accept playerLastName
    const seasonVsLast3Insight = await getSeasonVsLast3({
        playerId,
        playerLastName, // Pass last name if needed for its context string
        statType,
        supabase,
    });
    if (seasonVsLast3Insight) insightsArray.push(seasonVsLast3Insight);


    // 4. Positional Defense vs Opponent
    // Assuming getDefenseVsPosition is updated to return standardized object and accept playerLastName
    const positionalDefenseInsight = await getDefenseVsPosition({
        playerId,
        playerLastName, // Pass last name if needed
        statType,
        teamId, // teamId is needed for the player's position context
        opponentTeamId,
        supabase,
    });
    if (positionalDefenseInsight) insightsArray.push(positionalDefenseInsight);


    // 5. Matchup History vs Opponent
    // Assuming getMatchupHistory is updated to return standardized object and accept playerLastName
    const matchupHistoryInsight = await getMatchupHistory({
        playerId,
        playerLastName, // Pass last name if needed
        opponentTeamId,
        statType, // getMatchupHistory likely needs statType
        bettingLine: line,
        direction, // Pass direction if matchup history logic uses it
        supabase,
    });
     if (matchupHistoryInsight) insightsArray.push(matchupHistoryInsight);


    // 6. Home vs Away Split
    // Assuming getHomeAwaySplit is updated to return standardized object and accept playerLastName
    const homeAwayInsight = await getHomeAwaySplit({
        playerId,
        playerLastName, // Pass last name if needed
        teamId,
        statType, // getHomeAwaySplit likely needs statType
        supabase,
    });
    if (homeAwayInsight) insightsArray.push(homeAwayInsight);


    // 7. Rest Day Performance
    // Assuming getRestDayPerformance is updated to return standardized object and accept playerLastName
     const restDayInsight = await getRestDayPerformance({
         playerId,
         playerLastName, // Pass last name if needed
         teamId, // Rest day performance might need teamId to check schedule
         statType, // Rest day performance likely needs statType
         supabase,
     });
     if (restDayInsight) insightsArray.push(restDayInsight);


    // --- Advanced Metrics (May apply to specific props or all) ---
    // Note: These might need playerLastName passed down too if their context uses it

    // 8. Projected Game Pace vs League Average (Applies to all props)
    // Assuming getProjectedGamePace is updated to return standardized object and accept playerLastName
    const gamePaceInsight = await getProjectedGamePace({
        playerLastName, // Pass last name if needed for context
        teamId,
        opponentTeamId,
        supabase,
    });
    if (gamePaceInsight) insightsArray.push(gamePaceInsight);


    // 9. Opponent Pace Rank (Applies to all props)
    // Assuming getTeamPaceRank is updated to return standardized object and accept playerLastName
    const opponentPaceRankInsight = await getTeamPaceRank({
        playerLastName, // Pass last name if needed for context
        opponentTeamId,
        supabase,
    });
    if (opponentPaceRankInsight) insightsArray.push(opponentPaceRankInsight);


    // --- Stat-Specific Advanced Insights ---

    // 10. Rebound-specific advanced insight (Opponent FG % Last 3)
    if (statType === "reb") { // Only for single 'reb' stat
        // Assuming getOpponentFgPercentLast3 is updated to return standardized object and accept playerLastName
        const opponentFgInsight = await getOpponentFgPercentLast3({
            playerLastName, // Pass last name if needed
            opponentTeamId,
            supabase,
        });
        if (opponentFgInsight) insightsArray.push(opponentFgInsight);
    }

    // 11. Points-specific advanced insight (FGA Trend Last 3)
    if (statType === "pts") { // Only for single 'pts' stat
        // Assuming getFgaTrendLast3 is updated to return standardized object and accept playerLastName
        const fgaTrendInsight = await getFgaTrendLast3({
            playerId,
            playerLastName, // Pass last name
            supabase,
        });
        if (fgaTrendInsight) insightsArray.push(fgaTrendInsight);
    }

    // Add more stat-specific insights here as you create them for single stats...
    // Example: Blocks specific insight
    // if (statType === "blk") {
    //     const blocksSpecificInsight = await getBlocksSpecificInsight({
    //         playerId,
    //         playerLastName, // Pass last name
    //         opponentTeamId,
    //         supabase,
    //     });
    //     if (blocksSpecificInsight) insightsArray.push(blocksSpecificInsight);
    // }


    // Return the array of standardized insight objects
    return insightsArray;
}
