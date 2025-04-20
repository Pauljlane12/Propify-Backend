// insights/seasonVsLast3.js
// --------------------------------------------------------------
// Season‑Average vs Last‑3 insight (regular season only)
// • Excludes playoff games with games.postseason = FALSE
// • ≥2‑minute filter everywhere
// • Future‑proof: 0‑game / 1‑2‑game / 3‑game transition
// • CommonJS  (require / module.exports)
// --------------------------------------------------------------

const { getMostRecentSeason } = require("../utils/getMostRecentSeason.js");

const MINUTES_FLOOR = 2;

/* Helper: average for one season (regular season, ≥2 min) */
async function fetchSeasonAverage({ supabase, playerId, statType, season }) {
  const { data, error } = await supabase
    .from("player_stats")
    .select(`AVG(${statType})`)
    .eq("player_id", playerId)
    .eq("game_season", season)
    .eq("games.postseason", false)   // exclude playoffs
    .not(statType, "is", null)
    .not("min", "is", null)
    .gte("min", MINUTES_FLOOR)
    .join("games", "game_id", "games.id");

  if (error || !data?.length) return null;
  const key = Object.keys(data[0])[0]; // "avg" or "avg(pts)"
  const avg = data[0][key];
  return avg == null ? null : +(+avg).toFixed(1);
}

async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason  = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    /* 1️⃣  Fetch recent games (40 max) — regular season only */
    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId)
      .in("game_season", [currentSeason, previousSeason])
      .eq("games.postseason", false)      // exclude playoffs
      .not(statType, "is", null)
      .not("min", "is", null)
      .gte("min", MINUTES_FLOOR)
      .order("game_date", { ascending: false })
      .limit(40)
      .join("games", "game_id", "games.id");

    if (error) return { error: error.message };
    if (!data?.length) return { error: "No valid regular‑season games found." };

    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    /* 2️⃣  Season average (regular season only) */
    let seasonSource = currGames.length ? "current" : "last";
    let seasonAvg =
      (await fetchSeasonAverage({
        supabase,
        playerId,
        statType,
        season: seasonSource === "current" ? currentSeason : previousSeason,
      })) ?? null;

    // Fallback if aggregation missing
    if (seasonAvg === null) {
      const pool = seasonSource === "current" ? currGames : prevGames;
      seasonAvg = +(
        pool.reduce((s, g) => s + g[statType], 0) / pool.length
      ).toFixed(1);
    }

    /* 3️⃣  Build last‑3 pool (mix prev games if needed) */
    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames.slice(0, 3 - currGames.length)];

    const last3Avg = +(
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    /* 4️⃣  Explanation */
    const diff = +(last3Avg - seasonAvg).toFixed(1);
    let explanation;

    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and in his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} regular‑season game${currGames.length === 1 ? "" : "s"} this season. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, versus a current‑season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    /* 5️⃣  Return insight */
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

module.exports = { getSeasonVsLast3 };
