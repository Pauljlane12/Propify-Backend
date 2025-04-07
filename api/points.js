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

    const today = new Date().toISOString();
    const { data: upcomingGames } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id")
      .gt("date", today)
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    const nextGame = upcomingGames?.[0];
    const opponentTeamId = nextGame?.home_team_id === team_id
      ? nextGame?.visitor_team_id
      : nextGame?.home_team_id;

    const { data: opponentTeam } = await supabase
      .from("teams")
      .select("full_name, abbreviation")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const opponentAbbr = opponentTeam?.abbreviation;

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

    try {
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
        .eq("defense_team_name", opponentTeam?.full_name);

      if (error) throw error;
      insights.insight_3_positional_defense = defenseRankings;
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // Insight #5: Home vs Away Performance
    try {
      const { data: gameStats } = await supabase
        .from("player_stats")
        .select("pts, min, game_id")
        .eq("player_id", player_id);
      const gameIds = gameStats?.map((g) => g.game_id).filter((id) => typeof id === "number") || [];
      const { data: games } = await supabase
        .from("games")
        .select("id, home_team_id")
        .in("id", gameIds);
      const gameMap = Object.fromEntries((games || []).map(g => [g.id, g.home_team_id]));

      const home = [], away = [];
      for (const g of gameStats || []) {
        if (!g.min || parseInt(g.min) < 10 || g.pts == null) continue;
        const isHome = gameMap[g.game_id] === team_id;
        (isHome ? home : away).push(g.pts);
      }

      insights.insight_5_home_vs_away = {
        home: +(home.reduce((a, b) => a + b, 0) / home.length || 0).toFixed(2),
        away: +(away.reduce((a, b) => a + b, 0) / away.length || 0).toFixed(2),
      };
    } catch (err) {
      insights.insight_5_home_vs_away = { error: err.message };
    }

    // Insight #7: Injury Report for Both Teams
    try {
      const teamIds = [team_id, opponentTeamId].filter(Boolean);
      const { data: injuries } = await supabase
        .from("player_injuries")
        .select("player_id, first_name, last_name, position, status, return_date, description, team_id")
        .in("team_id", teamIds);
      insights.insight_7_injury_report = injuries || [];
    } catch (err) {
      insights.insight_7_injury_report = { error: err.message };
    }

    // Advanced Metric #1: Projected Game Pace
    try {
      const { data: paceData } = await supabase.rpc("projected_game_pace", {
        team1_abbr: teamAbbrForInjuries,
        team2_abbr: opponentAbbr,
      });
      insights.advanced_metric_1_projected_game_pace = paceData?.[0] || {};
    } catch (err) {
      insights.advanced_metric_1_projected_game_pace = { error: err.message };
    }

    // Advanced Metric #2: Opponent Team Pace Rank
    try {
      const { data: paceRank } = await supabase
        .from("box_scores")
        .select("team_id")
        .eq("team_id", opponentTeamId)
        .limit(1);
      insights.advanced_metric_2_opponent_pace_rank = paceRank?.[0] || {};
    } catch (err) {
      insights.advanced_metric_2_opponent_pace_rank = { error: err.message };
    }

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
