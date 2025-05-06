import { createClient } from "@supabase/supabase-js";
import { getComboInsights } from "../insights/comboIndex.js";

console.log("🚀 /api/pras.js loaded");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function prasHandler(req, res) {
  console.log("🔥 PRA request hit with:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line, direction } = req.body;

  if (!player || typeof line !== "number") {
    console.error("❌ Invalid request data:", req.body);
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // Normalize and sanitize name
  const normalize = (str) =>
    str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^\w\s]/gi, "")        // remove punctuation
      .toLowerCase()
      .trim();

  const normalizedTarget = normalize(player);

  const statType = "pras";
  const statColumns = ["pts", "reb", "ast"];

  try {
    // Fetch all players
    const { data: players, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id, first_name, last_name");

    if (playerError || !players?.length) {
      console.error("❌ Failed to fetch players:", playerError);
      return res.status(500).json({ error: "Failed to fetch players" });
    }

    // Flexible match logic
    const playerRow = players.find((p) => {
      const fullName = normalize(`${p.first_name} ${p.last_name}`);
      const reversedName = normalize(`${p.last_name} ${p.first_name}`);
      return (
        fullName === normalizedTarget ||
        reversedName === normalizedTarget ||
        fullName.includes(normalizedTarget) ||
        normalizedTarget.includes(fullName)
      );
    });

    if (!playerRow) {
      console.error("❌ Player not found for:", normalizedTarget);
      return res.status(404).json({ error: `Player not found: ${player}` });
    }

    const { player_id, team_id } = playerRow;

    // Get upcoming opponent team
    const { data: upcomingGames, error: gameError } = await supabase
      .from("games")
      .select("home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (gameError) {
      console.error("❌ Failed to fetch games:", gameError);
      return res.status(500).json({ error: "Failed to fetch games" });
    }

    const nextGame = upcomingGames?.[0];
    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    // Fetch PRA insights
    const insights = await getComboInsights({
      playerId: player_id,
      statType,
      statColumns,
      line,
      direction,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log("✅ PRA insights payload:", JSON.stringify(insights, null, 2));

    return res.status(200).json({
      player,
      line,
      direction,
      insights,
    });
  } catch (err) {
    console.error("❌ Unhandled server error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
