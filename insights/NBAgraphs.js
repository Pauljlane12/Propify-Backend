/**
 * insights/getRecentGamePerformance.js
 * Fetches game-by-game performance data for a player's recent games (last 5, 10, 15)
 * for a single stat type, filtered by minimum minutes played.
 * Provides data structured for frontend bar chart visualization.
 * Includes season fallback logic.
 * Returns a standardized insight object containing data for multiple game ranges.
 */
import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";
import { normalizeDirection } from "../utils/normalizeDirection.js";

/**
 * Fetches and formats data for recent game performance charts.
 * @param {Object} params - Parameters for data fetching.
 * @param {number} params.playerId - The ID of the player.
 * @param {string} params.statType - The type of statistic (e.g., "pts", "reb", "ast", "blk").
 * @param {number} params.line - The betting line for the prop.
 * @param {string} params.direction - The bet direction ("over" or "under").
 * @param {Object} params.supabase - The Supabase client instance.
 * @param {number[]} [params.gameRanges = [5, 10, 15]] - Array of game counts to provide data for.
 * @returns {Promise<Object>} - A promise that resolves to a standardized insight object
 * containing game data arrays for each requested range in its details.
 */
export async function getRecentGamePerformance({
    playerId,
    statType,
    line,
    direction = "over",
    supabase,
    gameRanges = [5, 10, 15], // Default ranges for the charts
}) {
    const insightId = "recent_game_performance_charts";
    const insightTitle = "Recent Game Performance";
    const lineVal = parseFloat(line);
    const dir = normalizeDirection(direction); // Canonical direction: "over" | "under"

    // --- Configuration ---
    // Fetch enough games to cover the largest requested range, plus a buffer
    const maxGamesToFetch = Math.max(...gameRanges) + 5;
    const minMinutes = 1; // Minimum minutes played for a game to be considered valid

    // --- Determine season to use (Current with fallback) ---
    let seasonToUse;
    let allValidGames = []; // Array to hold valid games from the chosen season
    let usedFallback = false;

    console.log(`📊 ${insightTitle} (Player ${playerId}, Stat ${statType}, Line ${lineVal}, Dir ${dir})`);

    try {
        const currentSeason = await getMostRecentSeason(supabase);
        console.log(`Attempting to fetch from current season: ${currentSeason}`);

        // 1. Attempt to fetch from the current season
        const { data: currentSeasonData, error: currentSeasonError } = await supabase
            .from("player_stats")
            .select(`game_id, game_date, game_season, min, ${statType}`) // Select necessary columns
            .eq("player_id", playerId)
            .eq("game_season", currentSeason)
            .order("game_date", { ascending: false })
            .limit(maxGamesToFetch); // Fetch enough games for the largest range

        if (currentSeasonError) {
            console.error(`❌ Supabase error fetching current season stats for ${insightTitle}:`, currentSeasonError.message);
            // Don't return immediately, try fallback
        } else {
            const currentValid = (currentSeasonData || []).filter((g) => {
                const minutes = parseInt(g.min, 10);
                 // Ensure minutes is a number and >= minMinutes, and the stat value exists
                return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
            });

            if (currentValid.length >= Math.max(...gameRanges)) { // Check if enough games for the largest range
                console.log(`Found ${currentValid.length} valid games in current season ${currentSeason}. Using this season.`);
                seasonToUse = currentSeason;
                allValidGames = currentValid;
                usedFallback = false;
            } else {
                console.log(`Only found ${currentValid.length} valid games in current season ${currentSeason}. Attempting fallback to previous season.`);
                // 2. If not enough games, attempt to fetch from the previous season
                const previousSeason = currentSeason - 1;
                const { data: previousSeasonData, error: previousSeasonError } = await supabase
                    .from("player_stats")
                    .select(`game_id, game_date, game_season, min, ${statType}`) // Select necessary columns
                    .eq("player_id", playerId)
                    .eq("game_season", previousSeason)
                    .order("game_date", { ascending: false })
                    .limit(maxGamesToFetch); // Fetch enough games for the largest range

                if (previousSeasonError) {
                    console.error(`❌ Supabase error fetching previous season stats for ${insightTitle}:`, previousSeasonError.message);
                    // If both fail, use whatever current data was retrieved
                    seasonToUse = currentSeason; // Indicate current season attempt failed
                    allValidGames = currentValid; // Use whatever current valid data was retrieved
                    usedFallback = false; // Fallback attempt failed or not needed
                } else {
                    const previousValid = (previousSeasonData || []).filter((g) => {
                        const minutes = parseInt(g.min, 10);
                        return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
                    });
                     console.log(`Found ${previousValid.length} valid games in previous season ${previousSeason}.`);

                    // Use previous season data, combining with current if necessary to reach maxGamesToFetch (optional, but good for more data)
                    // For simplicity here, just use the previous season data if fallback is needed
                    seasonToUse = previousSeason;
                    allValidGames = previousValid;
                    usedFallback = true;
                }
            }
        }

        // --- Process data for each requested game range ---
        const chartData = {};
        const availableGames = allValidGames.length;

        if (availableGames === 0) {
             console.warn(`⚠️ No valid games found for ${statType} for player ${playerId} in season ${seasonToUse} with >= ${minMinutes} minutes.`);
            // Return an insight object indicating no data
            return {
                id: insightId,
                title: insightTitle,
                value: "N/A",
                context: `No recent game data available for charts (min ${minMinutes} min).`,
                status: "info",
                details: { availableGames: 0, seasonUsed: seasonToUse, minMinutesFilter: minMinutes },
                error: "No valid games found",
            };
        }

        for (const numGames of gameRanges) {
            // Get the last 'numGames' from the available valid games
            const gamesForRange = allValidGames.slice(0, numGames);

            // Format data for the chart for this range
            chartData[`last${numGames}Games`] = gamesForRange.map(game => {
                const statValue = game[statType];
                const result = dir === "under"
                    ? (statValue < lineVal ? 'Hit' : 'Miss')
                    : (statValue >= lineVal ? 'Hit' : 'Miss');

                return {
                    gameDate: game.game_date,
                    statValue: statValue,
                    minutes: parseInt(game.min, 10),
                    result: result, // 'Hit' or 'Miss'
                    line: lineVal,
                    direction: dir,
                    season: game.game_season,
                };
            }).reverse(); // Reverse to show chronologically from left to right on chart

             console.log(`Generated data for last ${numGames} games chart (${gamesForRange.length} games).`);
        }

        // --- Construct context string ---
        let context = `Game-by-game results for recent games (min ${minMinutes} min).`;
         if (usedFallback) {
              context += ` (Using data from the ${seasonToUse} season)`;
         }
         if (availableGames < Math.min(...gameRanges)) {
             context = `Only ${availableGames} valid games available for charts (min ${minMinutes} min).`;
         }


        // --- Return standardized insight object ---
        return {
            id: insightId,
            title: insightTitle,
            value: `${availableGames} games available`, // Value can indicate how many games were found
            context: context,
            status: availableGames > 0 ? "info" : "warning", // Status based on data availability
            details: {
                availableGames: availableGames,
                seasonUsed: seasonToUse,
                minMinutesFilter: minMinutes,
                line: lineVal,
                direction: dir,
                statType: statType,
                chartData: chartData, // Contains objects like { last5Games: [...], last10Games: [...], ... }
            },
        };

    } catch (e) {
        console.error(`Fatal error in ${insightTitle} for player ${playerId}, stat ${statType}:`, e);
        // Return an insight object indicating a fatal error
        return {
            id: insightId,
            title: insightTitle,
            value: "Error",
            context: "Could not load chart data due to an error.",
            status: "danger",
            error: e.message,
        };
    }
}
