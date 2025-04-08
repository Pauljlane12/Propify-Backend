// /api/points-query.js
const { OpenAI } = require("openai");
const { Pool } = require("pg");

// Setup Postgres client using the connection string
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_CONNECTION_STRING,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanGPTSQL(response) {
  let sql = response.trim();

  // Remove code block wrappers like ```sql ... ```
  sql = sql.replace(/.*```sql\s*/i, '').replace(/```$/, '').trim();

  // If GPT still adds explanation, start from WITH or SELECT
  const firstKeyword = sql.search(/\b(WITH|SELECT)\b/i);
  if (firstKeyword > 0) {
    sql = sql.slice(firstKeyword);
  }

  return sql;
}

async function pointsQueryHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { player, opponentAbbr } = req.body;

  if (!player || !opponentAbbr) {
    return res.status(400).json({ error: "Missing player or opponentAbbr" });
  }

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  const insights = {};

  try {
    // ---------------------------------------------
    // Insight #6: Matchup History vs Opponent
    // ---------------------------------------------
    const matchupPrompt = `Write a PostgreSQL query to show how many points ${player} has scored against ${opponentAbbr} in past matchups.
Return the game_date, matchup label (e.g., LAL vs MIA), and pts. Use tables: player_stats, players, games, and teams. Order by game_date DESC.`;

    const matchupQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a SQL assistant. Use PostgreSQL syntax."
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
      console.log("🧠 RAW GPT SQL (Matchup):", rawMatchupSQL);
      console.log("✅ CLEANED SQL (Matchup):", matchupSQL);
    }

    const { rows: matchupResult } = await pool.query(matchupSQL);
    insights.insight_6_matchup_history = matchupResult;
  } catch (err) {
    console.error("❌ Insight 6 FULL ERROR:", err);
    insights.insight_6_matchup_history = { error: err.message };
  }

  try {
    // ---------------------------------------------
    // Advanced Metric #3: Last 5 Games vs Position
    // ---------------------------------------------
    const defensePrompt = `Write a PostgreSQL query that calculates how many points ${opponentAbbr} has allowed to opposing players at the same position as ${player}'s true_position (from active_players) over their last 5 final games.
Use box_scores, games, and active_players. Use the possessions formula: fga + 0.44 * fta - oreb + turnover. Return average points allowed.`;

    const defenseQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a SQL assistant. Use PostgreSQL syntax."
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
      console.log("🧠 RAW GPT SQL (Defense):", rawDefenseSQL);
      console.log("✅ CLEANED SQL (Defense):", defenseSQL);
    }

    const { rows: defenseResult } = await pool.query(defenseSQL);
    insights.advanced_metric_3_last5_defense = defenseResult;
  } catch (err) {
    console.error("❌ Advanced Metric 3 FULL ERROR:", err);
    insights.advanced_metric_3_last5_defense = { error: err.message };
  }

  return res.status(200).json({ player, opponentAbbr, insights });
}

module.exports = pointsQueryHandler;
