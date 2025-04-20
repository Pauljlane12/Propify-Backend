const { getMostRecentSeason } = require("../utils/getMostRecentSeason.js");

const MINUTES_FLOOR = 2;

/* --------------- helper: all regular‑season game‑IDs for given seasons --------------- */
async function getRegularSeasonGameIds(supabase, seasons) {
  const { data, error } = await supabase
    .from("games")
    .select("id, season")
    .in("season", seasons)
    .eq("postseason", false);

  if (error || !data?.length) return { ids: [], bySeason: {} };

  const ids = [];
  const bySeason = {};

  for (const g of data) {
    ids.push(g.id);
    if (!bySeason[g.season]) bySeason[g.season] = [];
    bySeason[g.season].push(g.id);
  }

  return { ids, bySeason };
}

/* --------------- main insight function --------------- */
async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason  = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    // 🔹 Get all regular-season game IDs for current and previous seasons
    const { ids: allIds, bySeason } = await getRegularSeasonGameIds(
      supabase,
      [currentSeason, previousSeason]
    );
    if (!allIds.length) return { error: "No regular-season games found." };

    // 🔹 Pull player logs from player_stats
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
      return { error: "No valid regular-season games found for player." };

    // 🔹 Separate games by season
    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    // 🔹 Decide season source
    const seasonSource = currGames.length ? "current" : "last";
    const seasonYear   = seasonSource === "current" ? currentSeason : previousSeason;

    // 🔹 Get season average from season_averages table
    const { data: avgData, error: avgError } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", seasonYear)
      .eq("stat_key", statType)
      .maybeSingle();

    if (avgError) return { error: avgError.message };
    if (!avgData) return { error: "No season average found in season_averages table." };

    const seasonAvg = +(+avgData.stat_value).toFixed(1);

    // 🔹 Last 3-game pool (2-minute floor already applied above, sorted DESC)
    const last3Pool = data.slice(0, 3); // top 3 most recent qualifying games

    const last3Avg = +(
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    // 🔹 Build explanation
    const diff = +(last3Avg - seasonAvg).toFixed(1);
    let explanation;

    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season he averaged **${seasonAvg} ${statType}**, and in his last 3 games he averaged **${last3Avg}**.`;
    } else if (currGames.length < 3) {
      explanation = `He's played only ${currGames.length} regular-season game${
        currGames.length === 1 ? "" : "s"
      } this year. Over his last 3 games (some from last season) he averages **${last3Avg} ${statType}**, versus a current-season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `He's averaging **${last3Avg} ${statType}** over his last 3 games — **${Math.abs(
              diff
            )} less** than his season average of ${seasonAvg}.`
          : `He's averaging **${last3Avg} ${statType}** over his last 3 games, matching his season average.`;
    }

    // 🔹 Return structured output
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
