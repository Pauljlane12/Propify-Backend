import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getMatchupHistory({
  playerId,
  opponentTeamId,
  statType,
  bettingLine, // can be string or number
  supabase,
}) {
  try {
    const currentSeason = await getMostRecentSeason(supabase);

    const statTypeAliasMap = {
      pts: "points",
      reb: "rebounds",
      ast: "assists",
      blk: "blocked shots",
      stl: "steals",
      fg3m: "3pt made",
      fg3a: "3pt attempts",
      fga: "fg attempts",
      ftm: "ft made",
      fgm: "fg made",
      oreb: "offensive rebounds",
      dreb: "defensive rebounds",
      pras: "pras",
      "pts+ast": "pts+assts",
      "pts+reb": "pts+rebounds",
      "reb+ast": "rebs+assists",
      "blk+stl": "blocks + steals",
      turnover: "turnovers",
    };

    const normalizedStatType = statTypeAliasMap[statType] || statType;

    // 🔢 Safely convert betting line
    const parsedLine = Number(bettingLine);
    const hasLine = !Number.isNaN(parsedLine);

    // 1️⃣ Get current season matchup data
    const { data: curr } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .eq("season", currentSeason)
      .maybeSingle();

    // 2️⃣ Get most recent prior season avg
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

    // 3️⃣ Get team name
    const { data: teamRow } = await supabase
      .from("teams")
      .select("full_name")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const teamName = teamRow?.full_name || "the opponent";

    // 4️⃣ Process stats
    const statList = (curr?.stat_list || []).map(Number);
    const gameCount = statList.length;
    const hitCount =
      hasLine && gameCount > 0
        ? statList.filter((val) => val >= parsedLine).length
        : null;

    const seasonAvg = curr?.avg_value ? +curr.avg_value.toFixed(1) : null;
    const historicalAvg = prior?.avg_value ? +prior.avg_value.toFixed(1) : null;

    // 5️⃣ Build summary
    let context;
    if (seasonAvg !== null) {
      const lineText =
        hasLine && gameCount > 0
          ? ` and has cleared the line (**${parsedLine}**) in **${hitCount} of ${gameCount} matchups**`
          : "";
      context = `This season, he’s averaging **${seasonAvg} ${statType.toUpperCase()}** vs the **${teamName}**${lineText}.`;
    } else if (historicalAvg !== null) {
      context = `He averages **${historicalAvg} ${statType.toUpperCase()}** all-time vs the **${teamName}**. He has not yet faced them this season.`;
    } else {
      context = `No matchup history found vs the **${teamName}** for this stat.`;
    }

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
