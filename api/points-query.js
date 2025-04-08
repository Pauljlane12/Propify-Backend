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
  if (match) sql = match[1].trim();

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

  const [firstName, ...lastParts] = player.trim().split(" ");
  const lastName = lastParts.join(" ");

  const insights = {};

  try {
    // --- Insight #6: Matchup History vs Opponent ---
    const matchupPrompt = `
Write a PostgreSQL query to show how many points ${player} has scored against ${opponentAbbr} in past matchups.
Use only these tables and columns:

- player_stats (player_id, pts, game_id, game_date)
- players (player_id, first_name, last_name)
- games (id, game_date, home_team_id, visitor_team_id)
- teams (id, abbreviation)

Return game_date, matchup (e.g., LAL vs MIA), and pts.
Join games and teams to show team abbreviations. Order by game_date DESC.
Do not use columns like "player_name" or "full_name" – they don’t exist.
`;

    const matchupQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a SQL assistant. Use only valid columns based on the schema provided." },
        { role: "user", content: matchupPrompt }
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
    // --- Advanced Metric #3: Last 5 Games vs Position ---
    const defensePrompt = `
Write a PostgreSQL query to calculate how many points ${opponentAbbr} has allowed to players at the same position as ${player}'s true_position in the last 5 final games.

Use these tables:
- box_scores (player_id, pts, team_id, game_date, min)
- games (id, date, status, home_team_id, visitor_team_id)
- active_players (player_id, true_position)

Avoid non-existent columns like "player_name". Use only real ones.

Steps:
1. Find the last 5 finalized games played by ${opponentAbbr}
2. For each game, sum up `pts` for all players whose position = ${player}'s true_position and who played against ${opponentAbbr}
3. Return average points allowed across those 5 games.
`;

    const defenseQuery = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a SQL assistant. Use only valid PostgreSQL syntax and valid columns." },
        { role: "user", content: defensePrompt }
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
