/**
 * insights/last10Games.js
 * Calculates the hit rate for a single stat type over the player's last 10 valid games.
 * Valid games now require at least 1 minute played.
 * Includes fallback to the previous season if not enough games in the current season.
 * Returns standardized insight object with a simplified context string using player's last name.
 */
import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";
import { normalizeDirection } from "../utils/normalizeDirection.js";

// ✅ Supports over / under / more / less / < / > hit‑rate comparison
export async function getLast10GameHitRate({
    playerId,
    playerLastName = "Player", // <<-- NEW: Accept playerLastName, with a default
    statType, // e.g., "pts", "reb", "ast"
    line,
    direction = "over", // whatever comes in
    supabase,
}) {
    const insightId = "last10_single_hit_rate";
    const insightTitle = "Last 10 Games Hit Rate";
    const lineVal = parseFloat(line);
    const dir = normalizeDirection(direction); // Canonical direction: "over" | "under"

    // --- Configuration ---
    const requiredGames = 10; // Number of recent games to consider
    const gamesToFetch = 20; // Fetch more than needed in case some get filtered out
    const minMinutes = 1; // Minimum minutes played for a game to be considered valid

    // --- Determine season to use (Current with fallback) ---
    let seasonToUse;
    let gamesData = [];
    let validGames = [];
    let usedFallback = false; // Flag to indicate if fallback was used


    try {
        const currentSeason = await getMostRecentSeason(supabase);
        console.log(`📊 ${insightTitle} (Player ${playerId}, Stat ${statType}, Line ${lineVal}, Dir ${dir})`);
        console.log(`Attempting to fetch from current season: ${currentSeason}`);

        // 1. Attempt to fetch from the current season
        const { data: currentSeasonData, error: currentSeasonError } = await supabase
            .from("player_stats")
            .select(`min, game_date, game_season, ${statType}`) // Select only necessary columns
            .eq("player_id", playerId)
            .eq("game_season", currentSeason)
            .order("game_date", { ascending: false })
            .limit(gamesToFetch);

        if (currentSeasonError) {
            console.error(`❌ Supabase error fetching current season stats for ${insightTitle}:`, currentSeasonError.message);
            // Don't return immediately, try fallback if possible
        } else {
            const currentValid = (currentSeasonData || []).filter((g) => {
                const minutes = parseInt(g.min, 10);
                // Ensure minutes is a number and >= minMinutes, and the stat value exists
                return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
            });

            if (currentValid.length >= requiredGames) {
                console.log(`Found ${currentValid.length} valid games in current season ${currentSeason}. Using this season.`);
                seasonToUse = currentSeason;
                gamesData = currentSeasonData; // Use raw data for potential future filters
                validGames = currentValid; // Use filtered valid games
                usedFallback = false;
            } else {
                console.log(`Only found ${currentValid.length} valid games in current season ${currentSeason}. Attempting fallback to previous season.`);
                // 2. If not enough games, attempt to fetch from the previous season
                const previousSeason = currentSeason - 1;
                const { data: previousSeasonData, error: previousSeasonError } = await supabase
                    .from("player_stats")
                    .select(`min, game_date, game_season, ${statType}`) // Select only necessary columns
                    .eq("player_id", playerId)
                    .eq("game_season", previousSeason)
                    .order("game_date", { ascending: false })
                    .limit(gamesToFetch);

                if (previousSeasonError) {
                    console.error(`❌ Supabase error fetching previous season stats for ${insightTitle}:`, previousSeasonError.message);
                    // If both fail, proceed with whatever data was fetched (might be empty)
                    seasonToUse = currentSeason; // Indicate current season attempt failed
                    gamesData = currentSeasonData || []; // Use whatever current data was retrieved
                    validGames = currentValid; // Use whatever current valid data was retrieved
                    usedFallback = false; // Fallback attempt failed or not needed
                } else {
                    const previousValid = (previousSeasonData || []).filter((g) => {
                        const minutes = parseInt(g.min, 10);
                        return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
                    });
                     console.log(`Found ${previousValid.length} valid games in previous season ${previousSeason}.`);

                    // Use previous season data, regardless of how many valid games found (as per original combo logic)
                    seasonToUse = previousSeason;
                    gamesData = previousSeasonData; // Use raw data
                    validGames = previousValid; // Use filtered valid games
                    usedFallback = true; // Fallback was used
                }
            }
        }

        // --- Process the selected season's data ---
        const lastXGames = validGames.slice(0, requiredGames); // Get the required number of games

        if (lastXGames.length === 0) {
             console.warn(`⚠️ No valid games found for ${statType} for player ${playerId} in season ${seasonToUse} with >= ${minMinutes} minutes.`);
            // Return an insight object indicating no data
            return {
                id: insightId,
                title: insightTitle,
                value: "N/A",
                context: `${playerLastName} has no valid games found for ${statType} in the ${seasonToUse} season with at least ${minMinutes} minute played.`, // Updated context
                status: "info",
                details: { totalGames: 0, seasonUsed: seasonToUse, minMinutesFilter: minMinutes },
                error: "No valid games found",
            };
        }

        const hitCount = lastXGames.filter((g) =>
            dir === "under" ? g[statType] < lineVal : g[statType] >= lineVal
        ).length;

        const hitRate = +(hitCount / lastXGames.length).toFixed(2); // Calculate hit rate

        // --- Determine status based on hit rate ---
        let status = "info";
        if (hitRate >= 0.7) { // Example thresholds - adjust as needed
            status = "success";
        } else if (hitRate <= 0.3) {
            status = "danger";
        } else if (hitRate > 0.3 && hitRate < 0.7) {
            status = "warning";
        }


        // --- Construct context string (Simplified) ---
        // Example: "Cunningham has gone UNDER 28.5 in 5 of his last 10 games."
        let context = `${playerLastName} has gone ${dir.toUpperCase()} ${lineVal} in ${hitCount} of his last ${lastXGames.length} games.`;

        // You could optionally add a note about the season if fallback was used:
        // if (usedFallback) {
        //      context += ` (Using ${seasonToUse} data)`;
        // }


        // --- Debug logging ---
        console.log(`✅ ${insightTitle} Result: Hit Rate = ${hitRate}, Games = ${lastXGames.length}, Season = ${seasonToUse}, Min Minutes Filter = ${minMinutes}`);
        console.table(
            lastXGames.map((g) => ({
                game_date: g.game_date,
                season: g.game_season,
                stat: g[statType],
                min: g.min,
                hit: dir === "under" ? g[statType] < lineVal : g[statType] >= lineVal,
            }))
        );

        // --- Return standardized insight object ---
        return {
            id: insightId,
            title: insightTitle,
            value: `${(hitRate * 100).toFixed(0)}%`, // Display as percentage
            context: context, // Use the simplified context
            status: status,
            details: {
                hitRate: hitRate,
                hitCount: hitCount,
                totalGames: lastXGames.length,
                seasonUsed: seasonToUse,
                line: lineVal,
                direction: dir,
                statType: statType,
                minMinutesFilter: minMinutes,
                playerLastName: playerLastName, // Include last name in details too
            },
        };

    } catch (e) {
        console.error(`Fatal error in ${insightTitle} for player ${playerId}, stat ${statType}:`, e);
        // Return an insight object indicating a fatal error
        return {
            id: insightId,
            title: insightTitle,
            value: "Error",
            context: "Could not calculate insight due to an error.",
            status: "danger",
            error: e.message,
        };
    }
}
