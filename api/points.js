import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function pointsHandler(req, res) {
  console.log("🔥 /api/points was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line, direction } = req.body;
  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");
  const statType = "pts";

  const getLastName = (name) => {
    if (!name) return "";
    const parts = name.trim().split(" ");
    return parts.length > 1 ? parts[parts.length - 1] : name;
  };
  const playerLastNameForPayload = getLastName(player);

  try {
    // Step 1: Identify player and team
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerError || !playerRow) {
      console.error("❌ Error finding player:", playerError?.message);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    // Step 2: Get team abbreviation
    const { data: teamRow, error: teamError } = await supabase
      .from("teams")
      .select("abbreviation")
      .eq("id", team_id)
      .maybeSingle();

    const playerTeamAbbreviation = teamRow?.abbreviation || "N/A";

    if (teamError) {
      console.error("❌ Error fetching team abbreviation:", teamError.message);
    }

    // Step 3: Find upcoming game from today forward
    const today = new Date().toISOString().split("T")[0];

    const { data: upcomingGames, error: gamesError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .gte("date", today)
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (gamesError) {
      console.error("❌ Error finding upcoming game:", gamesError.message);
      return res.status(500).json({ error: "Failed to fetch upcoming game" });
    }

    const nextGame = upcomingGames?.[0];
    if (!nextGame) {
      return res.status(404).json({ error: "No upcoming game found" });
    }

    const { home_team_id, visitor_team_id } = nextGame;
    const opponentTeamId = home_team_id === team_id ? visitor_team_id : home_team_id;

    if (!opponentTeamId || opponentTeamId === team_id) {
      console.warn("⚠️ Invalid opponent team detected");
      return res.status(400).json({ error: "Invalid opponent team ID" });
    }

    // Step 4: Fetch insights — ✅ NOW includes playerName
    const insights = await getInsightsForStat({
      playerId: player_id,
      playerName: player,
      statType,
      statColumns: [statType],
      line,
      direction,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    console.log("✅ Final insights payload:", JSON.stringify(insights, null, 2));

    return res.status(200).json({
      player: playerLastNameForPayload,
      line,
      direction,
      player_team_abbreviation: playerTeamAbbreviation,
      insights,
    });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
