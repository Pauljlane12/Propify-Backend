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

  let { player, line, direction } = req.body;
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
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerError) {
      console.error("❌ Supabase error finding player:", playerError.message);
      return res.status(500).json({ error: "Error finding player in database." });
    }
    if (!playerRow) {
      console.warn(`⚠️ Player not found for name: "${player}"`);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    const { data: teamRow, error: teamError } = await supabase
      .from("teams")
      .select("abbreviation")
      .eq("id", team_id)
      .single();

    if (teamError) {
      console.error("❌ Supabase error fetching team abbreviation:", teamError.message);
    }

    const playerTeamAbbreviation = teamRow?.abbreviation;

    // ✅ Use date >= today to include today's games
    const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

    const { data: upcomingGames, error: gamesError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .gte("date", today) // ✅ include today's games
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (gamesError) {
      console.error("❌ Supabase error finding next game:", gamesError.message);
      return res.status(500).json({ error: "Failed to fetch upcoming game" });
    }

    const nextGame = upcomingGames?.[0];

    if (!nextGame) {
      return res.status(404).json({ error: "No upcoming game found" });
    }

    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    if (!opponentTeamId || opponentTeamId === team_id) {
      console.warn("⚠️ Invalid opponentTeamId — may be duplicate team IDs in game record");
      return res.status(400).json({ error: "Invalid opponent team ID detected" });
    }

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

    console.log("🚀 Final insights payload:", JSON.stringify(insights, null, 2));

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
