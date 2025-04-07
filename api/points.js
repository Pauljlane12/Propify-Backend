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
    opponentAbbr,        // e.g. 'MIA' for Insight #6
    teamAbbrForInjuries, // e.g. 'LAL' for Insight #7
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
    // 1) Look up the player
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

    // Collect all insights in an object
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
    // INSIGHT #5: Home vs Away Performance
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
    // INSIGHT #6: Matchup History vs. Specific Opponent
    // Always runs, with a default if user didn’t provide opponentAbbr
    // ----------------------------------------------------------------
    try {
      // 1) fetch player's game stats
      const { data: playerGames, error: e6a } = await supabase
        .from("player_stats")
        .select("game_id, game_date, pts")
        .eq("player_id", player_id)
        .neq("pts", null)
        .order("game_date", { ascending: false });
      if (e6a) throw e6a;

      // 2) find opponent team(s) by abbreviation
      const { data: oppTeams, error: e6b } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .ilike("abbreviation", opponentAbbr); // Use the user’s or default
      if (e6b) throw e6b;
      if (!oppTeams || oppTeams.length === 0) {
        throw new Error(`No team found with abbreviation ${opponentAbbr}`);
      }
      const oppTeamIds = oppTeams.map((t) => t.id);

      // 3) get all relevant games
      const gameIds = playerGames.map((g) => g.game_id).filter(Boolean);
      const { data: fullGames, error: e6c } = await supabase
        .from("games")
        .select("id, home_team_id, visitor_team_id, date")
        .in("id", gameIds);
      if (e6c) throw e6c;

      // filter to only those with home_team_id or visitor_team_id in oppTeamIds
      const relevantGameIds = new Set(
        fullGames
          .filter(
            (gm) =>
              oppTeamIds.includes(gm.home_team_id) ||
              oppTeamIds.includes(gm.visitor_team_id)
          )
          .map((g) => g.id)
      );

      // build a map for matchup strings
      const { data: allTeams, error: e6d } = await supabase
        .from("teams")
        .select("id, abbreviation");
      if (e6d) throw e6d;

      const teamAbbrMap = {};
      allTeams.forEach((t) => {
        if (t.id != null) {
          teamAbbrMap[t.id] = t.abbreviation;
        }
      });

      const gameMap = {};
      fullGames.forEach((g) => {
        const homeAb = teamAbbrMap[g.home_team_id] || "??";
        const visitorAb = teamAbbrMap[g.visitor_team_id] || "??";
        gameMap[g.id] = `${homeAb} vs ${visitorAb}`;
      });

      // build final array
      const matchupHistory = playerGames
        .filter((pg) => relevantGameIds.has(pg.game_id))
        .map((pg) => ({
          game_date: pg.game_date,
          matchup: gameMap[pg.game_id] || "",
          points_scored: pg.pts,
        }));

      insights.insight_6_matchup_history = matchupHistory;
      console.log("✅ insight_6_matchup_history computed");
    } catch (err) {
      console.error("❌ Error in insight_6_matchup_history:", err);
      insights.insight_6_matchup_history = `Error: ${err.message}`;
    }

    // ----------------------------------------------------------------
    // INSIGHT #7: Injury Report – Key Player Absences
    // Always runs, with a default if user didn’t provide teamAbbrForInjuries
    // ----------------------------------------------------------------
    try {
      // 1) find team_id from abbreviation
      const { data: injTeam, error: i7a } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .ilike("abbreviation", teamAbbrForInjuries)
        .maybeSingle();
      if (i7a) throw i7a;
      if (!injTeam) {
        throw new Error(`No team found with abbreviation ${teamAbbrForInjuries}`);
      }

      // 2) get all injuries for that team
      const { data: rawInjuries, error: i7b } = await supabase
        .from("player_injuries")
        .select("player_id, first_name, last_name, position, status, return_date, description")
        .eq("team_id", injTeam.id);
      if (i7b) throw i7b;

      // 3) for each injured player, see if they have played after return_date
      const outPlayers = [];
      for (const inj of rawInjuries) {
        if (!inj.return_date) {
          // indefinite
          outPlayers.push(inj);
          continue;
        }

        const returnStr = `${inj.return_date} 2025`; // example year
        const potentialReturn = new Date(returnStr);
        if (isNaN(potentialReturn.getTime())) {
          // can't parse => consider them out
          outPlayers.push(inj);
          continue;
        }

        const isoDate = potentialReturn.toISOString().slice(0, 10);

        const { data: recentGames, error: i7c } = await supabase
          .from("player_stats")
          .select("game_date")
          .eq("player_id", inj.player_id)
          .gte("game_date", isoDate);
        if (i7c) {
          console.error("Error checking stats for inj:", inj.player_id);
          // fallback => consider them out
          outPlayers.push(inj);
          continue;
        }

        if (!recentGames || recentGames.length === 0) {
          outPlayers.push(inj);
        }
      }

      insights.insight_7_injury_report = outPlayers.map((x) => ({
        player_id: x.player_id,
        player_name: `${x.first_name} ${x.last_name}`.trim(),
        position: x.position,
        status: x.status,
        return_date: x.return_date,
        description: x.description,
      }));
      console.log("✅ insight_7_injury_report computed");
    } catch (err) {
      console.error("❌ Error in insight_7_injury_report:", err);
      insights.insight_7_injury_report = `Error: ${err.message}`;
    }

    // Return all insights
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
