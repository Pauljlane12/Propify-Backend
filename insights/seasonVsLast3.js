// insights/seasonVsLast3.js
//--------------------------------------------------------------
// Season‑Avg vs Last‑3 insight (≥2‑minute filter everywhere)
// • seasonAvg is calculated with the same filter, by season
// • 0‑game / 1‑2‑game / 3‑game logic retained
//--------------------------------------------------------------

import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

const MINUTES_FLOOR = 2;

/* Helper: fetch season average with ≥2‑minute filter */
async function fetchSeasonAverage({ supabase, playerId, statType, season }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select(`AVG(${statType})`, { head: false, count: "exact" })
    .eq("player_id", playerId)
    .eq("game_season", season)
    .not(statType, "is", null)
    .not("min", "is", null)
    .filter("min", "regex", "^[0-9]+$")
    .filter("min", "gte", MINUTES_FLOOR);

  if (error || !data?.length) return null;
  const avg = data[0].avg ?? data[0].[`avg(${statType})`]; // Supabase naming quirk
  return avg === null ? null : +(+avg).toFixed(1);
}

export async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason  = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    /* 1️⃣  Pull last 40 games (two seasons) with ≥2‑min filter */
    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId)
      .in("game_season", [currentSeason, previousSeason])
      .not(statType, "is", null)
      .not("min", "is", null)
      .filter("min", "regex", "^[0-9]+$")
      .filter("min", "gte", MINUTES_FLOOR)
      .order("game_date", { ascending: false })
      .limit(40);

    if (error) return { error: error.message };
    if (!data?.length) return { error: "No valid games found for player." };

    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    /* 2️⃣  Season average (same ≥2‑min filter) */
    let seasonSource    = currGames.length ? "current" : "last";
    let seasonAvg =
      (await fetchSeasonAverage({
        supabase,
        playerId,
        statType,
        season: seasonSource === "current" ? currentSeason : previousSeason,
      })) ?? null;

    // Fallback if aggregation somehow returns null
    if (seasonAvg === null) {
      const pool = seasonSource === "current" ? currGames : prevGames;
      seasonAvg =
        +(
          pool.reduce((sum, g) => sum + g[statType], 0) / pool.length
        ).toFixed(1);
    }

    /* 3️⃣  Build last‑3 pool with season‑aware fallback */
    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames.slice(0, 3 - currGames.length)];

    const last3Avg = +(
      last3Pool.reduce((sum, g) => sum + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    /* 4️⃣  Explanation (same wording logic) */
    let explanation;
    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and in his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} game${currGames.length === 1 ? "" : "s"} this season. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, versus a current‑season average of **${seasonAvg}**.`;
    } else {
      const diff = +(last3Avg - seasonAvg).toFixed(1);
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    /* 5️⃣  Return */
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
