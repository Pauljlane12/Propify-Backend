import { createClient } from "@supabase/supabase-js";
import { getComboInsights } from "../insights/comboIndex.js"; // ✅ Use the combo version

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function prasHandler(req, res) {
  console.log("🔥 /api/pras was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  let { player, line } = req.body;
  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  const normalize = (str) =>
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const [firstNameRaw, ...lastPartsRaw] = player.trim().split(" ");
  const firstName = normalize(firstNameRaw);
  const lastName = normalize(lastPartsRaw.join(" "));

  const statType = "pras"; // Points + Rebounds + Assists
  const statColumns = ["pts", "reb", "ast"]; // combo columns

  try {
    const { data: playerRow } = await supabase
      .from("players")
      .select("player_id, team_id, first_name, last_name")
      .then(({ data }) =>
        data?.find(
          (p) =>
            normalize(p.first_name) === firstName &&
            normalize(p.last_name) === lastName
        )
      );

    if (!playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

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

    const insights = await getComboInsights({
      playerId: player_id,
      statType,
      statColumns,
      line,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log("🚀 Final PRA insights payload:", JSON.stringify(insights, null, 2));

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/pras:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
