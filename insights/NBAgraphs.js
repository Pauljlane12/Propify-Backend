/**
 * insights/NBAgraphs.js
 * Fetches the last N valid games and always returns either
 * an array of games or an { error } object.
 */
import { createClient } from "@supabase/supabase-js";
import { normalizeDirection } from "../utils/normalizeDirection.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // DB‐level filtering + limit
    const { data, error } = await supabase
      .from("player_stats")
      .select(`game_id, game_date, min, ${statType}`)
      .eq("player_id", playerId)
      .neq("min", "00")
      .not(`${statType}`, "is", null)
      .order("game_date", { ascending: false })
      .limit(requiredGames);

    if (error) {
      console.error("❌ Supabase error in fetchLastValidGames:", error.message);
      return { error: error.message };
    }

    const games = (data || []).map((g) => {
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

    return { games };
  } catch (e) {
    console.error("💥 Unhandled error in fetchLastValidGames:", e);
    return { error: e.message };
  }
}

// Alias so existing imports still work
export const getRecentGamePerformance = fetchLastValidGames;
