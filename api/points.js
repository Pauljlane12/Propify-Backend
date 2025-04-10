// /api/points.js
const { createClient } = require("@supabase/supabase-js");

// 1) Create supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 2) Hardcode current season as an integer
// e.g. 2024 => 2024-2025 NBA season
const CURRENT_SEASON = 2024;

async function pointsHandler(req, res) {
  console.log("🔥 /api/points was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, line, teamAbbrForInjuries } = req.body;
  if (!player || typeof line !== "number") {
    return res.status(400).json({ error: "Missing or invalid player or line" });
  }

  // If user doesn’t pass teamAbbrForInjuries, default to "LAL"
  const finalTeamAbbr = teamAbbrForInjuries || "LAL";

  // 3) Parse player name
  const [firstName, ...lastNameArr] = player.trim().split(" ");
  const lastName = lastNameArr.join(" ");

  try {
    // -------------------------------------------------
    // (1) Identify the Player
    // -------------------------------------------------
    const { data: playerRow, error: playerError } = await supabase
      .from("players")
      .select("player_id, team_id, position")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (playerError) {
      console.error("❌ Error finding player:", playerError.message);
      return res.status(500).json({ error: playerError.message });
    }
    if (!playerRow) {
      return res.status(404).json({ error: "Player not found" });
    }

    const { player_id, team_id, position: fallbackPosition } = playerRow;
    const insights = {};

    // -------------------------------------------------
    // (2) Next Game for this player's team (in 2024 season)
    // -------------------------------------------------
    const nowIso = new Date().toISOString();
    const { data: upcomingGames, error: nextGameErr } = await supabase
      .from("games")
      .select("id, date, home_team_id, visitor_team_id, season")
      // must match the 2024 season
      .eq("season", CURRENT_SEASON)
      // only future games (date > now)
      .gt("date", nowIso)
      // team must be home OR visitor
      .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
      .order("date", { ascending: true })
      .limit(1);

    if (nextGameErr) {
      console.error("❌ Error finding next game:", nextGameErr.message);
      // Not fatal, we can continue if no next game
    }

    const nextGame = upcomingGames?.[0];
    let opponentTeamId = null;
    if (nextGame) {
      opponentTeamId =
        nextGame.home_team_id === team_id
          ? nextGame.visitor_team_id
          : nextGame.home_team_id;
    }

    // 4) Lookup the opponent
    let opponentTeam;
    if (opponentTeamId) {
      const { data: oppTeam } = await supabase
        .from("teams")
        .select("full_name, abbreviation")
        .eq("id", opponentTeamId)
        .maybeSingle();
      opponentTeam = oppTeam;
    }

    // -------------------------------------------------
    // INSIGHT 1: Last 10 Hit Rate (≥10 min), only 2024 season
    // -------------------------------------------------
    try {
      const { data, error: insight1Err } = await supabase
        .from("player_stats")
        .select("pts, min, game_date, season")
        .eq("player_id", player_id)
        .eq("season", CURRENT_SEASON)
        .order("game_date", { ascending: false })
        .limit(10);

      if (insight1Err) {
        throw new Error(insight1Err.message);
      }

      const valid = (data || []).filter(g => parseInt(g.min, 10) >= 10);
      const hits = valid.filter(g => (g.pts || 0) > line).length;

      insights.insight_1_hit_rate = {
        overHits: hits,
        totalGames: valid.length,
        hitRatePercent: valid.length
          ? ((hits / valid.length) * 100).toFixed(1)
          : "0"
      };
    } catch (err) {
      insights.insight_1_hit_rate = { error: err.message };
    }

    // -------------------------------------------------
    // INSIGHT 2: Season Avg vs Last 3 (≥10 min), only 2024
    // -------------------------------------------------
    let last3Valid = [];
    try {
      const { data: allStats, error: insight2Err } = await supabase
        .from("player_stats")
        .select("pts, min, game_date, season")
        .eq("player_id", player_id)
        .eq("season", CURRENT_SEASON);

      if (insight2Err) {
        throw new Error(insight2Err.message);
      }

      // Filter <10 min
      const seasonValid = (allStats || []).filter(g => parseInt(g.min, 10) >= 10);
      // Season average
      const sumSeason = seasonValid.reduce((acc, cur) => acc + (cur.pts || 0), 0);
      const seasonAvg = seasonValid.length ? sumSeason / seasonValid.length : 0;

      // sort desc by game_date, slice last 3
      seasonValid.sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
      last3Valid = seasonValid.slice(0, 3);

      const sumLast3 = last3Valid.reduce((acc, cur) => acc + (cur.pts || 0), 0);
      const avg3 = last3Valid.length ? sumLast3 / last3Valid.length : 0;

      insights.insight_2_season_vs_last3 = {
        seasonAvg: +seasonAvg.toFixed(1),
        last3Avg: +avg3.toFixed(1)
      };
    } catch (err) {
      insights.insight_2_season_vs_last3 = { error: err.message };
    }

    // -------------------------------------------------
    // INSIGHT 3: Full-Season Positional Defense, only 2024
    // -------------------------------------------------
    try {
      const { data: activePos } = await supabase
        .from("active_players")
        .select("true_position")
        .eq("player_id", player_id)
        .maybeSingle();

      const playerPosition = activePos?.true_position || fallbackPosition || "PG";

      if (!opponentTeam?.full_name) {
        insights.insight_3_positional_defense = {
          info: "No upcoming opponent found or no full season data."
        };
      } else {
        // Query the 'positional_defense_rankings_top_minute' for season=2024 if that table has a season col
        // If that table does not have a season col, remove the eq("season", CURRENT_SEASON)
        const { data: seasonRow, error: posDefErr } = await supabase
          .from("positional_defense_rankings_top_minute")
          .select("points_allowed, points_allowed_rank, games_sampled, defense_team_name, season")
          .eq("position", playerPosition)
          .eq("defense_team_name", opponentTeam.full_name)
          // If you store season here, add:
          .eq("season", CURRENT_SEASON)
          .maybeSingle();

        if (posDefErr) {
          insights.insight_3_positional_defense = { error: posDefErr.message };
        } else if (!seasonRow) {
          insights.insight_3_positional_defense = {
            info: "No full-season positional data for this team/position in 2024."
          };
        } else {
          insights.insight_3_positional_defense = {
            points_allowed: seasonRow.points_allowed,
            rank: seasonRow.points_allowed_rank,
            games_sampled: seasonRow.games_sampled,
            summary: `In the ${CURRENT_SEASON} season, ${playerPosition}s have averaged ${seasonRow.points_allowed} PPG vs the ${seasonRow.defense_team_name}, ranking #${seasonRow.points_allowed_rank} in the NBA.`
          };
        }
      }
    } catch (err) {
      insights.insight_3_positional_defense = { error: err.message };
    }

    // -------------------------------------------------
    // INSIGHT 4: Matchup History (Flattened), only 2024 if you store season there
    // -------------------------------------------------
    try {
      if (!opponentTeamId) {
        insights.insight_4_matchup_history = {
          info: "No upcoming opponent, skipping matchup data."
        };
      } else {
        // If your 'player_matchup_flat' includes a 'season' column, add eq("season", CURRENT_SEASON)
        const { data: matchupHistory, error: matchErr } = await supabase
          .from("player_matchup_flat")
          .select("games_played, avg_value, hit_rate, stat_list, season")
          .eq("player_id", player_id)
          .eq("opponent_team_id", opponentTeamId)
          .eq("stat_type", "pts")
          // .eq("season", CURRENT_SEASON) // if you store a season
          .maybeSingle();

        if (matchErr) {
          throw new Error(matchErr.message);
        }

        if (matchupHistory) {
          insights.insight_4_matchup_history = matchupHistory;
        } else {
          insights.insight_4_matchup_history = {
            error: "No matchup history found for this stat."
          };
        }
      }
    } catch (err) {
      insights.insight_4_matchup_history = { error: err.message };
    }

    // -------------------------------------------------
    // INSIGHT 5: Home vs Away (≥10 min), only 2024
    // -------------------------------------------------
    try {
      const { data: allStatsHomeAway, error: homeAwayErr } = await supabase
        .from("player_stats")
        .select("pts, min, game_id, season")
        .eq("player_id", player_id)
        .eq("season", CURRENT_SEASON);

      if (homeAwayErr) {
        throw new Error(homeAwayErr.message);
      }

      const filtered = (allStatsHomeAway || []).filter(g => {
        return g.min && parseInt(g.min, 10) >= 10 && g.pts != null;
      });

      const gameIds = filtered
        .map(x => x.game_id)
        .filter(id => typeof id === "number");

      const { data: gameRows } = await supabase
        .from("games")
        .select("id, home_team_id")
        // .eq("season", CURRENT_SEASON) // if games table also has season
        .in("id", gameIds);

      const gameMap = Object.fromEntries(
        (gameRows || []).map(gm => [gm.id, gm.home_team_id])
      );

      const home = [];
      const away = [];
      for (const gs of filtered) {
        const isHome = gameMap[gs.game_id] === team_id;
        (isHome ? home : away).push(gs.pts);
      }

      const homeAvg = home.length ? home.reduce((acc, cur) => acc + cur, 0) / home.length : 0;
      const awayAvg = away.length ? away.reduce((acc, cur) => acc + cur, 0) / away.length : 0;

      insights.insight_5_home_vs_away = {
        home: +homeAvg.toFixed(2),
        away: +awayAvg.toFixed(2)
      };
    } catch (err) {
      insights.insight_5_home_vs_away = { error: err.message };
    }

    // (No INSIGHT 6)

    // -------------------------------------------------
    // INSIGHT 7: Injury Report (No season filter if your injuries table lacks season)
    // -------------------------------------------------
    try {
      if (!opponentTeamId) {
        insights.insight_7_injury_report = {
          info: "No opponent found, skipping injury report"
        };
      } else {
        const teamIds = [team_id, opponentTeamId].filter(Boolean);
        const { data: injuries, error: injErr } = await supabase
          .from("player_injuries")
          .select(
            "player_id, first_name, last_name, position, status, return_date, description, team_id"
          )
          .in("team_id", teamIds);

        if (injErr) {
          throw new Error(injErr.message);
        }

        insights.insight_7_injury_report = injuries || [];
      }
    } catch (err) {
      insights.insight_7_injury_report = { error: err.message };
    }

    // -------------------------------------------------
    // ADVANCED Metrics #1 & #2: Using 2024 "Final" games
    // -------------------------------------------------
    let finalGames, finalBox;
    try {
      // Grab final 2024 games
      const { data: g, error: adv1err } = await supabase
        .from("games")
        .select("id, date, status, home_team_id, visitor_team_id, season")
        .eq("status", "Final")
        .eq("season", CURRENT_SEASON);

      if (adv1err) {
        throw new Error(adv1err.message);
      }

      finalGames = g || [];

      const { data: b, error: adv1BoxErr } = await supabase
        .from("box_scores")
        .select("team_id, game_date, fga, fta, oreb, turnover")
        .in("game_date", finalGames.map(gm => gm.date));

      if (adv1BoxErr) {
        throw new Error(adv1BoxErr.message);
      }

      finalBox = b || [];

      const posMap = {};
      for (const row of finalBox) {
        const foundGame = finalGames.find(
          gm =>
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
      const t2 = opponentTeamId ? teamPosTotals[opponentTeamId] : null;

      const t1Avg = t1 && t1.count > 0 ? t1.sum / t1.count : 0;
      const t2Avg = t2 && t2.count > 0 ? t2.sum / t2.count : 0;

      insights.advanced_metric_1_projected_game_pace = {
        projected_game_pace: +((t1Avg + t2Avg) / 2).toFixed(2)
      };
    } catch (err) {
      insights.advanced_metric_1_projected_game_pace = { error: err.message };
    }

    try {
      if (!finalGames || !finalBox) {
        insights.advanced_metric_2_opponent_pace_rank = {
          error: "Missing finalGames or finalBox data"
        };
      } else if (!opponentTeamId) {
        insights.advanced_metric_2_opponent_pace_rank = {
          info: "No upcoming opponent, skipping pace rank"
        };
      } else {
        const posMap = {};
        for (const row of finalBox) {
          const foundGame = finalGames.find(
            gm =>
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
          avg_possessions_per_game: count > 0 ? sum / count : 0
        }));

        // Sort from highest to lowest
        allTeams.sort((a, b) => b.avg_possessions_per_game - a.avg_possessions_per_game);

        const rankIndex = allTeams.findIndex(x => x.team_id === opponentTeamId);
        if (rankIndex === -1) {
          insights.advanced_metric_2_opponent_pace_rank = {
            error: "Opponent pace rank not found"
          };
        } else {
          insights.advanced_metric_2_opponent_pace_rank = {
            team_id: opponentTeamId,
            pace_rank: rankIndex + 1
          };
        }
      }
    } catch (err) {
      insights.advanced_metric_2_opponent_pace_rank = { error: err.message };
    }

    // 5) Debug logs + return
    console.log("🚀 Final insight payload:", JSON.stringify(insights, null, 2));
    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error("❌ Unhandled error in /api/points:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsHandler;
