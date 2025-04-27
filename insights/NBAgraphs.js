/**
 * insights/NBAgraphs.js
 * Provides a single‐query helper to fetch a player’s last N valid games,
 * and exports it under both names so your orchestrator doesn’t break.
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

  const { data, error } = await supabase
    .from("player_stats")
    .select(`game_id, game_date, min, ${statType}`)
    .eq("player_id", playerId)
    .neq("min", "00")              // only games with real minutes
    .not(`${statType}`, "is", null)// only games where the stat exists
    .order("game_date", { ascending: false })
    .limit(requiredGames);

  if (error) {
    console.error("❌ Supabase error in fetchLastValidGames:", error.message);
    throw error;
  }

  return (data || []).map((g) => {
    const minutes  = parseInt(g.min, 10);
    const statValue = g[statType];
    const result = dir === "under"
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
}

// ─────────────────────────────────────────────────────────────────
// Alias for backwards‐compatibility: anything still importing
// getRecentGamePerformance will now get fetchLastValidGames
export const getRecentGamePerformance = fetchLastValidGames;
