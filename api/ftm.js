import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function ftmHandler(req, res) {
  console.log("🔥 /api/ftm was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line, direction } = req.body;
  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // ✅ Normalize function to handle hyphens, punctuation, and case
  const normalize = (str) =>
    str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/-/g, " ")              // convert hyphens to space
      .replace(/[^\w\s]/gi, "")        // remove punctuation
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");           // collapse extra spaces

  const normalizedTarget = normalize(player);
  const statType = "ftm";

  try {
    // 🔍 Fetch players from active_players for best accuracy
    const { data: players, error: playerError } = await supabase
      .from("active_players")
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
      return res.status(404).json({ error: `Player not found: ${player}` });
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

    const insights = await getInsightsForStat({
      playerId: player_id,
      statType,
      statColumns: ["ftm"],
      line,
      direction,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log(
      "🚀 Final ftm insights payload:",
      JSON.stringify(insights, null, 2)
    );

    return res.status(200).json({ player, line, direction, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/ftm:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
