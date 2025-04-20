import { getMostRecentSeason } from "./getMostRecentSeason.js";

export async function getSeasonVsLast3({ playerId, statType, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    const { data, error } = await supabase
      .from("player_stats")
      .select(`${statType}, min, game_date, game_season`)
      .eq("player_id", playerId);

    if (error) {
      return { error: error.message };
    }

    const valid = (data || []).filter((g) => {
      const mins = parseInt(g.min, 10);
      return !isNaN(mins) && mins >= 10 && g[statType] != null;
    });

    if (!valid.length) {
      return { error: "No valid games found for player." };
    }

    const currentSeasonGames = valid.filter((g) => g.game_season === currentSeason);
    const lastSeasonGames = valid.filter((g) => g.game_season < currentSeason);

    let seasonSource = "current";
    let seasonAvg = 0;
    let last3Games = [];

    // --- Decide what seasonAvg to use ---
    if (currentSeasonGames.length === 0 && lastSeasonGames.length > 0) {
      seasonSource = "last";
      seasonAvg =
        lastSeasonGames.reduce((acc, cur) => acc + cur[statType], 0) / lastSeasonGames.length;
    } else {
      seasonAvg =
        currentSeasonGames.reduce((acc, cur) => acc + cur[statType], 0) /
        currentSeasonGames.length;
    }

    // --- Sort ALL valid games across both seasons ---
    valid.sort((a, b) => new Date(b.game_date) - new Date(a.game_date));

    // Pull most recent 3 games across all seasons
    last3Games = valid.slice(0, 3);

    const last3Avg =
      last3Games.reduce((acc, cur) => acc + cur[statType], 0) / last3Games.length;

    const round = (val) => +val.toFixed(1);
    const diff = round(last3Avg - seasonAvg);

    // --- Explanation Builder ---
    let explanation = null;

    if (seasonSource === "last") {
      explanation = `He hasn't played yet this season. Last season, he averaged **${round(
        seasonAvg
      )} ${statType}**, and in his last 3 games he averaged **${round(last3Avg)}**.`;
    } else if (currentSeasonGames.length < 3) {
      explanation = `He's averaging **${round(
        last3Avg
      )} ${statType}** over his last 3 games (some from last season), compared to **${round(
        seasonAvg
      )}** so far this season.`;
    } else {
      if (diff > 0) {
        explanation = `He's averaging **${round(
          last3Avg
        )} ${statType}** over his last 3 games, which is **${diff} more** than his season average of ${round(
          seasonAvg
        )}.`;
      } else if (diff < 0) {
        explanation = `He's averaging **${round(
          last3Avg
        )} ${statType}** over his last 3 games, which is **${Math.abs(
          diff
        )} less** than his season average of ${round(seasonAvg)}.`;
      } else {
        explanation = `He's averaging **${round(
          last3Avg
        )} ${statType}** over his last 3 games — exactly matching his season average.`;
      }
    }

    return {
      statType,
      seasonAvg: round(seasonAvg),
      last3Avg: round(last3Avg),
      last3Games: last3Games.map((g) => ({
        date: g.game_date,
        value: g[statType],
        season: g.game_season,
      })),
      seasonGames: seasonSource === "last" ? lastSeasonGames.length : currentSeasonGames.length,
      explanation,
    };
  } catch (err) {
    return { error: err.message };
  }
}
