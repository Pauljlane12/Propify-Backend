export async function findPlayerByName(name, supabase) {
  const normalizedInput = name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z\s]/gi, "")
    .trim();

  const { data: players, error } = await supabase
    .from("players")
    .select("player_id, team_id, first_name, last_name");

  if (error || !players) return null;

  for (let player of players) {
    const normalizedFullName = `${player.first_name} ${player.last_name}`
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/[^a-z\s]/gi, "")
      .trim();

    if (normalizedFullName === normalizedInput) {
      return player;
    }
  }

  return null;
}
