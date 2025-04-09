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

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // Fetch player row
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

    // Find upcoming game for the player's team
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

    const { data: opponentTeam } = await supabase
      .from("teams")
      .select("full_name, abbreviation")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const opponentAbbr = opponentTeam?.abbreviation;

    // -----------------------------
    // Insight 1: Last 10 Hit Rate
    // -----------------------------
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
        hitRatePercent: valid.length ? ((hits / valid.length) * 100).toFixed(1) : "0",
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    // -----------------------------
    // Insight 2: Season Avg vs Last 3
    // -----------------------------
    let last3Valid = [];
    try {
      // Season
      const { data: seasonStats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id);

      const seasonValid = (seasonStats || []).filter(
        (g) => g.min && parseInt(g.min) >= 10
      );
      const seasonAvg =
        seasonValid.reduce((sum, g) => sum + (g.pts || 0), 0) / seasonValid.length || 0;

      // Last 3
      const { data: last3Stats } = await supabase
        .from("player_stats")
        .select("pts, min")
        .eq("player_id", player_id)
        .order("game_date", { ascending: false })
        .limit(3);

      last3Valid = (last3Stats || []).filter(
        (g) => g.min && parseInt(g.min) >= 10
      );
      const avg3 =
        last3Valid.reduce((sum, g) => sum + (g.pts || 0), 0) / last3Valid.length || 0;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1),
      };
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // -----------------------------
    // Insight 3: Positional Defense
    // -----------------------------
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

    // -----------------------------
    // Insight 4: Matchup History
    // -----------------------------
    try {
      const { data: matchupHistory } = await supabase
        .from("player_matchup_flat")
        .select("games_played, avg_value, hit_rate, stat_list")
        .eq("player_id", player_id)
        .eq("opponent_team_id", opponentTeamId)
        .eq("stat_type", "pts")
        .maybeSingle();

      if (matchupHistory) {
        insights.insight_4_matchup_history = matchupHistory;
      } else {
        insights.insight_4_matchup_history = {
          error: "No matchup history found for this stat.",
        };
      }
    } catch (err) {
      insights.insight_4_matchup_history = { error: err.message };
    }

    // -----------------------------
    // Insight 5: Home vs Away
    // -----------------------------
    try {
      const { data: gameStats } = await supabase
        .from("player_stats")
        .select("pts, min, game_id")
        .eq("player_id", player_id);

      const gameIds = (gameStats || [])
        .map((g) => g.game_id)
        .filter((id) => typeof id === "number");

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

    // -----------------------------
    // Insight 7: Injury Report
    // -----------------------------
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

    // -----------------------------
    // Advanced Metric #1: Projected Game Pace
    // -----------------------------
    try {
      const { data: finalGames } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");

      const gameMap = {};
      finalGames?.forEach((g) => {
        gameMap[g.id] = g;
      });

      const { data: finalBox } = await supabase
        .from("box_scores")
        .select("team_id, game_date, fga, fta, oreb, turnover")
        .in("game_date", finalGames.map((g) => g.date));

      const posMap = {};
      for (const row of finalBox || []) {
        const foundGame = finalGames.find(
          (gm) =>
            gm.date === row.game_date &&
            (gm.home_team_id === row.team_id || gm.visitor_team_id === row.team_id)
        );
        if (!foundGame) continue;

        const key = `${row.team_id}_${foundGame.id}`;
        if (!posMap[key]) {
          posMap[key] = { team_id: row.team_id, possessions: 0 };
        }

        posMap[key].possessions +=
          (row.fga || 0) + 0.44 * (row.fta || 0) - (row.oreb || 0) + (row.turnover || 0);
      }

      const teamPosTotals = {};
      Object.values(posMap).forEach(({ team_id, possessions }) => {
        if (!teamPosTotals[team_id]) {
          teamPosTotals[team_id] = { sum: 0, count: 0 };
        }
        teamPosTotals[team_id].sum += possessions;
        teamPosTotals[team_id].count += 1;
      });

      const t1Avg =
        teamPosTotals[team_id] && teamPosTotals[team_id].count > 0
          ? teamPosTotals[team_id].sum / teamPosTotals[team_id].count
          : 0;
      const t2Avg =
        teamPosTotals[opponentTeamId] && teamPosTotals[opponentTeamId].count > 0
          ? teamPosTotals[opponentTeamId].sum / teamPosTotals[opponentTeamId].count
          : 0;

      insights.advanced_metric_1_projected_game_pace = {
        projected_game_pace: +((t1Avg + t2Avg) / 2).toFixed(2),
      };
    } catch (err) {
      insights.advanced_metric_1_projected_game_pace = { error: err.message };
    }

    // -----------------------------
    // Advanced Metric #2: Team Pace Rankings
    // -----------------------------
    let teamTotals = {};
    try {
      // Reuse finalGames & finalBox from above
      // Make sure they're defined or have fallback
      if (!finalGames || !finalBox) {
        insights.advanced_metric_2_opponent_pace_rank = {
          error: "Missing finalGames or finalBox data",
        };
      } else {
        const posMap = {};
        for (const row of finalBox || []) {
          const foundGame = finalGames.find(
            (gm) =>
              gm.date === row.game_date &&
              (gm.home_team_id === row.team_id ||
                gm.visitor_team_id === row.team_id)
          );
          if (!foundGame) continue;

          const key = `${row.team_id}_${foundGame.id}`;
          if (!posMap[key]) {
            posMap[key] = { team_id: row.team_id, possessions: 0 };
          }

          posMap[key].possessions +=
            (row.fga || 0) +
            0.44 * (row.fta || 0) -
            (row.oreb || 0) +
            (row.turnover || 0);
        }

        teamTotals = {};
        Object.values(posMap).forEach(({ team_id, possessions }) => {
          if (!teamTotals[team_id]) {
            teamTotals[team_id] = { sum: 0, count: 0 };
          }
          teamTotals[team_id].sum += possessions;
          teamTotals[team_id].count += 1;
        });

        const allTeams = Object.entries(teamTotals).map(([id, { sum, count }]) => ({
          team_id: +id,
          avg_possessions_per_game: count > 0 ? sum / count : 0,
        }));

        allTeams.sort((a, b) => b.avg_possessions_per_game - a.avg_possessions_per_game);
        let rank = allTeams.findIndex((t) => t.team_id === opponentTeamId);
        if (rank === -1) {
          insights.advanced_metric_2_opponent_pace_rank = {
            error: "Opponent pace rank not found",
          };
        } else {
          insights.advanced_metric_2_opponent_pace_rank = {
            team_id: opponentTeamId,
            pace_rank: rank + 1, // zero-based index
          };
        }
      }
    } catch (err) {
      insights.advanced_metric_2_opponent_pace_rank = { error: err.message };
    }

    // -----------------------------
    // Advanced Metric #3: Points Allowed by Position (Last 5 Games)
    // -----------------------------
    try {
      const { data: activeRow } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activeRow?.true_position || fallbackPosition || "PG";

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
          summary: `Over the last ${recentDefense.games_sampled} games, ${playerPosition}s are averaging ${recentDefense.avg_allowed} PPG vs this team (Rank ${recentDefense.rank}).`,
        };
      } else {
        insights.advanced_metric_3_pts_allowed_last_5 = {
          error: "No recent positional defense data.",
        };
      }
    } catch (err) {
      insights.advanced_metric_3_pts_allowed_last_5 = { error: err.message };
    }

    // -----------------------------
    // LOG EVERY STAT FOR DEBUGGING
    // -----------------------------
    console.log("✅ Insight 1:", insights.insight_1_hit_rate);
    console.log("✅ Insight 2:", insights.insight_2_season_vs_last3);
    console.log("🔍 Last 3 Game PTS Values:", last3Valid.map((g) => g.pts));
    console.log("✅ Insight 3:", insights.insight_3_positional_defense);
    console.log("✅ Insight 4:", insights.insight_4_matchup_history);
    // (Note that Insight 6 doesn't exist, so skipping)
    console.log("✅ Insight 5:", insights.insight_5_home_vs_away);
    console.log("✅ Insight 7:", insights.insight_7_injury_report);
    console.log("✅ Advanced Metric 1:", insights.advanced_metric_1_projected_game_pace);
    console.log("✅ Advanced Metric 2:", insights.advanced_metric_2_opponent_pace_rank);
    console.log("✅ Advanced Metric 3:", insights.advanced_metric_3_pts_allowed_last_5);
    console.log("🚀 Final insight payload:", JSON.stringify(insights, null, 2));

    // Return final response
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
