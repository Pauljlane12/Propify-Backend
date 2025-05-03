import { createClient } from "@supabase/supabase-js";
import { getInsightsForMoneyline } from "../insights/moneylineIndex.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { teamId, opponentTeamId } = req.body;

  if (!teamId) {
    return res.status(400).json({ error: "Missing teamId" });
  }

  try {
    const insights = await getInsightsForMoneyline({
      teamId,
      opponentTeamId,
      supabase,
    });

    return res.status(200).json({
      teamId,
      opponentTeamId,
      insights,
    });
  } catch (err) {
    console.error("❌ Unhandled error in /api/moneyline.js:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
