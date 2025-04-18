export async function getMostRecentSeason(supabase) {
  const { data, error } = await supabase
    .from("games")
    .select("season")
    .order("date", { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    console.warn("⚠️ Could not determine current season — defaulting to 2024");
    return 2024;
  }

  return data[0].season;
}
