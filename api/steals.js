import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js";
import { findPlayerByName } from "../utils/findPlayerByName.js"; // ✅ new import

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function stealsHandler(req, res) {
  console.log("🔥 /api/steals was hit:", req.body);

  // ── Allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  // ── Body params
  const { player, line, direction } = req.body;
  if (!player || typeof line !== "number") {
    return res
      .status(400)
      .json({ error: "Missing or invalid player or line" });
  }

  try {
    // 🔍 Identify Player (using normalized matching)
    const playerRow = await findPlayerByName(player, supabase);

    if (!playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    // 🏀 Get Opponent Team (Next Game)
    const { data: upcomingGames } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    const nextGame = upcomingGames?.[0];
    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    // 🚀 Build All Insights
    const insights = await getInsightsForStat({
      playerId: player_id,
      statType: "stl",
      statColumns: ["stl"],
      line,
      direction,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log(
      "🚀 Final steals insights payload:",
      JSON.stringify(insights, null, 2)
    );

    return res.status(200).json({ player, line, direction, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/steals:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
