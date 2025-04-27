/**
 * utils/fetchLastValidGames.js
 * Fetches the last N games in which a player logged at least 1 minute,
 * using a single DB‐level filter and limit for maximum efficiency.
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeDirection } from "../utils/normalizeDirection.js";

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Fetches the last `requiredGames` games where the player logged ≥1 minute
 * and the specified stat is not null, ordered most recent first.
 * @param {Object} params
 * @param {number} params.playerId        - ID of the player
 * @param {string} params.statType        - Stat field, e.g. "pts", "reb", "ast"
 * @param {number|string} params.line     - Betting line to compare against
 * @param {string} params.direction       - "over" or "under"
 * @param {number} [params.requiredGames=15] - Number of valid games to fetch
 * @returns {Promise<Object[]>} Array of games:
 *   [{ gameId, gameDate, minutes, statValue, result }, …]
 */
export async function fetchLastValidGames({
  playerId,
  statType,
  line,
  direction = "over",
  requiredGames = 15,
}) {
  const lineVal = parseFloat(line);
  const dir = normalizeDirection(direction);

  // Single query: filter out zero-minute and null-stat rows, then limit
  const { data, error } = await supabase
    .from("player_stats")
    .select(`game_id, game_date, min, ${statType}`)
    .eq("player_id", playerId)
    .neq("min", "00")               // only games with actual minutes played
    .not(`${statType}`, "is", null) // only games where the stat exists
    .order("game_date", { ascending: false })
    .limit(requiredGames);

  if (error) {
    console.error("❌ Supabase error fetching last valid games:", error.message);
    throw error;
  }

  // Map and annotate result
  return (data || []).map((g) => {
    const minutes = parseInt(g.min, 10);
    const statValue = g[statType];

    const result =
      dir === "under"
        ? statValue < lineVal ? "Hit" : "Miss"
        : statValue >= lineVal ? "Hit" : "Miss";

    return {
      gameId:    g.game_id,
      gameDate:  g.game_date,
      minutes,
      statValue,
      result,
    };
  });
}

// Example usage:
// (async () => {
//   const games = await fetchLastValidGames({
//     playerId: 2544,       // LeBron James
//     statType: "pts",
//     line:     25.5,
//     direction: "over",
//     requiredGames: 15
//   });
//   console.table(games);
// })();
