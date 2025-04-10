// /api/points.js
const { createClient } = require("@supabase/supabase-js");
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1) Hardcode your current & last season
const CURRENT_SEASON = 2025; // e.g. for 2025–2026
const LAST_SEASON = 2024;    // e.g. for 2024–2025

// 2) Define small helper functions for fallback logic
async function countPlayerSeasonGames(playerId, season) {
  // Returns how many games the player has in that season
  const { data, error } = await supabase
    .from("player_stats")
    .select("id")  // or game_id
    .eq("player_id", playerId)
    .eq("season", season);

  if (error) {
    console.error("❌ Error in countPlayerSeasonGames:", error.message);
    return 0;
  }
  return data.length;
}

async function fetchLast10Games(playerId, season) {
  // Grabs the last 10 games from a specific season
  const { data, error } = await supabase
    .from("player_stats")
    .select("pts, min, game_date")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("game_date", { ascending: false })
    .limit(10);

  if (error) {
    console.error("❌ Error in fetchLast10Games:", error.message);
    return [];
  }
  return data;
}

async function fetchAllSeasonStats(playerId, season) {
  // Grabs all season stats for a player (≥0 min, let the filter happen after if you want)
  const { data, error } = await supabase
    .from("player_stats")
    .select("pts, min, game_date")
    .eq("player_id", playerId)
    .eq("season", season);

  if (error) {
    console.error("❌ Error in fetchAllSeasonStats:", error.message);
    return [];
  }
  return data;
}

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

  // Split first & last name
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // (1) Identify the Player
    const { data: playerRow, error: playerErr } = await supabase
      .from("players")
      .select("player_id, team_id, position")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerErr) {
      console.error("❌ Error finding player:", playerErr.message);
      return res.status(500).json({ error: playerErr.message });
    }
    if (!playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id, position: fallbackPosition } = playerRow;
    const insights = {};

    // (2) Next Game for this player's team (unchanged from your script)
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

    // -------------------------------------------------
    // FALLBACK LOGIC: Count how many current-season games
    // -------------------------------------------------
    const currentSeasonCount = await countPlayerSeasonGames(player_id, CURRENT_SEASON);
    console.log(`Player has ${currentSeasonCount} games in ${CURRENT_SEASON} season`);

    // -----------------------------
    // INSIGHT 1: Last 10 Hit Rate (≥10 min) w/ Fallback
    // -----------------------------
    try {
      let last10;
      if (currentSeasonCount < 10) {
        // Fallback to last season
        console.log("Fewer than 10 games in current season => fallback");
        last10 = await fetchLast10Games(player_id, LAST_SEASON);
      } else {
        // Use current season
        last10 = await fetchLast10Games(player_id, CURRENT_SEASON);
      }

      const valid = last10.filter((g) => g.min && parseInt(g.min, 10) >= 10);
      const hits = valid.filter((g) => (g.pts || 0) > line).length;

      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: valid.length,
        hitRatePercent: valid.length
          ? ((hits / valid.length) * 100).toFixed(1)
          : "0",
        fallbackUsed: currentSeasonCount < 10
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    // -----------------------------
    // INSIGHT 2: Season Avg vs Last 3 (≥10 min) w/ Fallback
    // -----------------------------
    let last3Valid = [];
    try {
      // If the player has 0 games in current season => fallback
      if (currentSeasonCount === 0) {
        console.log("No current-season games => fallback to last season for average");
        const allLastSeason = await fetchAllSeasonStats(player_id, LAST_SEASON);

        // filter <10 min
        const valid = allLastSeason.filter(
          (g) => g.min && parseInt(g.min, 10) >= 10
        );
        const sum = valid.reduce((acc, cur) => acc + (cur.pts || 0), 0);
        const fallbackSeasonAvg = valid.length ? sum / valid.length : 0;

        // No last-3 logic if there's no current-season data
        insights.insight_2_season_vs_last3 = {
          seasonAvg: +fallbackSeasonAvg.toFixed(1),
          last3Avg: 0,
          fallbackUsed: true
        };
      } else {
        // Use current season stats
        const allCurrent = await fetchAllSeasonStats(player_id, CURRENT_SEASON);
        const validCurrent = allCurrent.filter(
          (g) => g.min && parseInt(g.min, 10) >= 10
        );

        // Full-season average
        const sumSeason = validCurrent.reduce((acc, cur) => acc + (cur.pts || 0), 0);
        const seasonAvg = validCurrent.length ? sumSeason / validCurrent.length : 0;

        // Last 3
        // Sort desc by game_date
        validCurrent.sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
        last3Valid = validCurrent.slice(0, 3);
        const sumLast3 = last3Valid.reduce((acc, cur) => acc + (cur.pts || 0), 0);
        const avg3 = last3Valid.length ? sumLast3 / last3Valid.length : 0;

        insights.insight_2_season_vs_last3 = {
          seasonAvg: +seasonAvg.toFixed(1),
          last3Avg: +avg3.toFixed(1),
          fallbackUsed: false
        };
      }
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // -------------------------------------------------
    // INSIGHT 3: Full-Season Positional Defense (no fallback)
    // -------------------------------------------------
    try {
      const { data: activeRow } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activeRow?.true_position || fallbackPosition || "PG";

      const { data: seasonRow, error: seasonError } = await supabase
        .from("positional_defense_rankings_top_minute")
        .select("points_allowed, points_allowed_rank, games_sampled, defense_team_name")
        .eq("position", playerPosition)
        .eq("defense_team_name", opponentTeam?.full_name)
        .maybeSingle();

      if (seasonError) {
        insights.insight_3_positional_defense = { error: seasonError.message };
      } else if (!seasonRow) {
        insights.insight_3_positional_defense = {
          info: "No full-season data found for this team/position.",
        };
      } else {
        insights.insight_3_positional_defense = {
          points_allowed: seasonRow.points_allowed,
          rank: seasonRow.points_allowed_rank,
          games_sampled: seasonRow.games_sampled,
          summary: `This season, ${playerPosition}s have averaged ${seasonRow.points_allowed} PPG vs the ${seasonRow.defense_team_name}, ranking #${seasonRow.points_allowed_rank} in the NBA.`,
        };
      }
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // -----------------------------
    // INSIGHT 4: Matchup History (Flattened) (no fallback)
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
    // INSIGHT 5: Home vs Away (≥10 min) (no fallback)
    // -----------------------------
    try {
      const { data: allStats } = await supabase
        .from("player_stats")
        .select("pts, min, game_id")
        .eq("player_id", player_id);

      const filtered = (allStats || []).filter((g) => {
        if (!g.min) return false;
        return parseInt(g.min, 10) >= 10 && g.pts != null;
      });

      const gameIds = filtered
        .map((x) => x.game_id)
        .filter((id) => typeof id === "number");

      const { data: gameRows } = await supabase
        .from("games")
        .select("id, home_team_id")
        .in("id", gameIds);

      const gameMap = Object.fromEntries(
        (gameRows || []).map((gm) => [gm.id, gm.home_team_id])
      );

      const home = [];
      const away = [];
      for (const gs of filtered) {
        const isHome = gameMap[gs.game_id] === team_id;
        (isHome ? home : away).push(gs.pts);
      }

      const homeAvg = home.length
        ? home.reduce((acc, cur) => acc + cur, 0) / home.length
        : 0;
      const awayAvg = away.length
        ? away.reduce((acc, cur) => acc + cur, 0) / away.length
        : 0;

      insights.insight_5_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2),
      };
    } catch (err) {
      insights.insight_5_home_vs_away = { error: err.message };
    }

    // (No INSIGHT 6)
    // -----------------------------
    // INSIGHT 7: Injury Report (no fallback)
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
    // ADVANCED Metric #1: Projected Game Pace
    // (unchanged from your script)
    // -----------------------------
    let finalGames, finalBox;
    try {
      const { data: g } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id")
        .eq("status", "Final");
      finalGames = g || [];

      const { data: b } = await supabase
        .from("box_scores")
        .select("team_id, game_date, fga, fta, oreb, turnover")
        .in("game_date", finalGames.map((gm) => gm.date));
      finalBox = b || [];

      const posMap = {};
      for (const row of finalBox) {
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
          (row.fga || 0) +
          0.44 * (row.fta || 0) -
          (row.oreb || 0) +
          (row.turnover || 0);
      }

      const teamPosTotals = {};
      Object.values(posMap).forEach(({ team_id, possessions }) => {
        if (!teamPosTotals[team_id]) {
          teamPosTotals[team_id] = { sum: 0, count: 0 };
        }
        teamPosTotals[team_id].sum += possessions;
        teamPosTotals[team_id].count += 1;
      });

      const t1 = teamPosTotals[team_id];
      const t2 = teamPosTotals[opponentTeamId];

      const t1Avg = t1 && t1.count > 0 ? t1.sum / t1.count : 0;
      const t2Avg = t2 && t2.count > 0 ? t2.sum / t2.count : 0;

      insights.advanced_metric_1_projected_game_pace = {
        projected_game_pace: +((t1Avg + t2Avg) / 2).toFixed(2),
      };
    } catch (err) {
      insights.advanced_metric_1_projected_game_pace = { error: err.message };
    }

    // -----------------------------
    // ADVANCED Metric #2: Team Pace Rankings
    // (unchanged from your script)
    // -----------------------------
    try {
      if (!finalGames || !finalBox) {
        insights.advanced_metric_2_opponent_pace_rank = {
          error: "Missing finalGames or finalBox data",
        };
      } else {
        const posMap = {};
        for (const row of finalBox) {
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
            (row.fga || 0) +
            0.44 * (row.fta || 0) -
            (row.oreb || 0) +
            (row.turnover || 0);
        }

        const teamTotals = {};
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
        let rankIndex = allTeams.findIndex((x) => x.team_id === opponentTeamId);
        if (rankIndex === -1) {
          insights.advanced_metric_2_opponent_pace_rank = {
            error: "Opponent pace rank not found",
          };
        } else {
          insights.advanced_metric_2_opponent_pace_rank = {
            team_id: opponentTeamId,
            pace_rank: rankIndex + 1,
          };
        }
      }
    } catch (err) {
      insights.advanced_metric_2_opponent_pace_rank = { error: err.message };
    }

    // -------------------------------------------------
    // DEBUG
    // -------------------------------------------------
    console.log("🚀 Final insight payload:", JSON.stringify(insights, null, 2));
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
