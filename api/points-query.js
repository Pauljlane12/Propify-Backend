// /api/points-query.js
const { OpenAI } = require("openai");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_CONNECTION_STRING,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanGPTSQL(response) {
  let sql = response.trim();

  // Extract SQL from triple backticks if present
  const match = sql.match(/```sql\s*([\s\S]*?)```/i);
  if (match) {
    sql = match[1].trim();
  }

  // Remove any remaining backticks
  sql = sql.replace(/```/g, '').trim();

  // Start at SELECT or WITH
  const start = sql.search(/\b(WITH|SELECT)\b/i);
  if (start > 0) sql = sql.slice(start);

  return sql.trim();
}

async function pointsQueryHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, opponentAbbr } = req.body;

  if (!player || !opponentAbbr) {
    return res.status(400).json({ error: "Missing player or opponentAbbr" });
  }

  const insights = {};

  // Break the player name into first + last
  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // ----------------------------------------------
    // Insight #6: Matchup History vs Opponent
    // ----------------------------------------------
    const matchupPrompt = `
Write a PostgreSQL query to show how many points ${player} has scored against team abbreviation='${opponentAbbr}' in past matchups.

Schema details:
- The "games" table has: (id, date, status, home_team_id, visitor_team_id) -> column name is "date", not "game_date"
- The "player_stats" table has: (pts, game_id, game_date)
- The "teams" table has: (id, abbreviation)
- "team_id" is an integer; to filter by abbreviation='${opponentAbbr}', you must do something like "team_id = (SELECT id FROM teams WHERE abbreviation='${opponentAbbr}')"

Return these fields:
- ps.game_date (the date from player_stats, i.e. ps.game_date)
- A matchup label (like "LAL vs MIA")
- ps.pts
Order by ps.game_date DESC.

DO NOT reference columns that don't exist, e.g. g.game_date. If you want the "games" table date, it's "g.date".
`;


    const matchupQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a SQL assistant. Use only valid columns based on the user's schema."
        },
        {
          role: "user",
          content: matchupPrompt
        }
      ]
    });

    const rawMatchupSQL = matchupQuery.choices[0].message.content;
    const matchupSQL = cleanGPTSQL(rawMatchupSQL);

    if (process.env.DEBUG_MODE === "true") {
      console.log("🧠 Matchup SQL RAW:", rawMatchupSQL);
      console.log("✅ Matchup SQL CLEANED:", matchupSQL);
    }

    const { rows: matchupResult } = await pool.query(matchupSQL);
    insights.insight_6_matchup_history = matchupResult;
  } catch (err) {
    console.error("❌ GPT Matchup SQL Error:", err);
    insights.insight_6_matchup_history = { error: err.message };
  }

  try {
    // -------------------------------------------------
    // Advanced Metric #3: Last 5 Games vs Position
    // -------------------------------------------------
    const defensePrompt = `
Write a PostgreSQL query to calculate how many points the team with abbreviation='${opponentAbbr}' has allowed to players at the same position as ${player}'s true_position in the last 5 final games.

Schema details:
- "games": (id, date, status, home_team_id, visitor_team_id)
- "box_scores": (player_id, pts, team_id, game_date, min)
- "active_players": (player_id, true_position)
- "team_id" is an integer. For abbreviation='${opponentAbbr}', do "team_id = (SELECT id FROM teams WHERE abbreviation='${opponentAbbr}')"
- If referencing the games table's date, it's "g.date", not g.game_date.

Steps:
1. Identify the last 5 games for the team whose abbreviation='${opponentAbbr}' with status='Final'
2. For each game, sum pts for all players whose true_position = ${player}'s true_position
3. Return the average points allowed across those 5 games.

Do not reference columns that don't exist, like g.game_date or player_name.
Use subselects or joins to handle abbreviation -> integer team_id.
`;

    const defenseQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a SQL assistant. Use only valid columns based on the user's schema."
        },
        {
          role: "user",
          content: defensePrompt
        }
      ]
    });

    const rawDefenseSQL = defenseQuery.choices[0].message.content;
    const defenseSQL = cleanGPTSQL(rawDefenseSQL);

    if (process.env.DEBUG_MODE === "true") {
      console.log("🧠 Defense SQL RAW:", rawDefenseSQL);
      console.log("✅ Defense SQL CLEANED:", defenseSQL);
    }

    const { rows: defenseResult } = await pool.query(defenseSQL);
    insights.advanced_metric_3_last5_defense = defenseResult;
  } catch (err) {
    console.error("❌ GPT Defense SQL Error:", err);
    insights.advanced_metric_3_last5_defense = { error: err.message };
  }

  return res.status(200).json({ player, opponentAbbr, insights });
}

module.exports = pointsQueryHandler;
