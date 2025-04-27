/**
 * insights/NBAgraphs.js
 * Fetches the last N valid games and always returns either
 *   • { line, direction, games: [...] }
 *   • { error: string }
 * so the frontend can render a bar chart and threshold marker.
 */
import { createClient } from "@supabase/supabase-js";
import { normalizeDirection } from "../utils/normalizeDirection.js";

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * @param {Object} params
 * @param {number} params.playerId       - ID of the player
 * @param {string} params.statType       - e.g. "pts", "reb", "ast"
 * @param {number|string} params.line    - User’s entered betting line
 * @param {string} [params.direction]    - "over" or "under"
 * @param {number} [params.requiredGames=15] - How many valid games to fetch
 * @returns {Promise<{line:number,direction:string,games:Object[]}|{error:string}>}
 */
export async function fetchLastValidGames({
  playerId,
  statType,
  line,
  direction = "over",
  requiredGames = 15,
}) {
  try {
    const lineVal = parseFloat(line);
    const dir     = normalizeDirection(direction);

    // Fetch exactly N games where player logged ≥1 minute and stat exists
    const { data, error } = await supabase
      .from("player_stats")
      .select(`game_id, game_date, min, ${statType}`)
      .eq("player_id", playerId)
      .neq("min", "00")               // drop zero-minute games
      .not(`${statType}`, "is", null) // drop games without the stat
      .order("game_date", { ascending: false })
      .limit(requiredGames);

    if (error) {
      console.error("❌ Supabase error in fetchLastValidGames:", error.message);
      return { error: error.message };
    }

    const games = (data || []).map((g) => {
      const minutes  = parseInt(g.min, 10);
      const statValue = g[statType];
      const result    = dir === "under"
        ? (statValue < lineVal ? "Hit" : "Miss")
        : (statValue >= lineVal ? "Hit" : "Miss");

      return {
        gameId:    g.game_id,
        gameDate:  g.game_date,
        minutes,
        statValue,
        result,
      };
    });

    return { line: lineVal, direction: dir, games };
  } catch (e) {
    console.error("💥 Unhandled error in fetchLastValidGames:", e);
    return { error: e.message };
  }
}

// Alias so any existing imports of getRecentGamePerformance continue to work:
export const getRecentGamePerformance = fetchLastValidGames;
