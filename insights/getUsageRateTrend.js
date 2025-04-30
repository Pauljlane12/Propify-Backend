import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getUsageRateTrend({ playerId, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;
    const minGames = 3;

    // Helper to fetch usage % by season
    const fetchUsageGames = async (season) => {
      const { data } = await supabase
        .from("advanced_stats")
        .select("usage_percentage, game_date, game_season")
        .eq("player_id", playerId)
        .eq("game_season", season)
        .order("game_date", { ascending: false })
        .limit(10);

      return (data || []).filter((g) => g.usage_percentage !== null);
    };

    const currentGames = await fetchUsageGames(currentSeason);
    let allGames = [...currentGames];
    let usedFallback = false;

    if (allGames.length < minGames) {
      const previousGames = await fetchUsageGames(previousSeason);
      const needed = minGames - allGames.length;
      allGames = [...allGames, ...previousGames.slice(0, needed)];
      usedFallback = currentGames.length === 0 && previousGames.length > 0;
    }

    const last3 = allGames.slice(0, 3);
    const usageLast3 =
      last3.length > 0
        ? parseFloat(
            (
              last3.reduce((sum, g) => sum + g.usage_percentage, 0) / last3.length
            ).toFixed(3)
          )
        : null;

    // Calculate full-season usage (current or fallback season only)
    const seasonGames = currentGames.length > 0 ? currentGames : await fetchUsageGames(previousSeason);
    const seasonUsage =
      seasonGames.length > 0
        ? parseFloat(
            (
              seasonGames.reduce((sum, g) => sum + g.usage_percentage, 0) /
              seasonGames.length
            ).toFixed(3)
          )
        : null;

    if (usageLast3 == null || seasonUsage == null) {
      return {
        usageLast3: null,
        seasonUsage: null,
        context: "Not enough usage rate data available.",
        usedFallback,
      };
    }

    const formattedRecent = (usageLast3 * 100).toFixed(1);
    const formattedSeason = (seasonUsage * 100).toFixed(1);

    return {
      usageLast3,
      seasonUsage,
      context: `His usage rate is **${formattedRecent}%** over his last 3 games — ${
        usageLast3 > seasonUsage ? "up" : "down"
      } from his season average of **${formattedSeason}%**.`,
      usedFallback,
    };
  } catch (err) {
    console.error("❌ Error in getUsageRateTrend:", err.message);
    return {
      usageLast3: null,
      seasonUsage: null,
      context: "An error occurred while calculating usage rate trend.",
      error: err.message,
    };
  }
}
