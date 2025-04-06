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
  console.log("🔥 /api/points was hit", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 1) Find player_id from 'players' table
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr) {
      console.error("❌ Supabase error while fetching player:", playerErr);
      return res.status(500).json({ error: "Error looking up player" });
    }
    if (!playerRow) {
      console.warn("❌ No matching player found");
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id } = playerRow;

    // Prepare final results
    const insights = {};

    // ---------------------------------------------------
    // INSIGHT #1: Last 10 Game Hit Rate
    // Instead of raw SQL, we do a direct query
    // Then compute hits in JS.
    // ---------------------------------------------------
    try {
      const { data: last10, error: e1 } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);

      if (e1) {
        throw e1;
      }

      // Filter out any that have min < 10
      const validGames = last10.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );

      const total = validGames.length;
      const hits = validGames.filter((g) => g.pts > line).length;
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) : 0;

      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: total,
        hitRatePercent: hitRate,
      };
      console.log("✅ Computed insight_1_hit_rate from JS logic");
    } catch (err) {
      console.error("❌ Error in insight_1_hit_rate logic:", err);
      insights.insight_1_hit_rate = `Error: ${err.message}`;
    }

    // ---------------------------------------------------
    // INSIGHT #2: Season Average vs Last 3 Games
    // We'll do 2 separate queries: entire season + last 3
    // ---------------------------------------------------
    try {
      // Entire season (pts) where min >= 10
      const { data: seasonAll, error: e2a } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);

      if (e2a) {
        throw e2a;
      }
      const validSeason = seasonAll.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const seasonAvg =
        validSeason.reduce((sum, g) => sum + (g.pts || 0), 0) /
        (validSeason.length || 1);

      // Last 3
      const { data: last3, error: e2b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);

      if (e2b) {
        throw e2b;
      }
      const validLast3 = last3.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const avgLast3 =
        validLast3.reduce((sum, g) => sum + (g.pts || 0), 0) /
        (validLast3.length || 1);

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avgLast3.toFixed(1),
      };
      console.log("✅ Computed insight_2_season_vs_last3 from JS logic");
    } catch (err) {
      console.error("❌ Error in insight_2_season_vs_last3 logic:", err);
      insights.insight_2_season_vs_last3 = `Error: ${err.message}`;
    }

    // ---------------------------------------------------
    // INSIGHT #5: Home vs Away Performance
    // We'll do two queries: home, away
    // We'll interpret 'home' as any game
    // where the player's team_id == games.home_team_id
    // This requires a join or a separate approach.
    // For simplicity, let's do an all stats fetch
    // then do a second table 'games' to find home vs. away.
    // ---------------------------------------------------
    try {
      // We actually need to join 'games' to find which are home vs. away
      // We'll do a single query from 'player_stats' + 'games'
      // using supabase "eq('player_stats.player_id', ...)" and maybe "select(...)"?
      // A simpler approach is to do 2 queries: one for home, one for away
      // if we stored game.home_team_id, game.id, etc. We'll do a basic approach:

      // 1) HOME
      const { data: homeGames, error: e5a } = await supabase
        .from("player_stats")
        .select(`
          pts,
          min,
          game_id,
          team_id,
          games!inner(home_team_id)
        `) // using supabase's foreign table syntax
        .eq("player_id", player_id)
        .eq("games.home_team_id", team_id); // means he's on the home side
      if (e5a) {
        throw e5a;
      }
      const validHome = homeGames.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const homeAvg =
        validHome.reduce((sum, r) => sum + (r.pts || 0), 0) /
        (validHome.length || 1);

      // 2) AWAY
      const { data: awayGames, error: e5b } = await supabase
        .from("player_stats")
        .select(`
          pts,
          min,
          game_id,
          team_id,
          games!inner(visitor_team_id)
        `)
        .eq("player_id", player_id)
        .eq("games.visitor_team_id", team_id); // means he's away side
      if (e5b) {
        throw e5b;
      }
      const validAway = awayGames.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const awayAvg =
        validAway.reduce((sum, r) => sum + (r.pts || 0), 0) /
        (validAway.length || 1);

      insights.insight_5_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2),
      };
      console.log("✅ Computed insight_5_home_vs_away from JS logic");
    } catch (err) {
      console.error("❌ Error in insight_5_home_vs_away logic:", err);
      insights.insight_5_home_vs_away = `Error: ${err.message}`;
    }

    // Return final
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
