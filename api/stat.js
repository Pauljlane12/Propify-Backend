import { createClient } from "@supabase/supabase-js";
import { statTypeMap } from "../utils/statTypeMap.js";
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

  if (!player || typeof line !== "number" || !statType) {
    return res.status(400).json({
      error: "Missing or invalid player, line, or statType",
    });
  }

  const statColumns = statTypeMap[statType.toLowerCase()];
  if (!statColumns) {
    return res
      .status(400)
      .json({ error: `Unsupported statType: ${statType}` });
  }

  // If it's a single stat, e.g. ["pts"], pass "pts"
  // If it's a combo, e.g. ["pts", "reb", "ast"], keep as "pras" or original statType
  const trueStatType =
    statColumns.length === 1 ? statColumns[0] : statType.toLowerCase();

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 🎯 Get Player
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

    // 🏀 Get Next Opponent
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

    // 📊 Get Insights
    const insights = await getInsightsForStat({
      playerId: player_id,
      statType: trueStatType, // ✅ mapped to "pts", "reb", etc.
      statColumns, // ✅ ["pts"], or ["pts", "reb", "ast"] for combos
      line,
      teamId: team_id,
      opponentTeamId,
      supabase,
    });

    return res.status(200).json({
      player,
      statType: trueStatType,
      line,
      insights,
    });
  } catch (err) {
    console.error("❌ Error in /api/stat:", err);
    return res.status(500).json({
      error: "Internal server error",
      debug: { message: err.message, stack: err.stack },
    });
  }
}
