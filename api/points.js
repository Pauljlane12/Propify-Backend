const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function pointsHandler(req, res) {
  console.log("🔥 /api/points was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  let {
    player,
    line,
    teamAbbrForInjuries,
  } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  if (!teamAbbrForInjuries) teamAbbrForInjuries = "LAL";

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id, position")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr || !playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id, position: fallbackPosition } = playerRow;
    const insights = {};

    try {
      const { data, error } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      const valid = (data || []).filter((g) => g.min && parseInt(g.min) >= 10);
      const hits = valid.filter((g) => (g.pts || 0) > line).length;
      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: valid.length,
        hitRatePercent: valid.length ? ((hits / valid.length) * 100).toFixed(1) : "0",
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    try {
      const { data: seasonStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);
      const seasonValid = (seasonStats || []).filter((g) => g.min && parseInt(g.min) >= 10);
      const seasonAvg = seasonValid.reduce((sum, g) => sum + (g.pts || 0), 0) / seasonValid.length;

      const { data: last3Stats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);
      const last3Valid = (last3Stats || []).filter((g) => g.min && parseInt(g.min) >= 10);
      const avg3 = last3Valid.reduce((sum, g) => sum + (g.pts || 0), 0) / last3Valid.length;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1),
      };
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // Insight #3: Positional Defense vs Next Opponent (dynamic position)
    try {
      const today = new Date().toISOString();
      const { data: upcomingGames } = await supabase
        .from("games")
        .select("id, date, home_team_id, visitor_team_id")
        .gt("date", today)
        .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
        .order("date", { ascending: true })
        .limit(1);

      const nextGame = upcomingGames?.[0];
      if (!nextGame) throw new Error("No upcoming game found for this player");

      const opponentTeamId = nextGame.home_team_id === team_id
        ? nextGame.visitor_team_id
        : nextGame.home_team_id;

      const { data: opponentTeam } = await supabase
        .from("teams")
        .select("full_name")
        .eq("id", opponentTeamId)
        .maybeSingle();

      if (!opponentTeam?.full_name) throw new Error("Opponent team not found");

      const { data: activeRow } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activeRow?.true_position || fallbackPosition || "PG";

      const { data: defenseRankings, error } = await supabase
        .from("positional_defense_rankings")
        .select("*")
        .eq("position", playerPosition)
        .eq("stat_type", "pts")
        .eq("defense_team_name", opponentTeam.full_name);

      if (error) throw error;
      insights.insight_3_positional_defense = defenseRankings;
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // (Rest of the insights unchanged...)

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
