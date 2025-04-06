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

  const { player, line } = req.body;
  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // Split the player's name into first and last
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 1) Fetch player info
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr) {
      console.error("❌ Error fetching player:", playerErr);
      return res.status(500).json({ error: "Error looking up player" });
    }
    if (!playerRow) {
      console.warn("❌ No matching player found:", firstName, lastName);
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;
    if (player_id == null || team_id == null) {
      console.warn("❌ Invalid player data (null IDs):", playerRow);
      return res.status(400).json({
        error: "Player data is incomplete: missing player_id or team_id",
      });
    }

    // Prepare an object to hold all your insights
    const insights = {};

    // ----------------------------------------------------------------
    // INSIGHT #1: Last 10-Game Hit Rate
    // ----------------------------------------------------------------
    try {
      const { data: last10Stats, error: e1 } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);

      if (e1) throw e1;

      // Filter out games with <10 minutes played
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

    // ----------------------------------------------------------------
    // INSIGHT #2: Season Average vs. Last 3
    // ----------------------------------------------------------------
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

    // ----------------------------------------------------------------
    // INSIGHT #5: Home vs. Away Performance
    // ----------------------------------------------------------------
    try {
      // HOME game IDs
      const { data: homeGames, error: e5a } = await supabase
        .from("games")
        .select("id")
        .eq("home_team_id", team_id);
      if (e5a) throw e5a;
      const homeIDs = homeGames.map((g) => g.id).filter(Boolean);

      // Stats in home games
      const { data: homeStats, error: e5b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", homeIDs);
      if (e5b) throw e5b;

      const validHome = homeStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const homeSum = validHome.reduce((sum, g) => sum + (g.pts || 0), 0);
      const homeAvg = validHome.length > 0 ? homeSum / validHome.length : 0;

      // AWAY game IDs
      const { data: awayGames, error: e5c } = await supabase
        .from("games")
        .select("id")
        .eq("visitor_team_id", team_id);
      if (e5c) throw e5c;
      const awayIDs = awayGames.map((g) => g.id).filter(Boolean);

      // Stats in away games
      const { data: awayStats, error: e5d } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", awayIDs);
      if (e5d) throw e5d;

      const validAway = awayStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const awaySum = validAway.reduce((sum, g) => sum + (g.pts || 0), 0);
      const awayAvg = validAway.length > 0 ? awaySum / validAway.length : 0;

      insights.insight_5_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2),
      };
      console.log("✅ insight_5_home_vs_away computed");
    } catch (err) {
      console.error("❌ Error in insight_5_home_vs_away:", err);
      insights.insight_5_home_vs_away = `Error: ${err.message}`;
    }

    // ----------------------------------------------------------------
    // INSIGHT #3: Team Defense vs PGs (from positional_defense_rankings)
    // ----------------------------------------------------------------
    try {
      // Instead of computing from box_scores, just fetch from your precomputed table
      const { data, error } = await supabase
        .from("positional_defense_rankings")
        .select(
          "defense_team_id, defense_team_name, avg_allowed, games_sampled, rank"
        )
        .eq("position", "PG") // or pass position dynamically if needed
        .eq("stat_type", "pts"); // or "points" or whatever you used

      if (error) throw error;

      insights.insight_3_team_defense_vs_pgs = data;
      console.log("✅ insight_3_team_defense_vs_pgs fetched from positional_defense_rankings");
    } catch (err) {
      console.error("❌ Error in insight_3_team_defense_vs_pgs:", err);
      insights.insight_3_team_defense_vs_pgs = `Error: ${err.message}`;
    }

    // Return all insights
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
