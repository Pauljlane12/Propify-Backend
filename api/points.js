/**
 * /api/points.js
 * API endpoint to fetch insights for a player's Points prop.
 * Identifies player and opponent, then calls the insight orchestrator.
 * Passes player name and direction to the insight orchestrator.
 * Returns player's LAST NAME in the final payload.
 */
import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js"; // path already correct

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function pointsHandler(req, res) {
    console.log("🔥 /api/points was hit:", req.body);

    // ───────────────────────────────────────────────
    // Method check
    // ───────────────────────────────────────────────
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Only POST requests allowed" });
    }

    // ───────────────────────────────────────────────
    // Grab body parameters (NOW INCLUDES direction)
    // ───────────────────────────────────────────────
    let { player, line, direction } = req.body; // ← added direction
    if (!player || typeof line !== "number") {
        return res
            .status(400)
            .json({ error: "Missing or invalid player or line" });
    }

    // ───────────────────────────────────────────────
    // Split first / last name
    // ───────────────────────────────────────────────
    const [firstName, ...lastParts] = player.trim().split(" ");
    const lastName = lastParts.join(" "); // Extract the last name
    const statType = "pts"; // Define the statistic type for this endpoint

    // Helper to get last name (can reuse the one from insights/index.js if preferred, or define locally)
    const getLastName = (name) => {
        if (!name) return ""; // Return empty string if name is missing
        const parts = name.trim().split(" ");
        return parts.length > 1 ? parts[parts.length - 1] : name;
    };
    // Use the helper to get the last name for the final payload
    const playerLastNameForPayload = getLastName(player);


    try {
        // ── Identify player
        const { data: playerRow, error: playerError } = await supabase
            .from("players")
            .select("player_id, team_id")
            .ilike("first_name", `%${firstName}%`)
            .ilike("last_name", `%${lastName}%`)
            .maybeSingle(); // Expecting zero or one result

        if (playerError) {
             console.error("❌ Supabase error finding player:", playerError.message);
             return res.status(500).json({ error: "Error finding player in database." });
        }

        if (!playerRow) {
            console.warn(`⚠️ Player not found for name: "${player}"`);
            return res.status(404).json({ error: "Player not found" });
        }

        const { player_id, team_id } = playerRow;

        // ── Next opponent (first non‑Final game)
        const { data: upcomingGames, error: gamesError } = await supabase
            .from("games")
            .select(
                "id, date, home_team_id, visitor_team_id, status"
            )
            .neq("status", "Final")
            .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`)
            .order("date", { ascending: true })
            .limit(1);

         if (gamesError) {
             console.error("❌ Supabase error finding next game:", gamesError.message);
             // Log error but proceed, opponentTeamId will be undefined
             console.warn("Could not find upcoming game for opponent team ID.");
         }


        const nextGame = upcomingGames?.[0];
        const opponentTeamId =
            nextGame?.home_team_id === team_id
                ? nextGame?.visitor_team_id
                : nextGame?.home_team_id; // Will be undefined if nextGame is not found

        // ───────────────────────────────────────────────
        // 👉  Build all insights (direction now forwarded)
        // ───────────────────────────────────────────────
        const insights = await getInsightsForStat({
            playerId: player_id,
            playerName: player, // Pass the full player name to insights orchestrator
            statType,
            statColumns: [statType], // For single stats, statColumns is just the statType
            line,
            direction, // ← forward raw flag ("over", "under", "less", etc.)
            teamId: team_id,
            opponentTeamId, // Pass opponentTeamId (can be undefined)
            supabase, // Pass the Supabase client instance
        });

        console.log(
            "🚀 Final insights payload:",
            JSON.stringify(insights, null, 2)
        );

        // Return the player's LAST NAME, the line, direction, and the array of insights
        return res.status(200).json({ player: playerLastNameForPayload, line: line, direction: direction, insights: insights }); // <<-- CHANGED: Use playerLastNameForPayload
    } catch (err) {
        console.error("❌ Unhandled error in /api/points:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
}
