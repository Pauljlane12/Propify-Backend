/**
 * /api/points.js
 * API endpoint to fetch insights for a player's Points prop.
 * Identifies player and opponent, then calls the insight orchestrator.
 * Passes player name, direction, and team abbreviation to the insight orchestrator.
 * Returns player's LAST NAME in the final payload.
 */
import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js"; // path already correct

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function pointsHandler(req, res) {
  console.log("🔥 /api/points was hit:", req.body);

  // ───────────────────────────────────────────────
  // Method check
  // ───────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  // ───────────────────────────────────────────────
  // Grab body parameters (NOW INCLUDES direction)
  // ───────────────────────────────────────────────
  let { player, line, direction } = req.body; // ← added direction
  if (!player || typeof line !== "number") {
    return res
      .status(400)
      .json({ error: "Missing or invalid player or line" });
  }

  // ───────────────────────────────────────────────
  // Split first / last name
  // ───────────────────────────────────────────────
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" "); // Extract the last name
  const statType = "pts"; // Define the statistic type for this endpoint

  // Helper to get last name for payload
  const getLastName = (name) => {
    if (!name) return "";
    const parts = name.trim().split(" ");
    return parts.length > 1 ? parts[parts.length - 1] : name;
  };
  const playerLastNameForPayload = getLastName(player);

  try {
    // ── Identify player
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerError) {
      console.error("❌ Supabase error finding player:", playerError.message);
      return res
        .status(500)
        .json({ error: "Error finding player in database." });
    }
    if (!playerRow) {
      console.warn(`⚠️ Player not found for name: "${player}"`);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    // ── Fetch the player’s team abbreviation
    const { data: teamRow, error: teamError } = await supabase
      .from("teams")
      .select("abbreviation")
      .eq("id", team_id)
      .single();
    if (teamError) {
      console.error(
        "❌ Supabase error fetching team abbreviation:",
        teamError.message
      );
    }
    const playerTeamAbbreviation = teamRow?.abbreviation;

    // ── Next opponent (first non-Final game)
    const { data: upcomingGames, error: gamesError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (gamesError) {
      console.error(
        "❌ Supabase error finding next game:",
        gamesError.message
      );
      console.warn("Could not find upcoming game for opponent team ID.");
    }

    const nextGame = upcomingGames?.[0];
    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    // ───────────────────────────────────────────────
    // 👉  Build all insights (direction now forwarded)
    // ───────────────────────────────────────────────
    const insightsArray = await getInsightsForStat({
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

    // DEBUG: log the raw array
    console.log("🚀 Raw insights array:", JSON.stringify(insightsArray, null, 2));

    // Convert the array of { id, ... } into an object keyed by id
    const insights = insightsArray.reduce((map, insight) => {
      if (insight && insight.id) {
        map[insight.id] = insight;
      }
      return map;
    }, {});

    console.log("🚀 Transformed insights object:", JSON.stringify(insights, null, 2));

    // Return the final payload including player's last name and team abbreviation
    return res.status(200).json({
      player: playerLastNameForPayload,
      line,
      direction,
      player_team_abbreviation: playerTeamAbbreviation,
      insights, // now an object
    });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
