import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js";

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

  // ── Body params (NOW INCLUDES direction)
  const { player, line, direction } = req.body;           // ← added direction
  if (!player || typeof line !== "number") {
    return res
      .status(400)
      .json({ error: "Missing or invalid player or line" });
  }

  // ── Split player name
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");
  const statType = "stl";

  try {
    // 🔍 Identify Player
    const { data: playerRow } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

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

    // 🚀 Build All Insights (direction forwarded)
    const insights = await getInsightsForStat({
      playerId: player_id,
      statType,
      statColumns: ["stl"],
      line,
      direction,            // ← pass the flag
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
