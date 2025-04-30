import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getFg3aTrend({ playerId, supabase }) {
  const insightId = "fg3a_trend_last3";
  const insightTitle = "3PT Attempt Trend";

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    // 1️⃣ Try to get current season average
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

    // 2️⃣ Pull recent games from both seasons (most recent first)
    const { data: recentGames } = await supabase
      .from("player_stats")
      .select("game_date, game_season, fg3a")
      .eq("player_id", playerId)
      .not("fg3a", "is", null)
      .order("game_date", { ascending: false })
      .limit(10); // pull extra in case of gaps

    if (!recentGames?.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: "Not enough recent games to evaluate 3PT attempt trend.",
        status: "info",
      };
    }

    // 3️⃣ Smart fallback logic to get last 3 valid games across seasons
    const validRecent = recentGames.filter(g => g.fg3a !== null);
    const last3 = validRecent.slice(0, 3);

    const fg3a_last_3 = +(last3.reduce((sum, g) => sum + g.fg3a, 0) / last3.length).toFixed(1);

    // 4️⃣ Create context and return
    const context = `He's averaged **${fg3a_last_3} 3PA** over his last 3 games — ${
      fg3a_season ? `vs **${fg3a_season}** on the season.` : `season average not available.`
    }`;

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
