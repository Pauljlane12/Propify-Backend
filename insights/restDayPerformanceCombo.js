export async function getComboRestDayPerformance({ playerId, statType, supabase }) {
  try {
    const { data, error } = await supabase
      .from("player_rest_day_averages")
      .select("rest_days, stat_type, value")
      .eq("player_id", playerId)
      .eq("stat_type", statType);

    if (error || !data?.length) {
      return {
        skip: true,
        context: "No rest day data available for this player.",
      };
    }

    const results = {};
    let contextParts = [];

    for (const row of data) {
      const restKey = `${row.rest_days}_days_rest`;
      results[restKey] = row.value;

      contextParts.push(
        `On ${row.rest_days} day${row.rest_days !== 1 ? "s" : ""} of rest, this player averages ${row.value} ${statType.toUpperCase()}.`
      );
    }

    return {
      ...results,
      context: contextParts.join(" "),
    };
  } catch (err) {
    return { error: err.message };
  }
}
