// /api/points-query.js
const { OpenAI } = require("openai");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_CONNECTION_STRING,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to fix known GPT mistakes thoroughly
function fixCommonGPTBugs(sql, usePlayerStatsDate = false) {
  // 1) If GPT references "g.game_date", we have two possible replacements:
  //    A) If you want them using the games table:   => "g.date"
  //    B) If you prefer them using player_stats:    => "ps.game_date"
  const replacement = usePlayerStatsDate ? 'ps.game_date' : 'g.date';
  sql = sql.replace(/\bg\.game_date\b/g, replacement);

  // 2) If GPT writes team_id = 'SAS' (or 'MIA', etc.), convert it to subselect
  //    We'll handle strings of 2-4 letters in uppercase
  const teamIdRegex = /team_id\s*=\s*'([A-Z]{2,4})'/g;
  sql = sql.replace(teamIdRegex, (match, abbr) => {
    return `team_id = (SELECT id FROM teams WHERE abbreviation='${abbr}')`;
  });

  // 3) If GPT might do home_team_id = 'MIA' or visitor_team_id = 'BOS'
  //    we can also patch those if you want:
  const altTeamIdRegex = /\b(home_team_id|visitor_team_id)\s*=\s*'([A-Z]{2,4})'/g;
  sql = sql.replace(altTeamIdRegex, (match, col, abbr) => {
    return `${col} = (SELECT id FROM teams WHERE abbreviation='${abbr}')`;
  });

  return sql;
}

function cleanGPTSQL(response, opponentAbbr) {
  let sql = response.trim();

  // 1) Extract from triple backticks if present
  const match = sql.match(/```sql\s*([\s\S]*?)```/i);
  if (match) sql = match[1].trim();

  // 2) Remove leftover backticks
  sql = sql.replace(/```/g, '').trim();

  // 3) Start at SELECT or WITH
  const start = sql.search(/\b(WITH|SELECT)\b/i);
  if (start > 0) sql = sql.slice(start);

  // 4) Force fix GPT mistakes:
  //    Pass "true" if you'd rather everything use "ps.game_date" instead of "g.date"
  sql = fixCommonGPTBugs(sql, false);

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

  try {
    // Insight #6
    const matchupPrompt = `
Write a PostgreSQL query to show how many points ${player} has scored 
against team abbreviation='${opponentAbbr}' in past matchups.

- "games": (id, date, status, home_team_id, visitor_team_id) -> 'date' is the column, not 'game_date'
- "player_stats": (pts, game_date, game_id)
- "teams": (id, abbreviation)
- "team_id" is integer, do subselect if you want to filter by abbreviation.

Return ps.game_date, a matchup label, and ps.pts. Order by ps.game_date DESC.
    `;

    const matchupQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a SQL assistant. Use only valid columns from the user's schema."
        },
        { role: "user", content: matchupPrompt }
      ]
    });

    const rawMatchupSQL = matchupQuery.choices[0].message.content;
    const matchupSQL = cleanGPTSQL(rawMatchupSQL, opponentAbbr);

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
    // Advanced Metric #3
    const defensePrompt = `
Write a PostgreSQL query to calculate how many points abbreviation='${opponentAbbr}' 
has allowed to players at the same position as ${player}'s true_position in the last 5 final games.

- "games": (id, date, status, home_team_id, visitor_team_id)
- "box_scores": (player_id, pts, team_id, game_date, min)
- "active_players": (player_id, true_position)
- If you filter by team_id from abbreviation='${opponentAbbr}', do subselect.

Return average points allowed. Avoid referencing columns that don't exist (like g.game_date).
    `;

    const defenseQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a SQL assistant. Use only valid columns from the user's schema."
        },
        { role: "user", content: defensePrompt }
      ]
    });

    const rawDefenseSQL = defenseQuery.choices[0].message.content;
    const defenseSQL = cleanGPTSQL(rawDefenseSQL, opponentAbbr);

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
