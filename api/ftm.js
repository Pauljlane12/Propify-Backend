/**
 * /api/ftm.js
 * API endpoint to fetch insights for a player's Free Throws Made (FTM) prop.
 * Identifies player using a robust name normalization method.
 */
import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function ftmHandler(req, res) {
    console.log("🔥 /api/ftm was hit:", req.body);

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Only POST requests allowed" });
    }

    const { player, line, direction } = req.body;
    if (!player || typeof line !== "number") {
        return res.status(400).json({ error: "Missing or invalid player or line" });
    }

    // Normalize helper for matching
    const normalize = (str) =>
        str
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/-/g, " ")
            .replace(/[^\w\s]/g, "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");

    const normalizedTarget = normalize(player);

    try {
        const { data: players, error: playerError } = await supabase
            .from("active_players")
            .select("player_id, team_id, first_name, last_name");

        if (playerError || !players?.length) {
            console.error("❌ Supabase error finding player:", playerError?.message);
            return res.status(500).json({ error: "Error finding player in database." });
        }

        const playerRow = players.find((p) => {
            const fullName = `${p.first_name} ${p.last_name}`;
            return normalize(fullName) === normalizedTarget;
        });

        if (!playerRow) {
            console.error("❌ Player not found:", normalizedTarget);
            return res.status(404).json({ error: `Player not found: ${normalizedTarget}` });
        }

        const { player_id, team_id, last_name } = playerRow;

        const { data: upcomingGames, error: gamesError } = await supabase
            .from("games")
            .select("id, date, home_team_id, visitor_team_id, status")
            .neq("status", "Final")
            .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
            .order("date", { ascending: true })
            .limit(1);

        if (gamesError) {
            console.error("❌ Supabase error finding next game:", gamesError.message);
            console.warn("Could not find upcoming game for opponent team ID.");
        }

        const nextGame = upcomingGames?.[0];
        const opponentTeamId =
            nextGame?.home_team_id === team_id
                ? nextGame?.visitor_team_id
                : nextGame?.home_team_id;

        const statType = "ftm";

        const insights = await getInsightsForStat({
            playerId: player_id,
            playerName: player,
            statType,
            statColumns: [statType],
            line,
            direction,
            teamId: team_id,
            opponentTeamId,
            supabase,
        });

        console.log("🚀 Final ftm insights payload:", JSON.stringify(insights, null, 2));

        return res.status(200).json({
            player: last_name,
            line,
            direction,
            insights,
        });
    } catch (err) {
        console.error("❌ Unhandled error in /api/ftm:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
}
