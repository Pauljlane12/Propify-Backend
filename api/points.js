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

  const { player, line, opponentAbbr, teamAbbrForInjuries } = req.body;
  // ^ You can pass extra fields in your request to handle opponent/team filters
  // For example:
  //   opponentAbbr -> 'MIA' for matchup history
  //   teamAbbrForInjuries -> 'LAL' for the injury insight, etc.

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // Split the player's name into first/last
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 1) Look up the player's ID/team_id
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
      console.warn("❌ player_id/team_id null:", playerRow);
      return res.status(400).json({
        error: "Invalid player data: missing player_id or team_id",
      });
    }

    // Prepare the insights object
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
    // INSIGHT #3: Precomputed positional defense (already done elsewhere)
    // OR old approach with box_scores/games. We'll skip it here to save space.
    // ----------------------------------------------------------------

    // ----------------------------------------------------------------
    // INSIGHT #6: Matchup History vs. Specific Opponent
    // ----------------------------------------------------------------
    // We'll do a simplified multi-query approach:
    // 1) We get all games for this player
    // 2) Filter them to only games where the opponent is "opponentAbbr"
    // 3) Build a result array with (game_date, matchup, points_scored)

    try {
      // If you want the user to pass in 'opponentAbbr' (like 'MIA'), use that
      if (!opponentAbbr) {
        throw new Error(
          "Missing 'opponentAbbr' in request body for matchup history"
        );
      }

      // 1) player_stats => retrieve (game_id, game_date, pts)
      const { data: playerGames, error: e6a } = await supabase
        .from("player_stats")
        .select("game_id, game_date, pts")
        .eq("player_id", player_id)
        .neq("pts", null)
        .order("game_date", { ascending: false });
      if (e6a) throw e6a;

      // 2) get the opponent team id from the abbreviation
      const { data: oppTeams, error: e6b } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .ilike("abbreviation", opponentAbbr); // e.g. 'MIA'
      if (e6b) throw e6b;
      if (!oppTeams || oppTeams.length === 0) {
        throw new Error(`No team found with abbreviation ${opponentAbbr}`);
      }
      const oppTeamIds = oppTeams.map((t) => t.id);

      // 3) get all relevant games for that opponent
      //    i.e., any game where (home_team_id OR visitor_team_id) in oppTeamIds
      // We'll build a map from game_id => game info
      const gameIds = playerGames.map((g) => g.game_id).filter(Boolean);

      const { data: fullGames, error: e6c } = await supabase
        .from("games")
        .select("id, home_team_id, visitor_team_id, date")
        .in("id", gameIds);
      if (e6c) throw e6c;

      // Filter to only games that have the opponent team
      // ( home_team_id in oppTeamIds or visitor_team_id in oppTeamIds )
      // Then build a map: game_id -> { home_abbr, visitor_abbr, date }
      const homeTeamIds = fullGames
        .filter((gm) => oppTeamIds.includes(gm.home_team_id))
        .map((gm) => gm.id);
      const visitorTeamIds = fullGames
        .filter((gm) => oppTeamIds.includes(gm.visitor_team_id))
        .map((gm) => gm.id);
      const relevantGameIds = new Set([...homeTeamIds, ...visitorTeamIds]);

      // We'll also fetch the team abbreviations so we can show "ABC vs XYZ"
      // Build a map from team_id => abbreviation
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

      // Build a map from game_id => matchup string
      const gameMap = {};
      fullGames.forEach((g) => {
        const homeAbbr = teamAbbrMap[g.home_team_id] || "??";
        const visitorAbbr = teamAbbrMap[g.visitor_team_id] || "??";
        const matchupLabel = `${homeAbbr} vs ${visitorAbbr}`;
        gameMap[g.id] = {
          date: g.date,
          matchup: matchupLabel,
        };
      });

      // 4) Build final array for relevant games
      const matchupHistory = playerGames
        .filter((pg) => relevantGameIds.has(pg.game_id))
        .map((pg) => ({
          game_date: pg.game_date,
          matchup: gameMap[pg.game_id]?.matchup || "",
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
    // ----------------------------------------------------------------
    // We'll replicate the idea: "Lists players on a team who are still out"
    // The snippet used: "NOT EXISTS (SELECT 1 FROM player_stats ps WHERE ps.player_id = pi.player_id AND ps.game_date >= ... )"
    // We'll do a simpler multi-step approach: see if there's a post-return-date game in player_stats.
    try {
      if (!teamAbbrForInjuries) {
        throw new Error(
          "Missing 'teamAbbrForInjuries' in request body for injury insight"
        );
      }

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

      // 3) For each injured player, see if they have played (player_stats row) after their return_date
      // The original snippet used "ps.game_date >= TO_DATE(pi.return_date || ' 2025', 'Mon DD YYYY')"
      // We'll assume your return_date is stored like "Mar 03" or "July 10", etc. We'll parse it in Node.
      const outPlayers = [];
      for (const inj of rawInjuries) {
        // if status indicates they're healthy, skip
        // or if return_date is not set, skip
        if (!inj.return_date) {
          // If there's no return date, assume they're indefinite? We'll include them in the outPlayers
          outPlayers.push(inj);
          continue;
        }
        // parse the date so we can compare it
        // We'll guess the year is 2025 for the snippet's sake:
        const returnStr = `${inj.return_date} 2025`; // e.g. "Mar 03 2025"
        const potentialReturn = new Date(returnStr);
        if (isNaN(potentialReturn.getTime())) {
          // If we can't parse, let's just keep them out
          outPlayers.push(inj);
          continue;
        }

        // Now let's see if there's a game_date >= potentialReturn
        const { data: recentGames, error: i7c } = await supabase
          .from("player_stats")
          .select("game_date")
          .eq("player_id", inj.player_id)
          .gte("game_date", potentialReturn.toISOString().slice(0, 10)); // format as "YYYY-MM-DD"

        if (i7c) {
          console.error("Error checking player_stats for player:", inj.player_id);
          // if there's an error, let's assume they haven't returned
          outPlayers.push(inj);
          continue;
        }

        if (!recentGames || recentGames.length === 0) {
          // Means they've not appeared in a game after their return date => still out
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

    // ----------------------------------------------------------------
    // ADVANCED METRIC #1: Projected Game Pace (Two-Team Average)
    // ----------------------------------------------------------------
    // We'll do a multi-step approach to replicate the "team_possessions" => "avg_team_pace" => final join
    // The snippet specifically picks LAL vs MIA, but let's param-ify it or keep it static for now
    try {
      // For example, let's do a quick approach with "LAL" and "MIA" hard-coded
      const team1Abbr = "LAL";
      const team2Abbr = "MIA";

      // 1) team_possessions sub-step: We can do it in memory by pulling final box scores
      const { data: finalGames, error: a1a } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");
      if (a1a) throw a1a;

      // Build a quick lookup: gameId => { date, home_team_id, visitor_team_id }
      const gameMap = {};
      finalGames.forEach((g) => {
        gameMap[g.id] = g;
      });

      // We’ll fetch all box_scores for these final games, then group by (team_id, game_id)
      const finalGameIds = finalGames.map((g) => g.id).filter(Boolean);

      const { data: finalBox, error: a1b } = await supabase
        .from("box_scores")
        .select("team_id, game_date, player_id, fga, fta, oreb, turnover")
        .in("game_date", finalGames.map((g) => g.date));
      // Note: we match on game_date but we also must confirm that team_id matches the same game
      if (a1b) throw a1b;

      // We'll group in memory: key = (team_id, date) => sum possessions
      // possessions = sum(fga) + 0.44 * sum(fta) - sum(oreb) + sum(turnover)
      const posMap = {};
      for (const row of finalBox) {
        // find the actual game record by matching date & team
        // (We might do a more robust approach if there's more than 1 "Final" game on a single date for the same team, but hopefully it’s 1:1 in your data.)
        const gameRecord = finalGames.find(
          (g) =>
            g.date === row.game_date &&
            (g.home_team_id === row.team_id || g.visitor_team_id === row.team_id)
        );
        if (!gameRecord) continue;
        const key = `${row.team_id}_${gameRecord.id}`;
        if (!posMap[key]) {
          posMap[key] = {
            team_id: row.team_id,
            game_id: gameRecord.id,
            possessions: 0,
          };
        }
        const fga = row.fga || 0;
        const fta = row.fta || 0;
        const oreb = row.oreb || 0;
        const to = row.turnover || 0;
        posMap[key].possessions += fga + 0.44 * fta - oreb + to;
      }

      // Now we have possessions by (team_id, game_id).
      // Next we get average by team
      const teamPosTotals = {};
      Object.values(posMap).forEach((entry) => {
        const { team_id, possessions } = entry;
        if (!teamPosTotals[team_id]) {
          teamPosTotals[team_id] = { sum: 0, count: 0 };
        }
        teamPosTotals[team_id].sum += possessions;
        teamPosTotals[team_id].count += 1;
      });

      // get abbreviation => id and id => abbreviation
      const { data: allTeams, error: a1c } = await supabase
        .from("teams")
        .select("id, abbreviation");
      if (a1c) throw a1c;
      const abbrToId = {};
      const idToAbbr = {};
      allTeams.forEach((t) => {
        if (t.id) {
          abbrToId[t.abbreviation] = t.id;
          idToAbbr[t.id] = t.abbreviation;
        }
      });

      const t1Id = abbrToId[team1Abbr];
      const t2Id = abbrToId[team2Abbr];
      if (!t1Id || !t2Id) {
        throw new Error(`One or both team abbreviations not found: ${team1Abbr}, ${team2Abbr}`);
      }

      const t1Avg =
        teamPosTotals[t1Id] && teamPosTotals[t1Id].count > 0
          ? teamPosTotals[t1Id].sum / teamPosTotals[t1Id].count
          : 0;
      const t2Avg =
        teamPosTotals[t2Id] && teamPosTotals[t2Id].count > 0
          ? teamPosTotals[t2Id].sum / teamPosTotals[t2Id].count
          : 0;
      const projected_game_pace = +((t1Avg + t2Avg) / 2).toFixed(2);

      insights.advanced_1_projected_game_pace = {
        team_1: team1Abbr,
        team_2: team2Abbr,
        projected_game_pace,
      };
      console.log("✅ advanced_1_projected_game_pace computed");
    } catch (err) {
      console.error("❌ Error in advanced_1_projected_game_pace:", err);
      insights.advanced_1_projected_game_pace = `Error: ${err.message}`;
    }

    // ----------------------------------------------------------------
    // ADVANCED METRIC #2: Team Pace Rankings
    // ----------------------------------------------------------------
    // We'll reuse the same "possession" logic from above, but produce a ranking
    // In a real scenario, you might want to store this in a table for faster lookups
    try {
      // We can reuse finalGames, finalBox, teamPosTotals from above if we cache them,
      // but for clarity let's re-run them. In production, you'd probably do that once.

      // 1) get all final games
      const { data: finalG2, error: a2a } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");
      if (a2a) throw a2a;

      // 2) get all relevant box_scores for those final games
      const finalG2Ids = finalG2.map((g) => g.id).filter(Boolean);
      const { data: finalBox2, error: a2b } = await supabase
        .from("box_scores")
        .select("team_id, game_date, fga, fta, oreb, turnover")
        .in("game_date", finalG2.map((g) => g.date));
      if (a2b) throw a2b;

      // 3) possessions by (team_id, game_id)
      const posMap2 = {};
      for (const row of finalBox2) {
        const gm = finalG2.find(
          (g) =>
            g.date === row.game_date &&
            (g.home_team_id === row.team_id || g.visitor_team_id === row.team_id)
        );
        if (!gm) continue;
        const key = `${row.team_id}_${gm.id}`;
        if (!posMap2[key]) {
          posMap2[key] = { team_id: row.team_id, possessions: 0 };
        }
        const fga = row.fga || 0;
        const fta = row.fta || 0;
        const oreb = row.oreb || 0;
        const to = row.turnover || 0;
        posMap2[key].possessions += fga + 0.44 * fta - oreb + to;
      }

      // 4) Average possessions for each team
      const teamPosTotals2 = {};
      Object.values(posMap2).forEach((entry) => {
        const { team_id, possessions } = entry;
        if (!teamPosTotals2[team_id]) {
          teamPosTotals2[team_id] = { sum: 0, count: 0 };
        }
        teamPosTotals2[team_id].sum += possessions;
        teamPosTotals2[team_id].count += 1;
      });

      const { data: allTeams2, error: a2c } = await supabase
        .from("teams")
        .select("id, abbreviation");
      if (a2c) throw a2c;

      const paceArray = [];
      for (const tid of Object.keys(teamPosTotals2)) {
        const teamIdNum = parseInt(tid, 10);
        if (!Number.isInteger(teamIdNum)) continue;
        const { sum, count } = teamPosTotals2[tid];
        const avgPos = count > 0 ? sum / count : 0;
        const teamAb = allTeams2.find((tm) => tm.id === teamIdNum)?.abbreviation || "??";
        paceArray.push({
          team_id: teamIdNum,
          team_abbreviation: teamAb,
          games_sampled: count,
          avg_possessions_per_game: +avgPos.toFixed(2),
        });
      }

      // Sort descending by avg_possessions
      paceArray.sort((a, b) => b.avg_possessions_per_game - a.avg_possessions_per_game);
      // rank
      paceArray.forEach((item, idx) => {
        item.pace_rank = idx + 1;
      });

      // Example: If we only want the pace info for 'MIA', we can filter:
      const targetTeam = "MIA";
      const found = paceArray.find((x) => x.team_abbreviation === targetTeam);

      insights.advanced_2_team_pace_rankings = found
        ? {
            pace_rank: found.pace_rank,
            avg_possessions_per_game: found.avg_possessions_per_game,
            abbreviation: targetTeam,
          }
        : `Team ${targetTeam} not found in pace ranking`;

      console.log("✅ advanced_2_team_pace_rankings computed");
    } catch (err) {
      console.error("❌ Error in advanced_2_team_pace_rankings:", err);
      insights.advanced_2_team_pace_rankings = `Error: ${err.message}`;
    }

    // ----------------------------------------------------------------
    // ADVANCED METRIC #3: PG Points Allowed by Heat – Last 5 Games
    // ----------------------------------------------------------------
    // We'll do a multi-step approach: find Heat's last 5 final games, find all PG box scores vs. them, etc.
    try {
      // 1) get Heat team_id
      const { data: heatTeam, error: a3a } = await supabase
        .from("teams")
        .select("id, full_name")
        .ilike("full_name", "Miami Heat")
        .maybeSingle();
      if (a3a) throw a3a;
      if (!heatTeam) throw new Error("No 'Miami Heat' row found in teams");

      // 2) get last 5 final games for the Heat
      const { data: heatGames, error: a3b } = await supabase
        .from("games")
        .select("id, date, home_team_id, visitor_team_id, status")
        .eq("status", "Final")
        .or(`home_team_id.eq.${heatTeam.id},visitor_team_id.eq.${heatTeam.id}`)
        .order("date", { ascending: false })
        .limit(5);
      if (a3b) throw a3b;
      if (!heatGames || heatGames.length === 0) {
        throw new Error("No final games found for the Heat");
      }

      const heatLast5Ids = heatGames.map((g) => g.id);

      // 3) get opposing PG stats in those games
      // We'll rely on `box_scores` + `active_players.true_position` = 'PG'
      // We only want the *other* team, so `bs.team_id != heatTeam.id`
      const { data: oppPGBoxScores, error: a3c } = await supabase
        .from("box_scores")
        .select(
          "player_id, pts, min, game_date, team_id"
        ) // plus we need to confirm position from active_players if we want it accurate
        .neq("pts", null);
      if (a3c) throw a3c;

      // But we do NOT have a direct numeric game_id in box_scores, so let's match by date+team.
      // We'll build a map: date+team => game.id for the last 5 Heat games
      const heatGameMap = {};
      heatGames.forEach((g) => {
        // key for the Heat side
        const dateStr = g.date;
        // We store both the home + visitor
        if (g.home_team_id) {
          heatGameMap[`${dateStr}_${g.home_team_id}`] = g.id;
        }
        if (g.visitor_team_id) {
          heatGameMap[`${dateStr}_${g.visitor_team_id}`] = g.id;
        }
      });

      // Next we only keep box-score rows that match one of these game IDs
      // and where team_id != heatTeam.id
      // But we have to also check if the player is PG. We'll do a second query to active_players
      // or we rely on box_scores.position if it's accurate.
      // If `box_scores.position` is sometimes stale, use `active_players.true_position`.

      // Let's build a quick map of player_id => true_position from active_players
      const { data: allActivePlayers, error: a3d } = await supabase
        .from("active_players")
        .select("player_id, true_position");
      if (a3d) throw a3d;

      const posMap = {};
      allActivePlayers.forEach((ap) => {
        posMap[ap.player_id] = (ap.true_position || "").toUpperCase();
      });

      // filter oppPGBoxScores to the last 5 Heat games + PGs + not the Heat team
      const relevant = oppPGBoxScores.filter((bs) => {
        const gId = heatGameMap[`${bs.game_date}_${bs.team_id}`];
        if (!gId) return false; // not in one of the last 5 Heat final games
        if (bs.team_id === heatTeam.id) return false; // it's the Heat, skip
        const thisPos = posMap[bs.player_id];
        return thisPos === "PG";
      });

      // group by game_id => sum(pts)
      const perGameMap = {};
      for (const row of relevant) {
        const gId = heatGameMap[`${row.game_date}_${row.team_id}`];
        if (!perGameMap[gId]) {
          perGameMap[gId] = {
            game_id: gId,
            total_pg_pts: 0,
          };
        }
        perGameMap[gId].total_pg_pts += row.pts || 0;
      }

      // We have up to 5 games. Let's compute the average
      const allVals = Object.values(perGameMap).map((x) => x.total_pg_pts);
      const sampleCount = allVals.length;
      const sumPG = allVals.reduce((s, v) => s + v, 0);
      const avg_pg_pts_allowed_last_5 =
        sampleCount > 0 ? +(sumPG / sampleCount).toFixed(2) : 0;

      insights.advanced_3_pg_pts_allowed_heat_last5 = {
        defense_team: "Miami Heat",
        games_sampled: sampleCount,
        avg_pg_pts_allowed_last_5,
      };
      console.log("✅ advanced_3_pg_pts_allowed_heat_last5 computed");
    } catch (err) {
      console.error("❌ Error in advanced_3_pg_pts_allowed_heat_last5:", err);
      insights.advanced_3_pg_pts_allowed_heat_last5 = `Error: ${err.message}`;
    }

    // Finally, return the entire insights object
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
