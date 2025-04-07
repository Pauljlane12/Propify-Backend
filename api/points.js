// /api/points.js
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: true,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("🔥 /api/points was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  let {
    player,
    line,
    opponentAbbr,        // e.g. 'MIA' for Insight #5
    teamAbbrForInjuries, // e.g. 'LAL' for Insight #6
  } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // If not provided by the user, set a fallback
  if (!opponentAbbr) {
    console.warn("No 'opponentAbbr' provided; defaulting to 'MIA'");
    opponentAbbr = "MIA";
  }
  if (!teamAbbrForInjuries) {
    console.warn("No 'teamAbbrForInjuries' provided; defaulting to 'LAL'");
    teamAbbrForInjuries = "LAL";
  }

  // Split the player's name
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // --------------------------------------------
    // 1) Look up the player
    // --------------------------------------------
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr) {
      console.error("❌ Error looking up player:", playerErr);
      return res.status(500).json({ error: "Error fetching player" });
    }
    if (!playerRow) {
      console.warn("❌ Player not found:", firstName, lastName);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;
    if (player_id == null || team_id == null) {
      console.warn("❌ player_id/team_id is null:", playerRow);
      return res
        .status(400)
        .json({ error: "Invalid player data: missing player_id or team_id" });
    }

    // Collect all insights here
    const insights = {};

    // --------------------------------------------
    // INSIGHT #1: Last 10-Game Hit Rate
    // --------------------------------------------
    try {
      const { data: last10Stats, error: e1 } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);

      if (e1) throw e1;

      const valid = last10Stats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );

      const total = valid.length;
      const hits = valid.filter((g) => (g.pts || 0) > line).length;
      const hitRatePercent = total > 0 ? ((hits / total) * 100).toFixed(1) : "0";

      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: total,
        hitRatePercent,
      };
      console.log("✅ insight_1_hit_rate computed");
    } catch (err) {
      console.error("❌ Error in insight_1_hit_rate:", err);
      insights.insight_1_hit_rate = `Error: ${err.message}`;
    }

    // --------------------------------------------
    // INSIGHT #2: Season Average vs Last 3 Games
    // --------------------------------------------
    try {
      // Entire season
      const { data: seasonStats, error: e2a } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);
      if (e2a) throw e2a;

      const validSeason = seasonStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const seasonSum = validSeason.reduce((sum, g) => sum + (g.pts || 0), 0);
      const seasonAvg =
        validSeason.length > 0 ? seasonSum / validSeason.length : 0;

      // Last 3
      const { data: last3Stats, error: e2b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);
      if (e2b) throw e2b;

      const validLast3 = last3Stats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const sumLast3 = validLast3.reduce((sum, g) => sum + (g.pts || 0), 0);
      const avgLast3 =
        validLast3.length > 0 ? sumLast3 / validLast3.length : 0;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avgLast3.toFixed(1),
      };
      console.log("✅ insight_2_season_vs_last3 computed");
    } catch (err) {
      console.error("❌ Error in insight_2_season_vs_last3:", err);
      insights.insight_2_season_vs_last3 = `Error: ${err.message}`;
    }

    // --------------------------------------------
    // INSIGHT #3: Positional Defense (PG vs Miami)
    // --------------------------------------------
    try {
      const { data: precompRows, error: precompErr } = await supabase
        .from("positional_defense_rankings")
        .select("*")
        .eq("position", "PG")
        .eq("stat_type", "pts")
        .eq("defense_team_name", "Miami Heat");

      if (precompErr) throw precompErr;

      insights.insight_3_positional_defense = precompRows;
      console.log("✅ insight_3_positional_defense (PG vs MIA) fetched");
    } catch (err) {
      console.error("❌ Error in insight_3_positional_defense:", err);
      insights.insight_3_positional_defense = `Error: ${err.message}`;
    }

    // --------------------------------------------
    // INSIGHT #4: Home vs Away Performance
    // --------------------------------------------
    try {
      // HOME game IDs
      const { data: homeGames, error: e4a } = await supabase
        .from("games")
        .select("id")
        .eq("home_team_id", team_id);
      if (e4a) throw e4a;
      const homeIDs = homeGames.map((g) => g.id).filter(Boolean);

      // home stats
      const { data: homeStats, error: e4b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", homeIDs);
      if (e4b) throw e4b;

      const validHome = homeStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const homeSum = validHome.reduce((sum, g) => sum + (g.pts || 0), 0);
      const homeAvg = validHome.length > 0 ? homeSum / validHome.length : 0;

      // AWAY game IDs
      const { data: awayGames, error: e4c } = await supabase
        .from("games")
        .select("id")
        .eq("visitor_team_id", team_id);
      if (e4c) throw e4c;
      const awayIDs = awayGames.map((g) => g.id).filter(Boolean);

      // away stats
      const { data: awayStats, error: e4d } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", awayIDs);
      if (e4d) throw e4d;

      const validAway = awayStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const awaySum = validAway.reduce((sum, g) => sum + (g.pts || 0), 0);
      const awayAvg = validAway.length > 0 ? awaySum / validAway.length : 0;

      insights.insight_4_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2),
      };
      console.log("✅ insight_4_home_vs_away computed");
    } catch (err) {
      console.error("❌ Error in insight_4_home_vs_away:", err);
      insights.insight_4_home_vs_away = `Error: ${err.message}`;
    }

    // --------------------------------------------
    // INSIGHT #5: Matchup History vs. Specific Opponent
    // (Band-aid: skip rows with "null" in integer columns)
    // --------------------------------------------
    try {
      // 1) Fetch the player's stats
      const { data: rawPlayerGames, error: e5a } = await supabase
        .from("player
