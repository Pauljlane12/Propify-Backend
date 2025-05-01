import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getFg3PctTrend({ playerId, supabase }) {
  const insightId = "fg3_pct_trend";
  const insightTitle = "3PT Shooting % Trend";

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    // 1️⃣ Try to get season average 3PT%
    const { data: seasonRow } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .eq("stat_key", "fg3_pct")
      .maybeSingle();

    const { data: fallbackRow } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", previousSeason)
      .eq("stat_key", "fg3_pct")
      .maybeSingle();

    const fg3_pct_season = seasonRow?.stat_value ?? fallbackRow?.stat_value ?? null;
    const seasonUsed = seasonRow ? currentSeason : previousSeason;

    // 2️⃣ Get most recent valid games with 3PA and 3PM
    const { data: allGames } = await supabase
      .from("player_stats")
      .select("fg3a, fg3m, game_date")
      .eq("player_id", playerId)
      .not("fg3a", "is", null)
      .not("fg3m", "is", null)
      .order("game_date", { ascending: false })
      .limit(10);

    const validGames = (allGames || []).filter((g) => g.fg3a > 0);
    const last3 = validGames.slice(0, 3);

    if (!last3.length) {
      return {
        id: insightId,
        title: insightTitle,
        value: "N/A",
        context: "Not enough recent games with 3PA to calculate 3PT trend.",
        status: "info",
      };
    }

    const total_fg3m = last3.reduce((sum, g) => sum + g.fg3m, 0);
    const total_fg3a = last3.reduce((sum, g) => sum + g.fg3a, 0);
    const fg3_pct_last3 = total_fg3a > 0 ? +(total_fg3m / total_fg3a * 100).toFixed(1) : null;

    const context = `He's shooting **${fg3_pct_last3}% from 3** over his last 3 games${
      fg3_pct_season != null ? `, compared to **${(fg3_pct_season * 100).toFixed(1)}%** on the season.` : "."
    }`;

    return {
      id: insightId,
      title: insightTitle,
      value: `${fg3_pct_last3 ?? "N/A"}% vs ${
        fg3_pct_season != null ? (fg3_pct_season * 100).toFixed(1) + "%" : "N/A"
      }`,
      context,
      status: "info",
      details: {
        fg3_pct_last3,
        fg3_pct_season,
        seasonUsed,
        games_sampled: last3.length,
        total_fg3a,
        total_fg3m,
      },
    };
  } catch (e) {
    return {
      id: insightId,
      title: insightTitle,
      value: "Error",
      context: "Could not calculate 3PT percentage trend.",
      status: "danger",
      error: e.message,
    };
  }
}
