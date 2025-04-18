export async function getInjuryReport({ teamId, opponentTeamId, supabase }) {
  try {
    const teamIds = [teamId, opponentTeamId].filter(Boolean);
    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const { data, error } = await supabase
      .from("player_injuries")
      .select(
        "player_id, first_name, last_name, position, status, return_date, description, team_id"
      )
      .in("team_id", teamIds)
      .in("status", ["Out", "Day-To-Day", "Questionable"]);

    if (error) {
      return { error: error.message };
    }

    const valid = (data || []).filter((inj) => {
      const dateStr = `${inj.return_date} ${currentYear}`; // e.g., "Apr 19 2024"
      const parsed = new Date(Date.parse(dateStr));
      return parsed.toISOString().split("T")[0] >= today;
    });

    return {
      total: valid.length,
      injuries: valid,
    };
  } catch (err) {
    return { error: err.message };
  }
}
