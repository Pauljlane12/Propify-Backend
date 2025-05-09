import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getFgPercentTrend({ playerId, playerLastName, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;
    const minMinutes = 1;

    const { data: currentAvg } = await supabase
      .from("season_averages")
      .select("stat_value")
      .eq("player_id", playerId)
      .eq("season", currentSeason)
      .eq("stat_key", "fg_pct")
      .maybeSingle();

    let seasonFgPercent = currentAvg?.stat_value ?? null;
    let usedFallbackSeason = false; // ✅ fixed here

    if (seasonFgPercent == null) {
      const { data: previousAvg } = await supabase
        .from("season_averages")
        .select("stat_value")
        .eq("player_id", playerId)
        .eq("season", previousSeason)
        .eq("stat_key", "fg_pct")
        .maybeSingle();

      seasonFgPercent = previousAvg?.stat_value ?? null;
      usedFallbackSeason = true;
    }

    const getValidGames = async (season) => {
      const { data } = await supabase
        .from("player_stats")
        .select("fgm, fga, min, game_season, game_date")
        .eq("player_id", playerId)
        .eq("game_season", season)
        .order("game_date", { ascending: false })
        .limit(10);

      return (data || []).filter(
        (g) =>
          g.fgm != null &&
          g.fga != null &&
          g.fga > 0 &&
          g.min != null &&
          /^[0-9]+$/.test(g.min) &&
          parseInt(g.min, 10) >= minMinutes
      );
    };

    const currentGames = await getValidGames(currentSeason);
    let finalGames = [...currentGames];

    if (finalGames.length < 3) {
      const previousGames = await getValidGames(previousSeason);
      const needed = 3 - finalGames.length;
      finalGames = [...finalGames, ...previousGames.slice(0, needed)];
    }

    const usedGames = finalGames.slice(0, 3);
    const totalFga = usedGames.reduce((sum, g) => sum + g.fga, 0);
    const totalFgm = usedGames.reduce((sum, g) => sum + g.fgm, 0);

    const fgPercentLast3 =
      totalFga > 0 ? parseFloat((totalFgm / totalFga).toFixed(3)) : null;

    if (fgPercentLast3 == null || seasonFgPercent == null) {
      return {
        fgPercentLast3: null,
        seasonFgPercent: null,
        context: "Not enough data available to generate FG% insight.",
        usedFallbackSeason,
      };
    }

    const formattedRecent = (fgPercentLast3 * 100).toFixed(1);
    const formattedSeason = (seasonFgPercent * 100).toFixed(1);
    const diff = fgPercentLast3 - seasonFgPercent;

    const trendWord =
      diff > 0 ? "up from" : diff < 0 ? "down from" : "matching";

    const context =
      trendWord === "matching"
        ? `**${playerLastName}** is shooting **${formattedRecent}%** from the field over his last 3 games — matching his season average.`
        : `**${playerLastName}** is shooting **${formattedRecent}%** from the field over his last 3 games — ${trendWord} his season average of **${formattedSeason}%**.`;

    return {
      fgPercentLast3,
      seasonFgPercent,
      context,
      usedFallbackSeason,
    };
  } catch (err) {
    console.error("❌ Error in getFgPercentTrend:", err.message);
    return {
      fgPercentLast3: null,
      seasonFgPercent: null,
      context: "An error occurred while calculating FG% trend.",
      error: err.message,
    };
  }
}
