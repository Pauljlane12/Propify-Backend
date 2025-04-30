import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

/**
 * Returns a team's defensive rank based on top-minute player DRtg averages.
 * Only returns the rank (not the raw DRtg number) for user-friendly display.
 */
export async function getTeamDefRatingRank({ opponentTeamId, supabase }) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    // 1️⃣ Pull completed games for the season
    const { data: finalGames, error: gameError } = await supabase
      .from("games")
      .select("id")
      .eq("season", currentSeason)
      .eq("status", "Final");

    if (gameError) throw new Error("Failed to fetch games");
    const finalGameIds = finalGames.map((g) => g.id);

    // 2️⃣ Join advanced_stats + player_stats to get minutes
    const { data: joinedStats, error: statError } = await supabase
      .rpc("get_team_defensive_ratings", { game_ids: finalGameIds }); // Optional: replace with SQL below

    if (statError || !joinedStats?.length)
      throw new Error("Failed to get defensive ratings");

    // 3️⃣ Group by team, average DRtg from top-minute players per game
    const grouped = {};
    for (const row of joinedStats) {
      if (!grouped[row.team_id]) {
        grouped[row.team_id] = [];
      }
      grouped[row.team_id].push(row.defensive_rating);
    }

    const teamAverages = Object.entries(grouped).map(([teamId, values]) => {
      const avg =
        values.reduce((sum, val) => sum + val, 0) / values.length;
      return { teamId: parseInt(teamId), avgRating: avg };
    });

    // 4️⃣ Sort and rank teams
    const ranked = [...teamAverages]
      .sort((a, b) => a.avgRating - b.avgRating)
      .map((t, idx) => ({
        ...t,
        rank: idx + 1,
      }));

    const teamEntry = ranked.find((t) => t.teamId === opponentTeamId);

    if (!teamEntry) {
      return {
        id: "team_def_rating_rank",
        context: "No defensive rating available for this opponent.",
        status: "info",
      };
    }

    return {
      id: "team_def_rating_rank",
      context: `The opponent ranks **#${teamEntry.rank}** in overall NBA defense this season.`,
      rank: teamEntry.rank,
      status:
        teamEntry.rank <= 10
          ? "danger"
          : teamEntry.rank >= 21
          ? "success"
          : "warning", // Lower rank = tougher defense
    };
  } catch (err) {
    console.error("❌ getTeamDefRatingRank error:", err.message);
    return {
      id: "team_def_rating_rank",
      context: "Could not load team defensive rank.",
      status: "info",
      error: err.message,
    };
  }
}
