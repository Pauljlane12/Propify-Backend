/**
 * insights/index.js
 * Orchestrates the fetching and generation of all relevant insights for a given player and stat type.
 * Collects standardized insight objects from individual insight functions.
 * Now accepts and passes player name to insight functions that need it.
 * Includes debug log for playerLastName.
 */
import { getLast10GameHitRate } from "./last10Games.js";
import { getLast10ComboHitRate } from "./getLast10ComboHitRate.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js";

/**
 * Helper to get the last name from a full name string.
 * Defaults to "Player" if the input name is falsy.
 * @param {string} name - The full player name.
 * @returns {string} - The player's last name or "Player".
 */
const getLastName = (name) => {
    if (!name) return "Player"; // Default if name is missing
    const parts = name.trim().split(" ");
    return parts.length > 1 ? parts[parts.length - 1] : name;
};


/**
 * Fetches and compiles all relevant insights for a player and stat type.
 * @param {Object} params - Parameters for insight generation.
 * @param {number} params.playerId - The ID of the player.
 * @param {string} params.playerName - The full name of the player (e.g., "LeBron James").
 * @param {string} params.statType - The type of statistic (e.g., "pts", "reb", "ast", "blk").
 * @param {string[]} params.statColumns - Array of columns for combo stats (e.g., ["pts", "reb", "ast"] for PRA).
 * @param {number} params.line - The betting line for the prop.
 * @param {string} params.direction - The bet direction ("over" or "under").
 * @param {number} params.teamId - The player's team ID.
 * @param {number} params.opponentTeamId - The opponent team ID for the next game.
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
    const insightsArray = [];

    // Get the last name using the helper
    const playerLastName = getLastName(playerName);
    console.log(`🔍 getInsightsForStat: Determined playerLastName as "${playerLastName}" from playerName "${playerName}"`); // <<-- NEW DEBUG LOG

    // --- Core Insights (Applicable to most/all stat types) ---

    // 1. Last 10 Games Hit Rate (Uses either single or combo script based on statColumns)
    if (statColumns && statColumns.length > 1) {
         // It's a combo stat (e.g., PRA, PR, PA)
         const comboInsight = await getLast10ComboHitRate({
             playerId,
             playerLastName, // Pass last name
             statColumns,
             line,
             direction,
             supabase,
         });
         if (comboInsight) insightsArray.push(comboInsight);

    } else {
        // It's a single stat (e.g., PTS, REB, AST, BLK)
        const singleInsight = await getLast10GameHitRate({
            playerId,
            playerLastName, // Pass last name
            statType,
            line,
            direction,
            supabase,
        });
         if (singleInsight) insightsArray.push(singleInsight);
    }


    // 2. Season Average vs Last 3 Games
    // Assuming getSeasonVsLast3 is updated to return standardized object and accept playerLastName
    const seasonVsLast3Insight = await getSeasonVsLast3({
        playerId,
        playerLastName, // Pass last name if needed for its context string
        statType,
        supabase,
    });
    if (seasonVsLast3Insight) insightsArray.push(seasonVsLast3Insight);


    // 3. Positional Defense vs Opponent
    // Assuming getDefenseVsPosition is updated to return standardized object and accept playerLastName
    const positionalDefenseInsight = await getDefenseVsPosition({
        playerId,
        playerLastName, // Pass last name if needed
        statType,
        teamId,
        opponentTeamId,
        supabase,
    });
    if (positionalDefenseInsight) insightsArray.push(positionalDefenseInsight);


    // 4. Matchup History vs Opponent
    // Assuming getMatchupHistory is updated to return standardized object and accept playerLastName
    const matchupHistoryInsight = await getMatchupHistory({
        playerId,
        playerLastName, // Pass last name if needed
        opponentTeamId,
        statType,
        bettingLine: line,
        direction,
        supabase,
    });
     if (matchupHistoryInsight) insightsArray.push(matchupHistoryInsight);


    // 5. Home vs Away Split
    // Assuming getHomeAwaySplit is updated to return standardized object and accept playerLastName
    const homeAwayInsight = await getHomeAwaySplit({
        playerId,
        playerLastName, // Pass last name if needed
        teamId,
        statType,
        supabase,
    });
    if (homeAwayInsight) insightsArray.push(homeAwayInsight);


    // 6. Rest Day Performance
    // Assuming getRestDayPerformance is updated to return standardized object and accept playerLastName
     const restDayInsight = await getRestDayPerformance({
         playerId,
         playerLastName, // Pass last name if needed
         teamId,
         statType,
         supabase,
     });
     if (restDayInsight) insightsArray.push(restDayInsight);


    // --- Advanced Metrics (May apply to specific props or all) ---

    // 7. Projected Game Pace vs League Average (Applies to all props)
    // Assuming getProjectedGamePace is updated to return standardized object and accept playerLastName
    const gamePaceInsight = await getProjectedGamePace({
        playerLastName, // Pass last name if needed for context
        teamId,
        opponentTeamId,
        supabase,
    });
    if (gamePaceInsight) insightsArray.push(gamePaceInsight);


    // 8. Opponent Pace Rank (Applies to all props)
    // Assuming getTeamPaceRank is updated to return standardized object and accept playerLastName
    const opponentPaceRankInsight = await getTeamPaceRank({
        playerLastName, // Pass last name if needed for context
        opponentTeamId,
        supabase,
    });
    if (opponentPaceRankInsight) insightsArray.push(opponentPaceRankInsight);


    // --- Stat-Specific Advanced Insights ---

    // 9. Rebound-specific advanced insight (Opponent FG % Last 3)
    if (statType === "reb" || (statColumns && statColumns.includes("reb"))) {
        // Assuming getOpponentFgPercentLast3 is updated to return standardized object and accept playerLastName
        const opponentFgInsight = await getOpponentFgPercentLast3({
            playerLastName, // Pass last name if needed
            opponentTeamId,
            supabase,
        });
        if (opponentFgInsight) insightsArray.push(opponentFgInsight);
    }

    // 10. Points-specific advanced insight (FGA Trend Last 3)
    if (statType === "pts" || (statColumns && statColumns.includes("pts"))) {
        // Assuming getFgaTrendLast3 is updated to return standardized object and accept playerLastName
        const fgaTrendInsight = await getFgaTrendLast3({
            playerId,
            playerLastName, // Pass last name
            supabase,
        });
        if (fgaTrendInsight) insightsArray.push(fgaTrendInsight);
    }

    // Add more stat-specific insights here as you create them...
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
