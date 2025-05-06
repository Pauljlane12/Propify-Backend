/**
 * insights/getPaceAdjustedPerformance.js
 * Calculates a player's average performance (stat type) against teams
 * with a similar pace profile to the opponent, with season fallback.
 * Uses data from the most recent season with enough games, falling back
 * to the previous season if necessary.
 * Returns a standardized insight object.
 * Includes detailed logs showing games used for calculation.
 */
import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";
// Assuming you have a utility to get player position if needed for filtering pace profiles by position
// import { getPlayerPosition } from "../utils/getPlayerPosition.js";

export async function getPaceAdjustedPerformance({
    playerId,
    playerLastName = "Player", // Accept playerLastName for context string
    opponentTeamId,
    statType, // e.g., "pts", "reb", "ast", "pras"
    supabase,
}) {
    const insightId = "pace_adjusted_performance";
    const insightTitle = "Pace Adjusted Performance";
    const isComboStat = ["pras", "pr", "pa", "ra"].includes(statType.toLowerCase()); // Check if it's a combo stat
    let statColumns = [statType]; // Default to single stat column
    // Note: You'll need a more robust way to map combo statType strings to actual column names if the split isn't 1:1 (e.g. 'pr' -> ['pts', 'reb'])
    // For now, adding specific mappings for known combos
    if (statType.toLowerCase() === 'pr') statColumns = ['pts', 'reb'];
    else if (statType.toLowerCase() === 'pa') statColumns = ['pts', 'ast'];
    else if (statType.toLowerCase() === 'ra') statColumns = ['reb', 'ast'];
    else if (statType.toLowerCase() === 'pras') statColumns = ['pts', 'reb', 'ast'];


    // --- Configuration ---
    const minMinutes = 1; // Minimum minutes played for a game to be considered valid
    const minGamesForAverage = 5; // Minimum games against similar pace teams to calculate an average

    try {
        const currentSeason = await getMostRecentSeason(supabase);
        const previousSeason = currentSeason - 1;

        console.log(`📊 ${insightTitle} (Player ${playerId}, Stat ${statType}, Opponent ${opponentTeamId})`);
        console.log(`Attempting to calculate pace-adjusted performance for season ${currentSeason} with fallback to ${previousSeason}.`);


        // 1. Get opponent pace bucket for relevant seasons (current and previous)
        const { data: opponentPaceData, error: opponentPaceError } = await supabase
            .from("team_pace_profiles")
            .select("season, pace_bucket")
            .eq("team_id", opponentTeamId)
            .in("season", [currentSeason, previousSeason]); // Get pace for both seasons

        if (opponentPaceError) {
            console.error(`❌ Supabase error fetching opponent pace profiles:`, opponentPaceError.message);
            return {
                 id: insightId,
                 title: insightTitle,
                 value: "Error",
                 context: "Could not fetch opponent pace data.",
                 status: "danger",
                 error: opponentPaceError.message,
            };
        }

        const currentOpponentPaceBucket = opponentPaceData?.find(p => p.season === currentSeason)?.pace_bucket;
        const previousOpponentPaceBucket = opponentPaceData?.find(p => p.season === previousSeason)?.pace_bucket;

        if (!currentOpponentPaceBucket && !previousOpponentPaceBucket) {
             console.warn(`⚠️ No pace profile found for opponent team ${opponentTeamId} in recent seasons ${[currentSeason, previousSeason].join(', ')}.`);
             return {
                 id: insightId,
                 title: insightTitle,
                 value: "N/A",
                 context: "No pace profile found for opponent in recent seasons.",
                 status: "info",
                 details: { opponentTeamId, seasonsChecked: [currentSeason, previousSeason] },
             };
        }

        // 2. Get teams in similar pace buckets for relevant seasons
        const { data: paceTeamsData, error: paceTeamsError } = await supabase
            .from("team_pace_profiles")
            .select("team_id, season, team_abbreviation") // Also get abbreviation for logging
            .in("pace_bucket", [currentOpponentPaceBucket, previousOpponentPaceBucket].filter(Boolean)) // Filter out null buckets
            .in("season", [currentSeason, previousSeason]); // Get teams from both seasons

        if (paceTeamsError || !paceTeamsData?.length) {
             console.warn(`⚠️ No similar pace teams found for buckets ${[currentOpponentPaceBucket, previousOpponentPaceBucket].filter(Boolean).join(', ')} in seasons ${[currentSeason, previousSeason].join(', ')}.`);
             return {
                 id: insightId,
                 title: insightTitle,
                 value: "N/A",
                 context: "No similar paced teams found in recent seasons.",
                 status: "info",
                 details: { opponentTeamId, seasonsChecked: [currentSeason, previousSeason] },
             };
        }

        // Create maps of similar pace team IDs and abbreviations by season
        const similarPaceTeamsCurrent = paceTeamsData.filter(t => t.season === currentSeason);
        const similarPaceTeamIdsCurrent = similarPaceTeamsCurrent.map(t => t.team_id);
        const similarPaceTeamsPrevious = paceTeamsData.filter(t => t.season === previousSeason);
        const similarPaceTeamIdsPrevious = similarPaceTeamsPrevious.map(t => t.team_id);

        console.log(`Similar pace teams in ${currentSeason}:`, similarPaceTeamsCurrent.map(t => t.team_abbreviation).join(', ') || 'None');
        console.log(`Similar pace teams in ${previousSeason}:`, similarPaceTeamsPrevious.map(t => t.team_abbreviation).join(', ') || 'None');


        // 3. Fetch player_stats with minutes across relevant seasons
        const columnsToSelect = isComboStat ? [...statColumns, "min", "game_id", "team_id"] : [statType, "min", "game_id", "team_id"];
        const { data: statsData, error: statsError } = await supabase
            .from("player_stats")
            .select(columnsToSelect.join(',')) // Select necessary columns dynamically
            .eq("player_id", playerId)
            .in("game_season", [currentSeason, previousSeason]) // Fetch from both seasons
            .not("min", "is", null)
            .gt("min", 0); // Filter for minutes > 0 (or >= minMinutes if you prefer)


        if (statsError || !statsData?.length) {
             console.warn("⚠️ No valid player stat data found in recent seasons.");
             return {
                 id: insightId,
                 title: insightTitle,
                 value: "N/A",
                 context: `No valid game data found for ${playerLastName} in recent seasons.`,
                 status: "info",
                 details: { playerId, seasonsChecked: [currentSeason, previousSeason] },
             };
        }

        // 4. Get game metadata to infer opponent and season for each stat entry
        const gameIds = statsData.map(g => g.game_id);
        const { data: gamesData, error: gamesError } = await supabase
            .from("games")
            .select("id, home_team_id, visitor_team_id, season, home_team_abbreviation, visitor_team_abbreviation, date") // Added team abbreviations and date
            .in("id", gameIds);

        if (gamesError) {
            console.error("❌ Supabase error fetching game data:", gamesError.message);
             return {
                 id: insightId,
                 title: insightTitle,
                 value: "Error",
                 context: "Could not fetch game data.",
                 status: "danger",
                 error: gamesError.message,
            };
        }

        // 5. Merge stats and game info, filtering for valid minutes and stat values
        const mergedValidGames = statsData.map(g => {
            const game = gamesData.find(row => row.id === g.game_id);
            if (!game) return null; // Skip if game data not found

             const minutes = parseInt(g.min, 10);
             // Ensure minutes is a number and >= minMinutes, and the stat value(s) exist
             const statValuesExist = isComboStat
                 ? statColumns.every(col => g[col] != null)
                 : g[statType] != null;

             if (!isNaN(minutes) && minutes >= minMinutes && statValuesExist) {
                 const opponentId =
                     g.team_id === game.home_team_id ? game.visitor_team_id : game.home_team_id;
                 const opponentAbbr =
                      g.team_id === game.home_team_id ? game.visitor_team_abbreviation : game.home_team_abbreviation;

                 return {
                     ...g, // Include all stat data
                     game_season: game.season, // Use season from games table
                     game_date: game.date, // Include game date
                     opponent_team_id: opponentId,
                     opponent_abbreviation: opponentAbbr, // Include opponent abbreviation
                 };
             }
             return null; // Skip games not meeting criteria
        }).filter(Boolean); // Filter out null entries


        // 6. Separate games by season and filter by similar pace teams for that season
        const currentSeasonPaceGames = mergedValidGames.filter(
             g => g.game_season === currentSeason && similarPaceTeamIdsCurrent.includes(g.opponent_team_id)
        );

        const previousSeasonPaceGames = mergedValidGames.filter(
             g => g.game_season === previousSeason && similarPaceTeamIdsPrevious.includes(g.opponent_team_id)
        );

        console.log(`Found ${currentSeasonPaceGames.length} valid games vs similar pace teams in ${currentSeason}.`);
        console.log(`Found ${previousSeasonPaceGames.length} valid games vs similar pace teams in ${previousSeason}.`);

        // --- Log details of games included in each season's similar pace filter ---
        console.log(`Games vs similar pace teams in ${currentSeason}:`);
        if (currentSeasonPaceGames.length > 0) {
             console.table(currentSeasonPaceGames.map(g => ({
                 game_date: g.game_date,
                 season: g.game_season,
                 opponent: g.opponent_abbreviation,
                 stat_value: isComboStat ? statColumns.reduce((sum, col) => sum + (g[col] ?? 0), 0) : (g[statType] ?? 0),
                 minutes: parseInt(g.min, 10),
             })));
        } else {
             console.log("None.");
        }

         console.log(`Games vs similar pace teams in ${previousSeason}:`);
         if (previousSeasonPaceGames.length > 0) {
             console.table(previousSeasonPaceGames.map(g => ({
                 game_date: g.game_date,
                 season: g.game_season,
                 opponent: g.opponent_abbreviation,
                 stat_value: isComboStat ? statColumns.reduce((sum, col) => sum + (g[col] ?? 0), 0) : (g[statType] ?? 0),
                 minutes: parseInt(g.min, 10),
             })));
         } else {
             console.log("None.");
         }
        // --- End Logging ---


        // 7. Implement Fallback Logic for Aggregation (Similar to SQL COALESCE)
        let finalAverage = null;
        let finalGamesPlayed = 0;
        let sourceSeason = null;
        let context = "";
        let status = "info";

        // Prioritize current season data if enough games
        if (currentSeasonPaceGames.length >= minGamesForAverage) {
            finalAverage = isComboStat
                ? +(currentSeasonPaceGames.reduce((sum, g) => sum + statColumns.reduce((s, col) => s + (g[col] ?? 0), 0), 0) / currentSeasonPaceGames.length).toFixed(2)
                : +(currentSeasonPaceGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) / currentSeasonPaceGames.length).toFixed(2);
            finalGamesPlayed = currentSeasonPaceGames.length;
            sourceSeason = currentSeason;
            context = `Against teams that play at a similar pace to tonight’s opponent, ${playerLastName} is averaging **${finalAverage} ${statType.toUpperCase()}** across **${finalGamesPlayed} games** in ${sourceSeason}.`;
            status = finalGamesPlayed > 0 ? "info" : "warning"; // Adjust status based on games found

        } else if (previousSeasonPaceGames.length >= minGamesForAverage) {
            // Fallback to previous season if current season doesn't have enough games
             console.log(`Not enough games in ${currentSeason} (${currentSeasonPaceGames.length}). Falling back to ${previousSeason}.`);
            finalAverage = isComboStat
                ? +(previousSeasonPaceGames.reduce((sum, g) => sum + statColumns.reduce((s, col) => s + (g[col] ?? 0), 0), 0) / previousSeasonPaceGames.length).toFixed(2)
                : +(previousSeasonPaceGames.reduce((sum, g) => sum + (g[statType] ?? 0), 0) / previousSeasonPaceGames.length).toFixed(2);
            finalGamesPlayed = previousSeasonPaceGames.length;
            sourceSeason = previousSeason;
            context = `Against teams that play at a similar pace to tonight’s opponent, ${playerLastName} is averaging **${finalAverage} ${statType.toUpperCase()}** across **${finalGamesPlayed} games** in ${sourceSeason}. (Using previous season data)`;
             status = finalGamesPlayed > 0 ? "info" : "warning"; // Adjust status based on games found

        } else {
            // Not enough games in either season
             console.warn(`⚠️ Not enough games against similar pace teams (${currentSeasonPaceGames.length} in ${currentSeason}, ${previousSeasonPaceGames.length} in ${previousSeason}) in either ${currentSeason} or ${previousSeason} to meet minimum (${minGamesForAverage}).`);
            context = `Not enough recent game data against similar paced teams to calculate an average.`;
            status = "warning"; // Indicate insufficient data
        }


        // --- Return standardized insight object ---
        if (finalAverage !== null) {
            return {
                id: insightId,
                title: insightTitle,
                value: finalAverage, // Return the numerical average
                context: context,
                status: status,
                details: {
                    average: finalAverage,
                    gamesPlayed: finalGamesPlayed,
                    sourceSeason: sourceSeason,
                    statType: statType,
                    playerLastName: playerLastName,
                    minMinutesFilter: minMinutes,
                    minGamesForAverage: minGamesForAverage,
                    // Include pace buckets and similar team counts for context if needed
                    currentOpponentPaceBucket: currentOpponentPaceBucket,
                    previousOpponentPaceBucket: previousOpponentPaceBucket,
                    similarPaceTeamCountCurrent: similarPaceTeamIdsCurrent.length,
                    similarPaceTeamCountPrevious: similarPaceTeamIdsPrevious.length,
                },
            };
        } else {
             // Return insight object indicating no data if average could not be calculated
             return {
                 id: insightId,
                 title: insightTitle,
                 value: "N/A",
                 context: context, // Context explains why average couldn't be calculated
                 status: status,
                 details: {
                     gamesPlayed: finalGamesPlayed, // Will be 0
                     sourceSeason: null,
                     statType: statType,
                     playerLastName: playerLastName,
                     minMinutesFilter: minMinutes,
                     minGamesForAverage: minGamesForAverage,
                     currentOpponentPaceBucket: currentOpponentPaceBucket,
                     previousOpponentPaceBucket: previousOpponentPaceBucket,
                     similarPaceTeamCountCurrent: similarPaceTeamIdsCurrent.length,
                     similarPaceTeamCountPrevious: similarPaceTeamIdsPrevious.length,
                 },
             };
        }


    } catch (err) {
        console.error(`Fatal error in ${insightTitle} for player ${playerId}, stat ${statType}:`, err);
        // Return an insight object indicating a fatal error
        return {
            id: insightId,
            title: insightTitle,
            value: "Error",
            context: "Could not calculate pace-adjusted performance due to an error.",
            status: "danger",
            error: err.message,
        };
    }
}
