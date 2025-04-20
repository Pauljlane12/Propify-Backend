import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getMatchupHistory({
  playerId,
  opponentTeamId,
  statType,
  bettingLine,          // ← may be undefined
  supabase,
}) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    /* ---------- 1.  normalise stat type ---------- */
    const alias = {
      pts: "points", reb: "rebounds", ast: "assists", blk: "blocked shots",
      stl: "steals", fg3m: "3pt made", fg3a: "3pt attempts", fga: "fg attempts",
      ftm: "ft made", fgm: "fg made", oreb: "offensive rebounds",
      dreb: "defensive rebounds", pras: "pras", "pts+ast": "pts+assts",
      "pts+reb": "pts+rebounds", "reb+ast": "rebs+assists",
      "blk+stl": "blocks + steals", turnover: "turnovers",
    };
    const normalizedStatType = alias[statType] || statType;

    /* ---------- 2.  current‑season row ---------- */
    const { data: curr } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .eq("season", currentSeason)
      .maybeSingle();

    /* ---------- 3.  most‑recent prior‑season row ---------- */
    const { data: prior } = await supabase
      .from("player_matchup_flat")
      .select("avg_value")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .lt("season", currentSeason)
      .order("season", { ascending: false })
      .limit(1)
      .maybeSingle();

    /* ---------- 4.  team name ---------- */
    const { data: teamRow } = await supabase
      .from("teams")
      .select("full_name")
      .eq("id", opponentTeamId)
      .maybeSingle();
    const teamName = teamRow?.full_name || "the opponent";

    /* ---------- 5.  stat list & hit count ---------- */
    const statList      = (curr?.stat_list || []).map(Number);
    const gameCount     = statList.length;
    const hasLine       = typeof bettingLine === "number" && !Number.isNaN(bettingLine);
    const hitCount      = hasLine && gameCount
      ? statList.filter(v => v >= bettingLine).length
      : null;

    const seasonAvg     = curr?.avg_value ? +curr.avg_value.toFixed(1) : null;
    const historicalAvg = prior?.avg_value ? +prior.avg_value.toFixed(1) : null;

    /* ---------- 6.  build context string ---------- */
    let context;
    if (seasonAvg !== null) {
      const lineText = hasLine
        ? ` and has cleared the line (**${bettingLine}**) in **${hitCount} of ${gameCount} matchups**`
        : "";
      context = `This season, he’s averaging **${seasonAvg} ${statType.toUpperCase()}** vs the **${teamName}**${lineText}.`;
    } else if (historicalAvg !== null) {
      context = `He averages **${historicalAvg} ${statType.toUpperCase()}** all‑time vs the **${teamName}**. He has not yet faced them this season.`;
    } else {
      context = `No matchup history found vs the **${teamName}** for this stat.`;
    }

    /* ---------- 7.  return ---------- */
    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      average: seasonAvg ?? historicalAvg ?? null,
      hitCount,
      gameCount,
      statList,
    };
  } catch (err) {
    return { error: err.message };
  }
}
