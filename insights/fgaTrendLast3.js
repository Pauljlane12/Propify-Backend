import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getFgaTrendLast3({ playerId, playerLastName, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    // 1. Get all games this season (with FGA and minutes)
    const { data, error } = await supabase
      .from("player_stats")
      .select("game_date, fga, min")
      .eq("player_id", playerId)
      .eq("game_season", currentSeason)
      .order("game_date", { ascending: false });

    if (error || !data?.length) {
      return { error: "No FGA data available for this player this season." };
    }

    // 2. Filter to valid games with ≥ 10 minutes
    const valid = data.filter((g) => {
      const minutes = parseInt(g.min, 10);
      return !isNaN(minutes) && minutes >= 10 && g.fga != null;
    });

    if (valid.length === 0) {
      return { error: "No valid games with 10+ minutes found for FGA analysis." };
    }

    // 3. Calculate season average
    const seasonTotal = valid.reduce((sum, g) => sum + g.fga, 0);
    const seasonAvg = seasonTotal / valid.length;

    // 4. Get last 3 valid games
    const last3 = valid.slice(0, 3);
    const last3Total = last3.reduce((sum, g) => sum + g.fga, 0);
    const last3Avg = last3.length ? last3Total / last3.length : 0;

    const difference = last3Avg - seasonAvg;

    // 5. Generate clean explanation
    let trendNote = "";

    if (difference > 1.5) {
      trendNote = "He's taking more shots recently — potential uptick in usage.";
    } else if (difference < -1.5) {
      trendNote = "He's taking fewer shots recently — possible role change or tough matchups.";
    } else {
      trendNote = "His shot volume is consistent with his season average.";
    }

    const context = `**${playerLastName}** is averaging **${last3Avg.toFixed(
      1
    )} FGA** over his last 3 games vs **${seasonAvg.toFixed(1)}** on the season. ${trendNote}`;

    return {
      seasonAvgFGA: +seasonAvg.toFixed(1),
      last3AvgFGA: +last3Avg.toFixed(1),
      difference: +difference.toFixed(1),
      context,
    };
  } catch (err) {
    return { error: err.message };
  }
}
