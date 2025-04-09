// /api/points.js

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

  let { player, line, teamAbbrForInjuries } = req.body;

  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  if (!teamAbbrForInjuries) teamAbbrForInjuries = "LAL";

  // Parse the player's name into firstName + lastName
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // Fetch the player's row from the "players" table
    const { data: playerRow } = await supabase
      .from("players")
      .select("player_id, team_id, position")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (!playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id, position: fallbackPosition } = playerRow;
    const insights = {};

    // Fetch the next game (based on the current date/time)
    const today = new Date().toISOString();
    const { data: upcomingGames } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id")
      .gt("date", today)
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    const nextGame = upcomingGames?.[0];
    const opponentTeamId =
      nextGame?.home_team_id === team_id
        ? nextGame?.visitor_team_id
        : nextGame?.home_team_id;

    // Fetch the opponent's team data
    const { data: opponentTeam } = await supabase
      .from("teams")
      .select("full_name, abbreviation")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const opponentAbbr = opponentTeam?.abbreviation;

    // --------------------------------------------------
    // Insight 1: Last 10 Hit Rate
    // --------------------------------------------------
    try {
      const { data } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(10);

      const valid = (data || []).filter((g) => g.min && parseInt(g.min) >= 10);
      const hits = valid.filter((g) => (g.pts || 0) > line).length;

      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: valid.length,
        hitRatePercent: valid.length
          ? ((hits / valid.length) * 100).toFixed(1)
          : "0",
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    // --------------------------------------------------
    // Insight 2: Season Avg vs Last 3
    // --------------------------------------------------
    try {
      const { data: seasonStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);

      const seasonValid = (seasonStats || []).filter(
        (g) => g.min && parseInt(g.min) >= 10
      );

      const seasonAvg =
        seasonValid.reduce((sum, g) => sum + (g.pts || 0), 0) /
        (seasonValid.length || 1);

      const { data: last3Stats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);

      const last3Valid = (last3Stats || []).filter(
        (g) => g.min && parseInt(g.min) >= 10
      );

      const avg3 =
        last3Valid.reduce((sum, g) => sum + (g.pts || 0), 0) /
        (last3Valid.length || 1);

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1),
      };
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // --------------------------------------------------
    // Insight 3: Positional Defense
    // --------------------------------------------------
    try {
      const { data: activeRow } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activeRow?.true_position || fallbackPosition || "PG";

      const { data: defenseRankings } = await supabase
        .from("positional_defense_rankings")
        .select("*")
        .eq("position", playerPosition)
        .eq("stat_type", "pts")
        .eq("defense_team_name", opponentTeam?.full_name);

      insights.insight_3_positional_defense = defenseRankings;
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // --------------------------------------------------
    // Insight 4: Matchup History vs Opponent
    // --------------------------------------------------
    try {
      // Find all game IDs where the upcoming opponent was involved
      const { data: matchupGames } = await supabase
        .from("games")
        .select("id")
        .or(`home_team_id.eq.${opponentTeamId},visitor_team_id.eq.${opponentTeamId}`);

      const opponentGameIds = matchupGames?.map((g) => g.id) || [];

      // Filter player_stats by these game IDs
      const { data: matchupStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .in("game_id", opponentGameIds);

      // Exclude games under 10 minutes played
      const validGames = (matchupStats || []).filter(
        (g) => g.min && parseInt(g.min) >= 10
      );

      const ptsList = validGames.map((g) => g.pts || 0);
      const avg = ptsList.length
        ? +(ptsList.reduce((a, b) => a + b, 0) / ptsList.length).toFixed(1)
        : null;

      insights.insight_4_matchup_history = {
        games_played: ptsList.length,
        points_per_game: avg,
        points_list: ptsList,
      };
    } catch (err) {
      insights.insight_4_matchup_history = { error: err.message };
    }

    // --------------------------------------------------
    // Insight 5: Home vs Away
    // --------------------------------------------------
    try {
      const { data: gameStats } = await supabase
        .from("player_stats")
        .select("pts, min, game_id")
        .eq("player_id", player_id);

      const gameIds =
        gameStats?.map((g) => g.game_id).filter((id) => typeof id === "number") ||
        [];

      const { data: games } = await supabase
        .from("games")
        .select("id, home_team_id")
        .in("id", gameIds);

      const gameMap = Object.fromEntries(
        (games || []).map((g) => [g.id, g.home_team_id])
      );

      const home = [];
      const away = [];

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

    // --------------------------------------------------
    // Insight 7: Injury Report (both teams)
    // --------------------------------------------------
    try {
      const teamIds = [team_id, opponentTeamId].filter(Boolean);

      const { data: injuries } = await supabase
        .from("player_injuries")
        .select(
          "player_id, first_name, last_name, position, status, return_date, description, team_id"
        )
        .in("team_id", teamIds);

      insights.insight_7_injury_report = injuries || [];
    } catch (err) {
      insights.insight_7_injury_report = { error: err.message };
    }

    // --------------------------------------------------
    // Advanced Metric #1: Projected Game Pace (manual possession calc)
    // --------------------------------------------------
    try {
      // Fetch all "Final" games
      const { data: finalGames } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");

      const gameMap = {};
      finalGames.forEach((g) => {
        gameMap[g.id] = g;
      });

      // Grab box scores from these final games
      const { data: finalBox } = await supabase
        .from("box_scores")
        .select("team_id, game_date, player_id, fga, fta, oreb, turnover")
        .in(
          "game_date",
          finalGames.map((g) => g.date)
        );

      // Build possessions for each team in each game
      const posMap = {};
      for (const row of finalBox || []) {
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

      // Sum possessions by team
      const teamPosTotals = {};
      Object.values(posMap).forEach(({ team_id, possessions }) => {
        if (!teamPosTotals[team_id]) {
          teamPosTotals[team_id] = { sum: 0, count: 0 };
        }
        teamPosTotals[team_id].sum += possessions;
        teamPosTotals[team_id].count += 1;
      });

      // Grab team metadata
      const { data: teamMeta } = await supabase
        .from("teams")
        .select("id, abbreviation");

      const abbrToId = {};
      const idToAbbr = {};

      teamMeta.forEach((t) => {
        abbrToId[t.abbreviation] = t.id;
        idToAbbr[t.id] = t.abbreviation;
      });

      const t1Id = team_id;
      const t2Id = opponentTeamId;

      const t1Avg =
        teamPosTotals[t1Id] && teamPosTotals[t1Id].count > 0
          ? teamPosTotals[t1Id].sum / teamPosTotals[t1Id].count
          : 0;

      const t2Avg =
        teamPosTotals[t2Id] && teamPosTotals[t2Id].count > 0
          ? teamPosTotals[t2Id].sum / teamPosTotals[t2Id].count
          : 0;

      const projected_game_pace = +((t1Avg + t2Avg) / 2).toFixed(2);

      insights.advanced_metric_1_projected_game_pace = {
        team_1: idToAbbr[t1Id] || "??",
        team_2: idToAbbr[t2Id] || "??",
        projected_game_pace,
      };
    } catch (err) {
      insights.advanced_metric_1_projected_game_pace = { error: err.message };
    }

    // --------------------------------------------------
    // Advanced Metric #2: Team Pace Rankings
    // --------------------------------------------------
    try {
      // Fetch all "Final" games
      const { data: finalGames } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");

      // Grab box scores from these final games
      const { data: finalBox } = await supabase
        .from("box_scores")
        .select("team_id, game_date, fga, fta, oreb, turnover")
        .in(
          "game_date",
          finalGames.map((g) => g.date)
        );

      // Build possessions for each team in each final game
      const posMap = {};
      for (const row of finalBox || []) {
        const gm = finalGames.find(
          (g) =>
            g.date === row.game_date &&
            (g.home_team_id === row.team_id || g.visitor_team_id === row.team_id)
        );
        if (!gm) continue;

        const key = `${row.team_id}_${gm.id}`;
        if (!posMap[key]) {
          posMap[key] = { team_id: row.team_id, possessions: 0 };
        }

        const fga = row.fga || 0;
        const fta = row.fta || 0;
        const oreb = row.oreb || 0;
        const to = row.turnover || 0;

        posMap[key].possessions += fga + 0.44 * fta - oreb + to;
      }

      // Sum up possessions by team
      const teamTotals = {};
      Object.values(posMap).forEach(({ team_id, possessions }) => {
        if (!teamTotals[team_id]) {
          teamTotals[team_id] = { sum: 0, count: 0 };
        }
        teamTotals[team_id].sum += possessions;
        teamTotals[team_id].count += 1;
      });

      // Sort teams by average possessions per game
      const { data: teamMeta } = await supabase
        .from("teams")
        .select("id, abbreviation");

      const ranked = Object.entries(teamTotals)
        .map(([id, { sum, count }]) => {
          return {
            team_id: +id,
            abbreviation:
              teamMeta.find((t) => t.id === +id)?.abbreviation || "??",
            avg_possessions_per_game: +(sum / count).toFixed(2),
          };
        })
        .sort((a, b) => b.avg_possessions_per_game - a.avg_possessions_per_game);

      // Assign pace ranks (1 = fastest pace)
      ranked.forEach((team, idx) => {
        team.pace_rank = idx + 1;
      });

      const opponentStats = ranked.find((t) => t.team_id === opponentTeamId);

      insights.advanced_metric_2_opponent_pace_rank = opponentStats || {
        error: "Opponent pace rank not found",
      };
    } catch (err) {
      insights.advanced_metric_2_opponent_pace_rank = { error: err.message };
    }

    // --------------------------------------------------
    // Advanced Metric #3: Points Allowed by Position (Last 5 Games)
    // --------------------------------------------------
    try {
      const { data: activeRow } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activeRow?.true_position || fallbackPosition || "PG";

      // Check the "positional_defense_last5" table
      const { data: recentDefense } = await supabase
        .from("positional_defense_last5")
        .select("avg_allowed, games_sampled, rank")
        .eq("defense_team_id", opponentTeamId)
        .eq("position", playerPosition)
        .eq("stat_type", "pts")
        .maybeSingle();

      if (recentDefense) {
        insights.advanced_metric_3_pts_allowed_last_5 = {
          position: playerPosition,
          avg_points: recentDefense.avg_allowed,
          games_sampled: recentDefense.games_sampled,
          rank: recentDefense.rank,
          summary: `Over the last ${recentDefense.games_sampled} games, ${playerPosition}s are averaging ${recentDefense.avg_allowed} PPG vs this team (Rank ${recentDefense.rank} defense vs ${playerPosition}s).`,
        };
      } else {
        insights.advanced_metric_3_pts_allowed_last_5 = {
          error: `No recent ${playerPosition} points allowed data found.`,
        };
      }
    } catch (err) {
      insights.advanced_metric_3_pts_allowed_last_5 = { error: err.message };
    }

    // Return all the insights
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
