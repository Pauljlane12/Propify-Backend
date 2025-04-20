// insights/seasonVsLast3.js  (CommonJS, regular‑season only)

const { getMostRecentSeason } = require("../utils/getMostRecentSeason.js");

const MINUTES_FLOOR = 2;

/* helper: season average, regular–season only */
async function fetchSeasonAverage({ supabase, playerId, statType, season }) {
  const { data, error } = await supabase
    .from("player_stats")
    // inner‑join games; pull only postseason flag
    .select(`AVG(${statType}), games!inner(postseason)`)
    .eq("player_id", playerId)
    .eq("game_season", season)
    .eq("games.postseason", false)   // ← regular season only
    .not(statType, "is", null)
    .not("min", "is", null)
    .gte("min", MINUTES_FLOOR);

  if (error || !data?.length) return null;

  // Supabase returns { avg: "23.4", games: { postseason: false } }
  const key = Object.keys(data[0]).find((k) => k.startsWith("avg"));
  const avg = data[0][key];
  return avg == null ? null : +(+avg).toFixed(1);
}

async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason  = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    /* 1️⃣ recent games – inner‑join games, filter postseason = false */
    const { data, error } = await supabase
      .from("player_stats")
      .select(
        `${statType}, min, game_date, game_season, games!inner(postseason)`
      )
      .eq("player_id", playerId)
      .in("game_season", [currentSeason, previousSeason])
      .eq("games.postseason", false)     // regular season only
      .not(statType, "is", null)
      .not("min", "is", null)
      .gte("min", MINUTES_FLOOR)
      .order("game_date", { ascending: false })
      .limit(40);

    if (error) return { error: error.message };
    if (!data?.length)
      return { error: "No regular‑season games meet the filter." };

    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    /* 2️⃣ season average */
    let seasonSource = currGames.length ? "current" : "last";
    let seasonAvg =
      (await fetchSeasonAverage({
        supabase,
        playerId,
        statType,
        season: seasonSource === "current" ? currentSeason : previousSeason,
      })) ?? null;

    if (seasonAvg === null) {
      const pool = seasonSource === "current" ? currGames : prevGames;
      seasonAvg = +(
        pool.reduce((s, g) => s + g[statType], 0) / pool.length
      ).toFixed(1);
    }

    /* 3️⃣ last‑3 pool */
    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames.slice(0, 3 - currGames.length)];

    const last3Avg = +(
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    /* 4️⃣ explanation */
    const diff = +(last3Avg - seasonAvg).toFixed(1);
    let explanation;
    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and over his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} regular‑season game${currGames.length === 1 ? "" : "s"} this year. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, vs a current‑season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    /* 5️⃣ return */
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
