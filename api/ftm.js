/**
 * /api/ftm.js
 * API endpoint to fetch insights for a player's Free Throws Made (FTM) prop.
 * Identifies player using a direct database query, finds opponent, then calls the insight orchestrator.
 * Now uses a more robust method to find the player by first and last name.
 */
import { createClient } from "@supabase/supabase-js";
import { getInsightsForStat } from "../insights/index.js"; // path already correct

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function ftmHandler(req, res) {
    console.log("🔥 /api/ftm was hit:", req.body);

    // ───────────────────────────────────────────────
    // Method check
    // ───────────────────────────────────────────────
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Only POST requests allowed" });
    }

    // ───────────────────────────────────────────────
    // Grab body parameters (player, line, direction)
    // ───────────────────────────────────────────────
    let { player, line, direction } = req.body;
    if (!player || typeof line !== "number") {
        return res
            .status(400)
            .json({ error: "Missing or invalid player or line" });
    }

    // ───────────────────────────────────────────────
    // Split first / last name from the input player string
    // Use normalization to handle potential hyphens/accents in input before splitting
    // This split is for querying the database fields directly.
    const normalizeForSplit = (str) =>
         str
           .normalize("NFD")
           .replace(/[\u0300-\u036f]/g, "") // strip accents
           .replace(/-/g, " ")             // convert hyphens to space
           .replace(/[^\w\s]/gi, "")       // remove punctuation
           .trim()
           .replace(/\s+/g, " ");         // collapse extra spaces

    const normalizedPlayerInput = normalizeForSplit(player);
    const nameParts = normalizedPlayerInput.split(" ");
    const firstName = nameParts[0];
    // Join remaining parts as last name, handles multi-part last names like "Towns Jr."
    const lastName = nameParts.slice(1).join(" ");

    const statType = "ftm"; // Define the statistic type for this endpoint

    // Helper to get last name for the payload (can reuse the one from insights/index.js if preferred)
    const getLastNameForPayload = (name) => {
        if (!name) return ""; // Return empty string if name is missing
        const parts = name.trim().split(" ");
        return parts.length > 1 ? parts[parts.length - 1] : name;
    };
    // Use the helper to get the last name for the final payload
    const playerLastNameForPayload = getLastNameForPayload(player);


    try {
        // ── Identify player using a direct Supabase query ──
        // Query the 'active_players' table using the split first and last names
        // Use ilike for case-insensitive matching and flexibility with partial matches if needed,
        // though exact match on normalized names is generally better.
        // Let's try matching on first name AND last name using ilike.
        const { data: playerRows, error: playerError } = await supabase
            .from("active_players")
            .select("player_id, team_id, first_name, last_name") // Select necessary fields
            // Use ilike for case-insensitive matching on first and last names
            .ilike("first_name", firstName) // Match the extracted first name
            .ilike("last_name", lastName);   // Match the extracted last name
            // Note: This assumes a simple first/last name split works for most players.
            // For complex names or variations, you might need more sophisticated matching.


        if (playerError) {
             console.error("❌ Supabase error finding player:", playerError.message);
             return res.status(500).json({ error: "Error finding player in database." });
        }

        // Check if exactly one player was found
        if (!playerRows || playerRows.length === 0) {
             console.error("❌ Player not found:", player);
             return res.status(404).json({ error: `Player not found: ${player}` });
        } else if (playerRows.length > 1) {
             // Handle cases where multiple players match (e.g., common names)
             console.warn(`⚠️ Multiple players found for name: "${player}". Found:`, playerRows.map(p => `${p.first_name} ${p.last_name}`));
             // You might need additional logic here to pick the correct player,
             // e.g., check team_id if available in the input, or return an error asking for clarification.
             // For now, let's use the first result as a simple fallback.
             console.warn("Using the first found player.");
        }

        // Use the first player found
        const playerRow = playerRows[0];
        const { player_id, team_id } = playerRow;

        // ── Next opponent (first non‑Final game)
        const { data: upcomingGames, error: gamesError } = await supabase
            .from("games")
            .select(
                "id, date, home_team_id, visitor_team_id, status"
            )
            .neq("status", "Final") // Exclude games that are already finished
            .or(`home_team_id.eq.${team_id},visitor_team_id.eq.${team_id}`) // Game where player's team is home or visitor
            .order("date", { ascending: true }) // Get the soonest upcoming game
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
            playerName: player, // Pass the original full player name to insights orchestrator
            statType,
            statColumns: [statType], // For single stats, statColumns is just the statType
            line,
            direction, // Forward direction ("over", "under", "less", etc.)
            teamId: team_id,
            opponentTeamId, // Pass opponentTeamId (can be undefined)
            supabase, // Pass the Supabase client instance
        });

        console.log(
            "🚀 Final ftm insights payload:",
            JSON.stringify(insights, null, 2)
        );

        // Return the player's LAST NAME, the line, direction, and the array of insights
        return res.status(200).json({ player: playerLastNameForPayload, line: line, direction: direction, insights: insights });

    } catch (err) {
        console.error("❌ Unhandled error in /api/ftm:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
}
