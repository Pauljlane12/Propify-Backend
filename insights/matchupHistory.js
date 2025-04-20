import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";

export async function getMatchupHistory({
  playerId,
  opponentTeamId,
  statType,
  bettingLine,
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

    // 1️⃣ Current season data
    const { data: curr, error: currErr } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .eq("season", currentSeason)
      .maybeSingle();

    // 2️⃣ All-time (prior seasons)
    const { data: allTime, error: histErr } = await supabase
      .from("player_matchup_flat")
      .select("avg_value")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .lte("season", currentSeason - 1)
      .order("season", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3️⃣ Get opponent team name
    const { data: teamMeta } = await supabase
      .from("teams")
      .select("full_name")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const teamName = teamMeta?.full_name || "the opponent";

    // 4️⃣ Process stat list and hit count
    const statList = (curr?.stat_list || []).map(Number); // force numeric
    const gameCount = statList.length;
    const hitCount = statList.filter((val) => val >= bettingLine).length;
    const avg = curr?.avg_value ? +curr.avg_value.toFixed(1) : null;
    const allTimeAvg = allTime?.avg_value ? +allTime.avg_value.toFixed(1) : null;

    // 5️⃣ Build final explanation
    let context;

    if (avg && gameCount > 0) {
      context = `This season, he’s averaging **${avg} ${statType.toUpperCase()}** vs the **${teamName}** and has cleared the line (**${bettingLine}**) in **${hitCount} of ${gameCount} matchups**.`;
    } else if (allTimeAvg) {
      context = `He averages **${allTimeAvg} ${statType.toUpperCase()}** all-time vs the **${teamName}**. He has not yet faced them this season.`;
    } else {
      context = `No matchup history found vs the **${teamName}** for this stat.`;
    }

    return {
      statType,
      normalizedStatType,
      season: currentSeason,
      context,
      average: avg || allTimeAvg || null,
      hitCount: gameCount ? hitCount : null,
      gameCount,
      statList,
    };
  } catch (err) {
    return { error: err.message };
  }
}
