// /api/points.js (CommonJS, skipping 'null' gameIds before .in(...) calls)
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
  if (!opponentAbbr) {
    console.warn("No 'opponentAbbr' provided; defaulting to 'MIA'");
    opponentAbbr = "MIA";
  }
  if (!teamAbbrForInjuries) {
    console.warn("No 'teamAbbrForInjuries' provided; defaulting to 'LAL'");
    teamAbbrForInjuries = "LAL";
  }

  // Split player's name
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 1) Lookup player
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
      return res.status(400).json({
        error: "Invalid player data: missing player_id or team_id",
      });
    }

    const insights = {};

    // --------------------------------------------------------
    // INSIGHT #1: Last 10-Game Hit Rate
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

    // --------------------------------------------------------
    // INSIGHT #2: Season Average vs Last 3
    // --------------------------------------------------------
    try {
      const { data: seasonStats, error: e2a } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);
      if (e2a) throw e2a;

      const valid = seasonStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const sumSeason = valid.reduce((acc, g) => acc + (g.pts || 0), 0);
      const seasonAvg = valid.length > 0 ? sumSeason / valid.length : 0;

      const { data: last3Stats, error: e2b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);
      if (e2b) throw e2b;

      const valid3 = last3Stats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const sum3 = valid3.reduce((acc, g) => acc + (g.pts || 0), 0);
      const avg3 = valid3.length > 0 ? sum3 / valid3.length : 0;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1),
      };
      console.log("✅ insight_2_season_vs_last3 computed");
    } catch (err) {
      console.error("❌ Error in insight_2_season_vs_last3:", err);
      insights.insight_2_season_vs_last3 = `Error: ${err.message}`;
    }

    // --------------------------------------------------------
    // INSIGHT #3: Positional Defense (PG vs Miami)
    // --------------------------------------------------------
    try {
      const { data: precompRows, error: e3 } = await supabase
        .from("positional_defense_rankings")
        .select("*")
        .eq("position", "PG")
        .eq("stat_type", "pts")
        .eq("defense_team_name", "Miami Heat");

      if (e3) throw e3;
      insights.insight_3_positional_defense = precompRows;
      console.log("✅ insight_3_positional_defense fetched");
    } catch (err) {
      console.error("❌ Error in insight_3_positional_defense:", err);
      insights.insight_3_positional_defense = `Error: ${err.message}`;
    }

    // --------------------------------------------------------
    // INSIGHT #4: Home vs. Away
    // --------------------------------------------------------
    try {
      const { data: homeGames, error: e4a } = await supabase
        .from("games")
        .select("id")
        .eq("home_team_id", team_id);
      if (e4a) throw e4a;
      const homeIDs = homeGames.map((g) => g.id).filter(Boolean);

      const { data: homeStats, error: e4b } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", homeIDs);
      if (e4b) throw e4b;

      const validHome = homeStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const sumHome = validHome.reduce((s, g) => s + (g.pts || 0), 0);
      const avgHome = validHome.length > 0 ? sumHome / validHome.length : 0;

      const { data: awayGames, error: e4c } = await supabase
        .from("games")
        .select("id")
        .eq("visitor_team_id", team_id);
      if (e4c) throw e4c;
      const awayIDs = awayGames.map((g) => g.id).filter(Boolean);

      const { data: awayStats, error: e4d } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", awayIDs);
      if (e4d) throw e4d;

      const validAway = awayStats.filter(
        (g) => g.min && /^\d+$/.test(g.min) && parseInt(g.min, 10) >= 10
      );
      const sumAway = validAway.reduce((s, g) => s + (g.pts || 0), 0);
      const avgAway = validAway.length > 0 ? sumAway / validAway.length : 0;

      insights.insight_4_home_vs_away = {
        home: +avgHome.toFixed(2),
        away: +avgAway.toFixed(2),
      };
      console.log("✅ insight_4_home_vs_away computed");
    } catch (err) {
      console.error("❌ Error in insight_4_home_vs_away:", err);
      insights.insight_4_home_vs_away = `Error: ${err.message}`;
    }

    // --------------------------------------------------------
    // INSIGHT #5: Matchup History vs Opponent
    // (Remove 'null' from gameIds before .in()!)
    // --------------------------------------------------------
    try {
      const { data: pgRaw, error: e5a } = await supabase
        .from("player_stats")
        .select("game_id, game_date, pts")
        .eq("player_id", player_id)
        .neq("pts", null)
        .order("game_date", { ascending: false });
      if (e5a) throw e5a;

      // Filter out any row where game_id is 'null' so it doesn't appear in .in() call
      const playerGames = pgRaw.filter(
        (g) => g.game_id !== "null" && typeof g.game_id === "number"
      );

      // Opponent teams
      const { data: oppRaw, error: e5b } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .ilike("abbreviation", opponentAbbr);
      if (e5b) throw e5b;
      // Also skip if team id is 'null'
      const oppTeams = oppRaw.filter(
        (t) => t.id !== "null" && typeof t.id === "number"
      );
      if (!oppTeams.length) {
        throw new Error(`No team found for abbreviation ${opponentAbbr}`);
      }
      const oppTeamIds = oppTeams.map((t) => t.id);

      // The game IDs we pass to .in() must also skip 'null'
      const gameIds = playerGames.map((g) => g.game_id);
      // Now fetch the actual games
      const { data: gamesRaw, error: e5c } = await supabase
        .from("games")
        .select("id, home_team_id, visitor_team_id, date")
        .in("id", gameIds);
      if (e5c) throw e5c;

      // Filter out any row with 'null' for id/home_team_id/visitor_team_id
      const fullGames = gamesRaw.filter(
        (gm) =>
          gm.id !== "null" &&
          typeof gm.id === "number" &&
          gm.home_team_id !== "null" &&
          typeof gm.home_team_id === "number" &&
          gm.visitor_team_id !== "null" &&
          typeof gm.visitor_team_id === "number"
      );

      // Keep only those games that have the opponent team
      const relevantGameIds = new Set(
        fullGames
          .filter(
            (gm) =>
              oppTeamIds.includes(gm.home_team_id) ||
              oppTeamIds.includes(gm.visitor_team_id)
          )
          .map((gm) => gm.id)
      );

      // Build an ID => abbr map
      const { data: allTeamsRaw, error: e5d } = await supabase
        .from("teams")
        .select("id, abbreviation");
      if (e5d) throw e5d;

      const allTeams = allTeamsRaw.filter(
        (t) => t.id !== "null" && typeof t.id === "number"
      );
      const teamAbbrMap = {};
      allTeams.forEach((t) => {
        teamAbbrMap[t.id] = t.abbreviation || "??";
      });

      // Build a game => "ABC vs XYZ" label
      const gameMap = {};
      fullGames.forEach((gm) => {
        const homeAb = teamAbbrMap[gm.home_team_id] || "??";
        const visAb = teamAbbrMap[gm.visitor_team_id] || "??";
        gameMap[gm.id] = `${homeAb} vs ${visAb}`;
      });

      // Final array
      const matchupHistory = playerGames
        .filter((pg) => relevantGameIds.has(pg.game_id))
        .map((pg) => ({
          game_date: pg.game_date,
          matchup: gameMap[pg.game_id] || "",
          points_scored: pg.pts,
        }));

      insights.insight_5_matchup_history = matchupHistory;
      console.log("✅ insight_5_matchup_history computed");
    } catch (err) {
      console.error("❌ Error in insight_5_matchup_history:", err);
      insights.insight_5_matchup_history = `Error: ${err.message}`;
    }

    // --------------------------------------------------------
    // INSIGHT #6: Injury Report
    // --------------------------------------------------------
    try {
      const { data: injTeam, error: i6a } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .ilike("abbreviation", teamAbbrForInjuries)
        .maybeSingle();
      if (i6a) throw i6a;
      if (!injTeam) {
        throw new Error(
          `No team found with abbreviation ${teamAbbrForInjuries}`
        );
      }

      const { data: rawInjuries, error: i6b } = await supabase
        .from("player_injuries")
        .select(
          "player_id, first_name, last_name, position, status, return_date, description"
        )
        .eq("team_id", injTeam.id);
      if (i6b) throw i6b;

      const outPlayers = [];
      for (const inj of rawInjuries) {
        if (!inj.return_date) {
          outPlayers.push(inj);
          continue;
        }
        const returnStr = `${inj.return_date} 2025`;
        const potDate = new Date(returnStr);
        if (isNaN(potDate.getTime())) {
          outPlayers.push(inj);
          continue;
        }

        const isoDate = potDate.toISOString().slice(0, 10);
        const { data: recentGames, error: i6c } = await supabase
          .from("player_stats")
          .select("game_date")
          .eq("player_id", inj.player_id)
          .gte("game_date", isoDate);
        if (i6c) {
          console.error("Error checking stats for inj:", inj.player_id);
          outPlayers.push(inj);
          continue;
        }

        if (!recentGames || recentGames.length === 0) {
          outPlayers.push(inj);
        }
      }

      insights.insight_6_injury_report = outPlayers.map((x) => ({
        player_id: x.player_id,
        player_name: `${x.first_name} ${x.last_name}`.trim(),
        position: x.position,
        status: x.status,
        return_date: x.return_date,
        description: x.description,
      }));
      console.log("✅ insight_6_injury_report computed");
    } catch (err) {
      console.error("❌ Error in insight_6_injury_report:", err);
      insights.insight_6_injury_report = `Error: ${err.message}`;
    }

    // Return final result
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
