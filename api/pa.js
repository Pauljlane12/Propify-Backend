import { createClient } from "@supabase/supabase-js";
import { getComboInsights } from "../insights/comboIndex.js";

console.log("🚀 /api/pa.js loaded");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function paHandler(req, res) {
  console.log("🔥 PA request hit with:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  /* ---------- robust player‑name split ---------- */
  const [firstNameRaw, ...lastPartsRaw] = player.trim().split(/\s+/);
  const firstName = firstNameRaw;
  const lastName  = lastPartsRaw.join(" ");

  const statType    = "pa";
  const statColumns = ["pts", "ast"];

  try {
    /* ---------- look up player via ilike (case‑insensitive) ---------- */
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name",  `%${lastName}%`)
      .maybeSingle();

    if (playerError || !playerRow) {
      console.error("❌ Player not found:", { firstName, lastName });
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    /* ---------- get next opponent ---------- */
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

    /* ---------- gather combo insights ---------- */
    const insights = await getComboInsights({
      playerId: player_id,
      statType,
      statColumns,
      line,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log("✅ PA insights payload:", JSON.stringify(insights, null, 2));
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled server error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
