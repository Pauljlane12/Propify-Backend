import { createClient } from "@supabase/supabase-js";
import { getComboInsights } from "../insights/comboIndex.js";

console.log("🚀 /api/pras.js loaded"); // confirm file loaded on Vercel

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function prasHandler(req, res) {
  console.log("🔥 PRA request hit with:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line } = req.body;

  if (!player || typeof line !== "number") {
    console.error("❌ Invalid request data:", req.body);
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  const normalize = (str) =>
    str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^\w\s]/gi, "")        // remove punctuation
      .toLowerCase()
      .trim();

  const normalizedTarget = normalize(player); // "michael porter jr"

  const statType = "pras";
  const statColumns = ["pts", "reb", "ast"];

  try {
    const { data: players, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id, first_name, last_name");

    if (playerError || !players?.length) {
      console.error("❌ Failed to fetch players:", playerError);
      return res.status(500).json({ error: "Failed to fetch players" });
    }

    const playerRow = players.find((p) => {
      const fullName = `${p.first_name} ${p.last_name}`;
      return normalize(fullName) === normalizedTarget;
    });

    if (!playerRow) {
      console.error("❌ Player not found:", normalizedTarget);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

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

    const insights = await getComboInsights({
      playerId: player_id,
      statType,
      statColumns,
      line,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log("✅ PRA insights payload:", JSON.stringify(insights, null, 2));

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled server error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
