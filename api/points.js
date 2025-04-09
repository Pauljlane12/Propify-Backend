// It's simpler to test this separately from your main /api/points.js.
//
// 1) Create a NEW file, for example: /api/pointsSeasonLast3.js
// 2) Paste the script below into that file.
// 3) Hit the endpoint /api/pointsSeasonLast3 with a JSON POST body containing {"player": "Lebron James"}.
// 4) Observe console logs to see how the minutes/points filtering is happening.
//
// Once you're confident it's working correctly (or find the data issues), you can merge any parts you want back into /api/points.js.

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function pointsSeasonLast3Handler(req, res) {
  console.log("🔥 /api/pointsSeasonLast3 was hit:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  let { player } = req.body;
  if (!player) {
    return res.status(400).json({ error: "Missing player name" });
  }

  const [firstName, ...lastParts] = player.trim().toLowerCase().split(" ");
  const lastName = lastParts.join(" ");

  try {
    // 1) Identify player
    const { data: playerRow } = await supabase
      .from("players")
      .select("player_id")
      .ilike("first_name", `%${firstName}%`)
      .ilike("last_name", `%${lastName}%`)
      .maybeSingle();

    if (!playerRow) {
      return res
        .status(404)
        .json({ error: `Player not found: ${player}` });
    }

    const { player_id } = playerRow;

    // 2) Grab all player_stats rows
    const { data: allStats, error: allStatsErr } = await supabase
      .from("player_stats")
      .select("pts, min, game_date")
      .eq("player_id", player_id);

    if (allStatsErr) {
      console.error("❌ allStatsErr:", allStatsErr);
      return res.status(500).json({ error: allStatsErr.message });
    }

    // 3) Filter out games with < 10 minutes
    const validSeasonGames = [];
    for (const g of allStats || []) {
      if (!g.min) continue;
      const parsedMin = parseInt(g.min, 10);
      if (!isNaN(parsedMin) && parsedMin >= 10) {
        validSeasonGames.push(g);
      }
    }

    // 4) Compute season average
    const seasonGamesCount = validSeasonGames.length;
    const seasonPtsSum = validSeasonGames.reduce((acc, cur) => acc + (cur.pts || 0), 0);
    const seasonAvg =
      seasonGamesCount > 0 ? seasonPtsSum / seasonGamesCount : 0;

    // 5) Sort descending by date, then slice last 3
    validSeasonGames.sort(
      (a, b) => new Date(b.game_date) - new Date(a.game_date)
    );
    const last3 = validSeasonGames.slice(0, 3);
    const last3Count = last3.length;
    const last3PtsSum = last3.reduce((acc, cur) => acc + (cur.pts || 0), 0);
    const last3Avg = last3Count > 0 ? last3PtsSum / last3Count : 0;

    // 6) Log each valid game for debugging
    console.log("✅ [DEBUG Season Games] player:", player);
    validSeasonGames.forEach((g, i) => {
      console.log(
        `[GAME ${i + 1}] Date:${g.game_date} MIN:${g.min} PTS:${
          g.pts
        } => parsedMin:${parseInt(g.min, 10)}`
      );
    });

    // 7) Return the results
    const result = {
      player,
      totalValidGames: seasonGamesCount,
      seasonAvg: +seasonAvg.toFixed(1),
      last3Avg: +last3Avg.toFixed(1),
      last3Games: last3.map((g) => ({
        date: g.game_date,
        min: g.min,
        pts: g.pts,
      })),
    };

    console.log("🚀 /api/pointsSeasonLast3 result:", result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Unhandled error in /api/pointsSeasonLast3:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = pointsSeasonLast3Handler;
