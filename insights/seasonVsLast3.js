// insights/seasonVsLast3.js
//--------------------------------------------------------------
// Season‑Average vs Last‑3 insight (future‑proofed version)
// • seasonAvg comes from season_averages (fast).
// • fallback to on‑the‑fly calculation if the row is missing.
// • Last‑3 logic:   0 games, 1‑2 games, or ≥3 games in curr season.
// • Uses 2‑minute floor for valid games.
//--------------------------------------------------------------

import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

const MINUTES_FLOOR = 2;           // ← changed from 10 ➜ 2

export async function getSeasonVsLast3({
  playerId,
  statType,           // e.g. "pts", "reb", "pra"
  supabase,
}) {
  try {
    /* 1️⃣  Get current/previous season values */
    const currentSeason   = await getMostRecentSeason(supabase);
    const previousSeason  = currentSeason - 1;

    /* 2️⃣  Fetch current + previous season rows (max 40) */
    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId)
      .in("game_season", [currentSeason, previousSeason])
      .order("game_date", { ascending: false })
      .limit(40);

    if (error) return { error: error.message };

    /* 3️⃣  Filter to ≥ 2‑min games */
    const valid = (data || []).filter((g) => {
      const mins = parseInt(g.min, 10);
      return !isNaN(mins) && mins >= MINUTES_FLOOR && g[statType] != null;
    });
    if (!valid.length) return { error: "No valid games found for player." };

    /* 4️⃣  Split games by season */
    const currGames = valid.filter((g) => g.game_season === currentSeason);
    const prevGames = valid.filter((g) => g.game_season === previousSeason);

    /* 5️⃣  Grab seasonAvg from season_averages table first */
    async function readSeasonAverage(season) {
      const { data: row, error: err } = await supabase
        .from("season_averages")
        .select(statType)
        .eq("player_id", playerId)
        .eq("season", season)
        .single();
      return err || !row ? null : row[statType];
    }

    let seasonSource     = currGames.length ? "current" : "last";
    let seasonAvgNumeric =
      (await readSeasonAverage(
        seasonSource === "current" ? currentSeason : previousSeason
      )) ?? null;

    /* Fallback if the season_averages row doesn't exist yet */
    if (seasonAvgNumeric === null) {
      const pool = seasonSource === "current" ? currGames : prevGames;
      seasonAvgNumeric =
        pool.reduce((s, g) => s + g[statType], 0) / pool.length;
    }

    /* 6️⃣  Build last‑3 pool */
    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames.slice(0, 3 - currGames.length)];

    const last3AvgNumeric =
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length;

    /* 7️⃣  Helpers */
    const round = (n) => +n.toFixed(1);
    const seasonAvg = round(seasonAvgNumeric);
    const last3Avg  = round(last3AvgNumeric);
    const diff      = round(last3Avg - seasonAvg);

    /* 8️⃣  Explanation */
    let explanation;
    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and in his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} game${currGames.length === 1 ? "" : "s"} this season. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, vs a current‑season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    /* 9️⃣  Return clean insight */
    return {
      statType,
      seasonAvg,
      last3Avg,
      last3Games: last3Pool.map((g) => ({
        date: g.game_date,
        value: g[statType],
        season: g.game_season,
      })),
      seasonGames: seasonSource === "current" ? currGames.length : 0,
      explanation,
    };
  } catch (err) {
    return { error: err.message };
  }
}
