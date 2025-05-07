import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getFg3aTrend({ playerId, playerLastName, supabase }) {
  const insightId = "fg3a_trend_last3";
  const insightTitle = "3PT Attempt Trend";

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    const { data: currentAvgData } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .eq("stat_key", "fg3a")
      .maybeSingle();

    const { data: fallbackAvgData } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", previousSeason)
      .eq("stat_key", "fg3a")
      .maybeSingle();

    const fg3a_season = currentAvgData?.stat_value ?? fallbackAvgData?.stat_value ?? null;
    const seasonUsed = currentAvgData ? currentSeason : previousSeason;

    async function getValidGames(season) {
      const { data, error } = await supabase
        .from("player_stats")
        .select("game_date, fg3a")
        .eq("player_id", playerId)
        .eq("game_season", season)
        .not("fg3a", "is", null)
        .order("game_date", { ascending: false })
        .limit(10);

      if (error || !data) return [];
      return data.filter((g) => g.fg3a != null);
    }

    const currentGames = await getValidGames(currentSeason);
    let last3 = currentGames.slice(0, 3);

    if (last3.length < 3) {
      const needed = 3 - last3.length;
      const previousGames = await getValidGames(previousSeason);
      last3 = [...last3, ...previousGames.slice(0, needed)];
    }

    if (last3.length === 0) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: "Not enough recent games to evaluate 3PT attempt trend.",
        status: "info",
      };
    }

    const fg3a_last_3 = +(
      last3.reduce((sum, g) => sum + g.fg3a, 0) / last3.length
    ).toFixed(1);

    let context;
    if (fg3a_season !== null) {
      const diff = +(fg3a_last_3 - fg3a_season).toFixed(1);
      const absDiff = Math.abs(diff);

      let trendDescription = "";
      if (absDiff < 0.5) {
        trendDescription = "is taking about the same number of threes";
      } else if (diff >= 0.5 && diff < 1.5) {
        trendDescription = "is taking slightly more threes";
      } else if (diff >= 1.5) {
        trendDescription = "is taking more threes";
      } else if (diff <= -0.5 && diff > -1.5) {
        trendDescription = "is taking slightly fewer threes";
      } else {
        trendDescription = "is taking fewer threes";
      }

      context = `**${playerLastName}** ${trendDescription} recently — averaging **${fg3a_last_3} 3PA** over the last 3 games compared to **${fg3a_season}** on the season.`;
    } else {
      context = `**${playerLastName}** is averaging **${fg3a_last_3} 3PA** over the last 3 games. Season average not available.`;
    }

    return {
      id: insightId,
      title: insightTitle,
      value: `${fg3a_last_3} vs ${fg3a_season ?? "N/A"}`,
      context,
      status: "info",
      details: {
        fg3a_last_3,
        fg3a_season,
        seasonUsed,
        games_sampled: last3.length,
      },
    };
  } catch (e) {
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: "Could not calculate 3PT attempt trend.",
      status: "danger",
      error: e.message,
    };
  }
}
