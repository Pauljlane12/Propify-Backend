import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getScoringSourceVs3ptDefense({
  playerId,
  opponentTeamId,
  playerLastName,
  supabase,
}) {
  const insightId = "scoring_3pt_vs_defense";
  const insightTitle = "3PT Scoring Dependency vs Defense";

  try {
    const currentSeason = await getMostRecentSeason(supabase);
    const previousSeason = currentSeason - 1;

    const { data: stats, error: statsError } = await supabase
      .from("season_averages")
      .select("stat_key, stat_value, season")
      .in("stat_key", ["pts", "fgm", "fg3m", "ftm"])
      .eq("player_id", playerId)
      .in("season", [currentSeason, previousSeason]);

    if (statsError || !stats?.length) {
      throw new Error("No season averages found");
    }

    const grouped = {};
    for (const row of stats) {
      if (!grouped[row.stat_key]) {
        grouped[row.stat_key] = row.stat_value;
      }
    }

    if (!grouped["pts"]) {
      const fallback = stats.find(r => r.stat_key === "pts" && r.season === previousSeason);
      grouped["pts"] = fallback?.stat_value || null;
    }

    if (!grouped["pts"] || !grouped["fg3m"] || !grouped["fgm"] || !grouped["ftm"]) {
      return {
        id: insightId,
        context: "Scoring breakdown data unavailable.",
        status: "info",
      };
    }

    const pts = grouped["pts"];
    const fg3m = grouped["fg3m"];
    const fgm = grouped["fgm"];

    const points3pt = fg3m * 3;
    const pct3pt = (points3pt / pts) * 100;

    if (pct3pt < 33) {
      return {
        id: insightId,
        context: "This player is not a 3PT-heavy scorer.",
        status: "info",
        hidden: true,
      };
    }

    const { data: posRow } = await supabase
      .from("active_players")
      .select("true_position")
      .eq("player_id", playerId)
      .maybeSingle();

    const playerPos = posRow?.true_position || "SG";

    const { data: defRow } = await supabase
      .from("positional_defense_rankings_top_minute")
      .select("defense_team_name, threes_made_allowed, threes_made_allowed_rank")
      .eq("defense_team_id", opponentTeamId)
      .eq("position", playerPos)
      .maybeSingle();

    if (!defRow) {
      return {
        id: insightId,
        context: "No 3PT defense data for this matchup.",
        status: "info",
      };
    }

    const context = `**${playerLastName}** scores **${pct3pt.toFixed(
      1
    )}%** of their points from 3-pointers. The **${defRow.defense_team_name}** allow **${defRow.threes_made_allowed} threes per game** to **${playerPos}s** — ranked **#${defRow.threes_made_allowed_rank} in the NBA**.`;

    return {
      id: insightId,
      context,
      status: defRow.threes_made_allowed_rank <= 10 ? "warning" : "success",
      details: {
        pct3pt: +pct3pt.toFixed(1),
        player_position: playerPos,
        team_name: defRow.defense_team_name,
        threes_allowed: defRow.threes_made_allowed,
        rank: defRow.threes_made_allowed_rank,
      },
    };
  } catch (e) {
    return {
      id: insightId,
      context: "Could not generate 3PT scoring insight.",
      status: "info",
      error: e.message,
    };
  }
}
