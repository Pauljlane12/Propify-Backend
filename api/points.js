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
    opponentAbbr,
    teamAbbrForInjuries,
  } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // Fallbacks
  if (!opponentAbbr) opponentAbbr = "MIA";
  if (!teamAbbrForInjuries) teamAbbrForInjuries = "LAL";

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr || !playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;
    const insights = {};

    // INSIGHT 1: Last 10 Hit Rate
    try {
      const { data, error } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);

      if (error) throw error;

      const valid = data.filter((g) => g.min && parseInt(g.min) >= 10);
      const hits = valid.filter((g) => (g.pts || 0) > line).length;
      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: valid.length,
        hitRatePercent: valid.length ? ((hits / valid.length) * 100).toFixed(1) : "0",
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    // INSIGHT 2: Season Avg vs Last 3
    try {
      const { data: seasonStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);

      const seasonValid = seasonStats.filter((g) => g.min && parseInt(g.min) >= 10);
      const seasonAvg = seasonValid.reduce((sum, g) => sum + (g.pts || 0), 0) / seasonValid.length;

      const { data: last3Stats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);

      const last3Valid = last3Stats.filter((g) => g.min && parseInt(g.min) >= 10);
      const avg3 = last3Valid.reduce((sum, g) => sum + (g.pts || 0), 0) / last3Valid.length;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1),
      };
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // INSIGHT 3: Positional Defense (PG vs Opponent)
    try {
      const { data, error } = await supabase
        .from("positional_defense_rankings")
        .select("*")
        .eq("position", "PG")
        .eq("stat_type", "pts")
        .eq("defense_team_name", `Miami Heat`);
      if (error) throw error;
      insights.insight_3_positional_defense = data;
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // INSIGHT 4: Home vs Away
    try {
      const { data: homeGames } = await supabase
        .from("games")
        .select("id")
        .eq("home_team_id", team_id);

      const homeIDs = homeGames.map((g) => g.id);

      const { data: homeStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", homeIDs);

      const homeValid = homeStats.filter((g) => g.min && parseInt(g.min) >= 10);
      const homeAvg = homeValid.reduce((sum, g) => sum + (g.pts || 0), 0) / homeValid.length;

      const { data: awayGames } = await supabase
        .from("games")
        .select("id")
        .eq("visitor_team_id", team_id);

      const awayIDs = awayGames.map((g) => g.id);

      const { data: awayStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", awayIDs);

      const awayValid = awayStats.filter((g) => g.min && parseInt(g.min) >= 10);
      const awayAvg = awayValid.reduce((sum, g) => sum + (g.pts || 0), 0) / awayValid.length;

      insights.insight_4_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2),
      };
    } catch (err) {
      insights.insight_4_home_vs_away = { error: err.message };
    }

    // INSIGHT 5: Matchup History vs Opponent (null-safe)
    try {
      const { data: rawStats } = await supabase
        .from("player_stats")
        .select("game_id, game_date, pts")
        .eq("player_id", player_id)
        .neq("pts", null);

      const playerGames = rawStats.filter(
        (g) => typeof g.game_id === "number" && !isNaN(g.game_id)
      );

      const gameIds = playerGames.map((g) => g.game_id);

      const { data: gamesRaw } = await supabase
        .from("games")
        .select("id, home_team_id, visitor_team_id")
        .in("id", gameIds);

      const { data: teamLookup } = await supabase
        .from("teams")
        .select("id, abbreviation");

      const teamMap = Object.fromEntries(teamLookup.map(t => [t.id, t.abbreviation]));
      const oppTeamId = teamLookup.find(t => t.abbreviation === opponentAbbr)?.id;
      const matchupIds = new Set(
        gamesRaw.filter(g => g.home_team_id === oppTeamId || g.visitor_team_id === oppTeamId).map(g => g.id)
      );

      insights.insight_5_matchup_history = playerGames
        .filter(g => matchupIds.has(g.game_id))
        .map(g => ({
          game_date: g.game_date,
          matchup: `${teamMap[gamesRaw.find(x => x.id === g.game_id).home_team_id]} vs ${teamMap[gamesRaw.find(x => x.id === g.game_id).visitor_team_id]}`,
          points_scored: g.pts
        }));
    } catch (err) {
      insights.insight_5_matchup_history = { error: err.message };
    }

    // INSIGHT 6: Injury Report
    try {
      const { data: team } = await supabase
        .from("teams")
        .select("id")
        .eq("abbreviation", teamAbbrForInjuries)
        .maybeSingle();

      const { data: injuries } = await supabase
        .from("player_injuries")
        .select("first_name, last_name, position, status, return_date, description")
        .eq("team_id", team.id);

      insights.insight_6_injury_report = injuries;
    } catch (err) {
      insights.insight_6_injury_report = { error: err.message };
    }

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
