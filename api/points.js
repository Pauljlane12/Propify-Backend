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
    // 1) Look up the player's ID/ team_id
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
    const insights = {};

    // --------------------------------------------------------
    // INSIGHT #1: Last 10 Game Hit Rate
    // --------------------------------------------------------
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
      const hits = valid.filter((g) => g.pts > line).length;
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

    // --------------------------------------------------------
    // INSIGHT #2: Season Average vs Last 3 Games
    // --------------------------------------------------------
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
      const seasonAvg = validSeason.length > 0 ? seasonSum / validSeason.length : 0;

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
      const avgLast3 = validLast3.length > 0 ? sumLast3 / validLast3.length : 0;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avgLast3.toFixed(1),
      };
      console.log("✅ insight_2_season_vs_last3 computed");
    } catch (err) {
      console.error("❌ Error in insight_2_season_vs_last3:", err);
      insights.insight_2_season_vs_last3 = `Error: ${err.message}`;
    }

    // --------------------------------------------------------
    // INSIGHT #5: Home vs Away Performance
    // (We do 2 queries: homeGames => homeStats, awayGames => awayStats)
    // --------------------------------------------------------
    try {
      // 1) Home game IDs
      const { data: homeGames, error: e5a } = await supabase
        .from("games")
        .select("id")
        .eq("home_team_id", team_id);
      if (e5a) throw e5a;
      const homeIDs = homeGames.map((g) => g.id);

      // 2) home stats
      const { data: homeStats, error: e5b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", homeIDs);
      if (e5b) throw e5b;
      const validHome = homeStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const homeSum = validHome.reduce((sum, x) => sum + (x.pts || 0), 0);
      const homeAvg = validHome.length > 0 ? homeSum / validHome.length : 0;

      // 3) Away game IDs
      const { data: awayGames, error: e5c } = await supabase
        .from("games")
        .select("id")
        .eq("visitor_team_id", team_id);
      if (e5c) throw e5c;
      const awayIDs = awayGames.map((g) => g.id);

      // 4) away stats
      const { data: awayStats, error: e5d } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", awayIDs);
      if (e5d) throw e5d;
      const validAway = awayStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const awaySum = validAway.reduce((sum, x) => sum + (x.pts || 0), 0);
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

    // --------------------------------------------------------
    // INSIGHT #3: Team Defense vs PGs
    // (League-wide approach: sum PG points, find defense_team_id, rank them.)
    // We'll replicate your multi-CTE snippet in Node.
    // --------------------------------------------------------
    try {
      // 1) Get all PG box scores
      const { data: rawPGBoxScores, error: e3a } = await supabase
        .from("box_scores")
        .select("player_id, pts, team_id, game_id, position")
        .eq("position", "PG")
        .neq("pts", null);
      if (e3a) throw e3a;

      // 2) Get all games
      const { data: allGames, error: e3b } = await supabase
        .from("games")
        .select("id, home_team_id, visitor_team_id");
      if (e3b) throw e3b;

      const gameMap = {};
      allGames.forEach((g) => {
        gameMap[g.id] = g;
      });

      // 3) Compute defense_team_id
      const allPGStats = rawPGBoxScores.map((bs) => {
        const g = gameMap[bs.game_id];
        if (!g) return null;
        let defenseTeamId;
        if (bs.team_id === g.home_team_id) {
          defenseTeamId = g.visitor_team_id;
        } else {
          defenseTeamId = g.home_team_id;
        }
        return {
          ...bs,
          defense_team_id: defenseTeamId,
        };
      }).filter(Boolean);

      // 4) Group by (defense_team_id, game_id) => sum PG points
      const grouped = {};
      for (const row of allPGStats) {
        const key = `${row.defense_team_id}_${row.game_id}`;
        if (!grouped[key]) {
          grouped[key] = {
            defense_team_id: row.defense_team_id,
            game_id: row.game_id,
            total_pg_pts: 0,
          };
        }
        grouped[key].total_pg_pts += row.pts || 0;
      }
      const pgPointsByGame = Object.values(grouped);

      // 5) Group by defense_team_id => average
      const defMap = {};
      for (const record of pgPointsByGame) {
        const defId = record.defense_team_id;
        if (!defMap[defId]) {
          defMap[defId] = { sum: 0, count: 0 };
        }
        defMap[defId].sum += record.total_pg_pts;
        defMap[defId].count += 1;
      }

      const pgDefenseByTeam = [];
      for (const defId in defMap) {
        const { sum, count } = defMap[defId];
        const avg_pg_pts_allowed = count > 0 ? sum / count : 0;
        pgDefenseByTeam.push({
          defense_team_id: +defId,
          games_sampled: count,
          avg_pg_pts_allowed: +avg_pg_pts_allowed.toFixed(2),
        });
      }

      // 6) Join with teams => defense_team name
      const { data: allTeams, error: e3c } = await supabase
        .from("teams")
        .select("id, full_name");
      if (e3c) throw e3c;
      const teamMap = {};
      allTeams.forEach((t) => {
        teamMap[t.id] = t.full_name;
      });

      pgDefenseByTeam.forEach((item) => {
        item.defense_team = teamMap[item.defense_team_id] || "Unknown";
      });

      // 7) Sort + rank
      pgDefenseByTeam.sort((a, b) => a.avg_pg_pts_allowed - b.avg_pg_pts_allowed);
      pgDefenseByTeam.forEach((item, idx) => {
        item.rank = idx + 1;
      });

      // We'll store this entire array in the insights object
      insights.insight_3_team_defense_vs_pgs = pgDefenseByTeam;
      console.log("✅ insight_3_team_defense_vs_pgs computed (league-wide)");
    } catch (err) {
      console.error("❌ Error in insight_3_team_defense_vs_pgs:", err);
      insights.insight_3_team_defense_vs_pgs = `Error: ${err.message}`;
    }

    // Return all insights in one response
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
