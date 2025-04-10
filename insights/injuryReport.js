export async function getInjuryReport({ teamId, opponentTeamId, supabase }) {
  try {
    const teamIds = [teamId, opponentTeamId].filter(Boolean);

    const { data, error } = await supabase
      .from("player_injuries")
      .select(
        "player_id, first_name, last_name, position, status, return_date, description, team_id"
      )
      .in("team_id", teamIds);

    if (error) {
      return { error: error.message };
    }

    return {
      total: data.length,
      injuries: data,
    };
  } catch (err) {
    return { error: err.message };
  }
}
