const { getMostRecentSeason } = require("../utils/getMostRecentSeason.js");

const MINUTES_FLOOR = 2;

async function getSeasonVsLast3({ playerId, statType, playerLastName, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId)
      .not(statType, "is", null)
      .not("min", "is", null)
      .gte("min", MINUTES_FLOOR)
      .order("game_date", { ascending: false });

    if (error) return { error: error.message };
    if (!data?.length) return { error: "No valid games found for player." };

    const currGames = data.filter((g) => g.game_season === currentSeason);
    const prevGames = data.filter((g) => g.game_season === previousSeason);

    const seasonSource = currGames.length ? "current" : "last";
    const seasonYear = seasonSource === "current" ? currentSeason : previousSeason;

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

    const last3Pool =
      currGames.length >= 3
        ? currGames.slice(0, 3)
        : [...currGames, ...prevGames].slice(0, 3);

    const last3Avg = +(
      last3Pool.reduce((s, g) => s + g[statType], 0) / last3Pool.length
    ).toFixed(1);

    const diff = +(last3Avg - seasonAvg).toFixed(1);
    let explanation;

    if (seasonSource === "last") {
      explanation = `${playerLastName} hasn’t played yet this season. He averaged **${seasonAvg} ${statType.toUpperCase()}** last year, and **${last3Avg}** over his last 3 games.`;
    } else if (currGames.length < 3) {
      explanation = `${playerLastName} has only played ${currGames.length} game${currGames.length === 1 ? "" : "s"} this season. Over his last 3 games (including last year), he's averaging **${last3Avg} ${statType.toUpperCase()}**, compared to a season average of **${seasonAvg}**.`;
    } else {
      explanation =
        diff > 0
          ? `${playerLastName} is averaging **${last3Avg} ${statType.toUpperCase()}** over his last 3 games — **${diff} more** than his season average of ${seasonAvg}.`
          : diff < 0
          ? `${playerLastName} is averaging **${last3Avg} ${statType.toUpperCase()}** over his last 3 games — **${Math.abs(diff)} less** than his season average of ${seasonAvg}.`
          : `${playerLastName} is averaging **${last3Avg} ${statType.toUpperCase()}** over his last 3 games, matching his season average.`;
    }

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
