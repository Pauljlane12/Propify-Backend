import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";
import { normalizeDirection } from "../utils/normalizeDirection.js";  // 🆕 new helper

// ✅ Supports over / under / more / less / < / > hit‑rate comparison
export async function getLast10GameHitRate({
  playerId,
  statType,
  line,
  direction = "over",   // whatever comes in
  supabase,
}) {
  // ── season‑smart fetch (unchanged) ───────────────────────────────
  const currentSeason = await getMostRecentSeason(supabase);

  const { data, error } = await supabase
    .from("player_stats")
    .select(
      "min, game_date, pts, reb, ast, fg3m, fg3a, fga, ftm, fgm, oreb, dreb, stl, blk, turnover, game_season"
    )
    .eq("player_id", playerId)
    .eq("game_season", currentSeason)
    .order("game_date", { ascending: false })
    .limit(20); // grab a few extras in case some get filtered out

  if (error) {
    console.error("❌ Supabase error fetching player stats:", error.message);
    return { error: error.message };
  }

  // ── filter valid games (unchanged) ───────────────────────────────
  const valid = (data || []).filter((g) => {
    const minutes = parseInt(g.min, 10);
    const statValue = g[statType];
    return (
      !isNaN(minutes) &&
      minutes >= 10 &&
      statValue !== null &&
      statValue !== undefined
    );
  });

  const last10   = valid.slice(0, 10);
  const lineVal  = parseFloat(line);

  // ── NEW: canonical direction = "over" | "under" ─────────────────
  const dir = normalizeDirection(direction);

  const hitCount = last10.filter((g) =>
    dir === "under" ? g[statType] < lineVal : g[statType] >= lineVal
  ).length;

  // ── debug (kept) ────────────────────────────────────────────────
  console.log("📊 getLast10GameHitRate");
  console.log("▶ statType:", statType);
  console.log("▶ line:", lineVal);
  console.log("▶ direction:", dir);
  console.log("▶ playerId:", playerId);
  console.table(
    last10.map((g) => ({
      game_date: g.game_date,
      stat: g[statType],
      min: g.min,
      hit: dir === "under" ? g[statType] < lineVal : g[statType] >= lineVal,
    }))
  );

  // ── return (unchanged) ──────────────────────────────────────────
  return {
    hitRate: last10.length ? +(hitCount / last10.length).toFixed(2) : null,
    hitCount,
    totalGames: last10.length,
  };
}
