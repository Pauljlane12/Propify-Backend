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
 */
export async function getRecentGamePerformance({
    playerId,
    statType,
    line,
    direction = "over",
    supabase,
    gameRanges = [5, 10, 15],
}) {
    const insightId = "recent_game_performance_charts";
    const insightTitle = "Recent Game Performance";
    const lineVal = parseFloat(line);
    const dir = normalizeDirection(direction);

    const maxGamesToFetch = Math.max(...gameRanges) + 5;
    const minMinutes = 1;

    let seasonToUse;
    let allValidGames = [];
    let usedFallback = false;

    console.log(`📊 ${insightTitle} (Player ${playerId}, Stat ${statType}, Line ${lineVal}, Dir ${dir})`);

    try {
        const currentSeason = await getMostRecentSeason(supabase);
        console.log(`Attempting to fetch from current season: ${currentSeason}`);

        // 1. Fetch current season data
        const { data: currentSeasonData, error: currentSeasonError } = await supabase
            .from("player_stats")
            .select(`game_id, game_date, game_season, min, ${statType}`)
            .eq("player_id", playerId)
            .eq("game_season", currentSeason)
            .order("game_date", { ascending: false })
            .limit(maxGamesToFetch);

        console.log("🔍 currentSeasonData:", currentSeasonData);
        if (currentSeasonError) {
            console.error(`❌ Supabase error fetching current season stats:`, currentSeasonError.message);
        }

        const currentValid = (currentSeasonData || []).filter((g) => {
            const minutes = parseInt(g.min, 10);
            return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
        });
        console.log(`✅ currentValid (${currentValid.length}):`, currentValid);

        if (currentValid.length >= Math.max(...gameRanges)) {
            console.log(`Using current season ${currentSeason} with ${currentValid.length} valid games.`);
            seasonToUse = currentSeason;
            allValidGames = currentValid;
        } else {
            console.log(`Only ${currentValid.length} valid games in ${currentSeason}, falling back.`);
            // 2. Fetch previous season
            const previousSeason = currentSeason - 1;
            const { data: previousSeasonData, error: previousSeasonError } = await supabase
                .from("player_stats")
                .select(`game_id, game_date, game_season, min, ${statType}`)
                .eq("player_id", playerId)
                .eq("game_season", previousSeason)
                .order("game_date", { ascending: false })
                .limit(maxGamesToFetch);

            console.log("🔍 previousSeasonData:", previousSeasonData);
            if (previousSeasonError) {
                console.error(`❌ Supabase error fetching previous season stats:`, previousSeasonError.message);
                seasonToUse = currentSeason;
                allValidGames = currentValid;
            } else {
                const previousValid = (previousSeasonData || []).filter((g) => {
                    const minutes = parseInt(g.min, 10);
                    return !isNaN(minutes) && minutes >= minMinutes && g[statType] != null;
                });
                console.log(`✅ previousValid (${previousValid.length}):`, previousValid);

                seasonToUse = previousSeason;
                allValidGames = previousValid;
                usedFallback = true;
            }
        }

        console.log("🔀 allValidGames:", allValidGames);

        const availableGames = allValidGames.length;
        if (availableGames === 0) {
            console.warn(`⚠️ No valid games found in season ${seasonToUse}.`);
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

        // 3. Build chartData for each range
        const chartData = {};
        for (const numGames of gameRanges) {
            const gamesForRange = allValidGames.slice(0, numGames);
            console.log(`🗂 gamesForRange (last ${numGames}):`, gamesForRange);

            chartData[`last${numGames}Games`] = gamesForRange
                .map(game => {
                    const statValue = game[statType];
                    const result = dir === "under"
                        ? (statValue < lineVal ? 'Hit' : 'Miss')
                        : (statValue >= lineVal ? 'Hit' : 'Miss');

                    return {
                        gameDate: game.game_date,
                        statValue,
                        minutes: parseInt(game.min, 10),
                        result,
                        line: lineVal,
                        direction: dir,
                        season: game.game_season,
                    };
                })
                .reverse();

            console.log(`Generated chartData.last${numGames}Games:`, chartData[`last${numGames}Games`]);
        }

        let context = `Game-by-game results for recent games (min ${minMinutes} min).`;
        if (usedFallback) context += ` (Using ${seasonToUse} season)`;
        if (availableGames < Math.min(...gameRanges)) {
            context = `Only ${availableGames} valid games available for charts (min ${minMinutes} min).`;
        }

        console.log("📦 Final chartData object:", chartData);

        return {
            id: insightId,
            title: insightTitle,
            value: `${availableGames} games available`,
            context,
            status: availableGames > 0 ? "info" : "warning",
            details: {
                availableGames,
                seasonUsed: seasonToUse,
                minMinutesFilter: minMinutes,
                line: lineVal,
                direction: dir,
                statType,
                chartData,
            },
        };

    } catch (e) {
        console.error(`💥 Unhandled error in ${insightTitle}:`, e);
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
