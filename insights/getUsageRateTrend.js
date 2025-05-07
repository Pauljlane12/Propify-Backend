import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getUsageRateTrend({ playerId, playerLastName, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;
    const minGames = 3;

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

    const seasonGames =
      currentGames.length > 0
        ? currentGames
        : await fetchUsageGames(previousSeason);

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

    const diff = usageLast3 - seasonUsage;
    const trendWord =
      Math.abs(diff) < 0.5
        ? "matching"
        : diff > 0
        ? "up from"
        : "down from";

    const context =
      trendWord === "matching"
        ? `**${playerLastName}**'s usage rate is **${formattedRecent}%** over his last 3 games — matching his season average.`
        : `**${playerLastName}**'s usage rate is **${formattedRecent}%** over his last 3 games — ${trendWord} his season average of **${formattedSeason}%**.`;

    return {
      usageLast3,
      seasonUsage,
      context,
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
