// insights/seasonVsLast3.js  (CommonJS)
// --------------------------------------------------
// Season‑Average vs Last‑3 insight, REGULAR‑SEASON ONLY
// • No FK or join: first fetch game‑IDs, then stats
// • ≥2‑minute filter
// • 0‑game / 1‑2‑game / ≥3‑game logic (future‑proof)
// --------------------------------------------------

const { getMostRecentSeason } = require("../utils/getMostRecentSeason.js");

const MINUTES_FLOOR = 2;

/* Utility: fetch ALL regular‑season game IDs for given seasons */
async function getRegularSeasonGameIds(supabase, seasons) {
  const { data, error } = await supabase
    .from("games")
    .select("id, season")
    .in("season", seasons)
    .eq("postseason", false); // regular season only

  if (error || !data?.length) return { ids: [], bySeason: {} };

  const ids     = data.map((g) => g.id);
  const bySeason = {};
  data.forEach((g) => {
    bySeason[g.season] = (bySeason[g.season] || []).push
      ? bySeason[g.season].push(g.id)
      : (bySeason[g.season] = [g.id]);
  });

  return { ids, bySeason };
}

/* Helper: season‑average with ≥2‑minute filter, regular season only */
async function fetchSeasonAverage({ supabase, playerId, statType, gameIds }) {
  if (!gameIds.length) return null;

  const { data, error } = await supabase
    .from("player_stats")
    .select(`AVG(${statType})`)
    .eq("player_id", playerId)
    .in("game_id", gameIds)
    .not(statType, "is", null)
    .not("min", "is", null)
    .gte("min", MINUTES_FLOOR);

  if (error || !data?.length) return null;

  const key = Object.keys(data[0])[0];          // "avg" or "avg(pts)"
  const avg = data[0][key];
  return avg == null ? null : +(+avg).toFixed(1);
}

async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason  = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    /* 1️⃣  Get all regular‑season game IDs we care about */
    const { ids: allIds, bySeason } = await getRegularSeasonGameIds(
      supabase,
      [currentSeason, previousSeason]
    );
    if (!allIds.length)
      return { error: "No regular‑season games found for player." };

    /* 2️⃣  Pull player_stats for those IDs (≥2 min), newest first */
    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId)
      .in("game_id", allIds)
      .not(statType, "is", null)
      .not("min", "is", null)
      .gte("min", MINUTES_FLOOR)
      .order("game_date", { ascending: false });

    if (error) return { error: error.message };
    if (!data?.length)
      return { error: "No regular‑season games meet the minutes filter." };

    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    /* 3️⃣  Season average */
    const seasonSource = currGames.length ? "current" : "last";
    const seasonGameIds =
      seasonSource === "current" ? bySeason[currentSeason] || [] : bySeason[previousSeason] || [];
    let seasonAvg = await fetchSeasonAverage({
      supabase,
      playerId,
      statType,
      gameIds: seasonGameIds,
    });

    // Fallback if aggregation fails (shouldn't)
    if (seasonAvg === null && seasonGameIds.length) {
      const pool =
        seasonSource === "current" ? currGames : prevGames;
      seasonAvg = +(
        pool.reduce((s, g) => s + g[statType], 0) / pool.length
      ).toFixed(1);
    }

    /* 4️⃣  Last‑3 pool (mix previous season if needed) */
    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames.slice(0, 3 - currGames.length)];

    const last3Avg = +(
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    /* 5️⃣  Explanation */
    const diff = +(last3Avg - seasonAvg).toFixed(1);
    let explanation;

    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and in his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} regular‑season game${currGames.length === 1 ? "" : "s"} this year. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, versus a current‑season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    /* 6️⃣  Return */
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
