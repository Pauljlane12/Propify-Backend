import { createClient } from "@supabase/supabase-js";
import { statTypeMap } from "../utils/statTypeMap.js";
import { computeStatValue } from "../utils/computeStatValue.js";
import { getInsightsForStat } from "../insights/index.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function statHandler(req, res) {
  console.log("🔥 /api/stat was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line, statType } = req.body;

  // Validate request
  if (!player || typeof line !== "number" || !statType) {
    return res.status(400).json({
      error: "Missing or invalid player, line, or statType",
    });
  }

  const statColumns = statTypeMap[statType.toLowerCase()];
  if (!statColumns) {
    return res.status(400).json({ error: `Unsupported statType: ${statType}` });
  }

  // Split name
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 🎯 Find player
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerError || !playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    // 🏀 Find next game for team
    const { data: upcomingGames, error: gameError } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, status")
      .neq("status", "Final")
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (gameError) {
      return res.status(500).json({ error: gameError.message });
    }

    const nextGame = upcomingGames?.[0];
    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    // 📊 Run insights
    const insights = await getInsightsForStat({
      playerId: player_id,
      statType: statType.toLowerCase(),
      statColumns,
      line,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    return res.status(200).json({
      player,
      statType,
      line,
      insights,
    });
  } catch (err) {
    console.error("❌ Error in /api/stat.js:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
