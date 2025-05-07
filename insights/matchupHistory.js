import { getMostRecentSeason } from "../utils/getMostRecentSeason.js";
import { getLastName } from "../utils/getLastName.js"; // Assumes you have this helper

export async function getMatchupHistory({
  playerId,
  playerName,
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
      pras: "points+rebounds+assists",
      "pts+ast": "points+assists",
      "pts+reb": "points+rebounds",
      "reb+ast": "rebounds+assists",
      "blk+stl": "blocks+steals",
      turnover: "turnovers",
    };

    const normalizedStatType = statTypeAliasMap[statType] || statType;
    const parsedLine = Number(bettingLine);
    const hasLine = !Number.isNaN(parsedLine);

    const { data: curr } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .eq("season", currentSeason)
      .maybeSingle();

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

    const { data: teamRow } = await supabase
      .from("teams")
      .select("full_name")
      .eq("id", opponentTeamId)
      .maybeSingle();

    const teamName = teamRow?.full_name || "the opponent";
    const statList = (curr?.stat_list || []).map(Number);
    const gameCount = statList.length;
    const hitCount = hasLine ? statList.filter((val) => val >= parsedLine).length : null;
    const seasonAvg = curr?.avg_value ? +curr.avg_value.toFixed(1) : null;
    const historicalAvg = prior?.avg_value ? +prior.avg_value.toFixed(1) : null;
    const lastName = getLastName(playerName);

    let context;

    if (seasonAvg !== null && gameCount > 0) {
      const lineInfo = hasLine
        ? `, he has cleared the line (**${parsedLine}**) in **${hitCount} of ${gameCount} matchups**`
        : "";
      context = `In **${lastName}’s** last **${gameCount} matchups** vs the **${teamName}**${lineInfo}, averaging **${seasonAvg} ${statType.toUpperCase()}**.`;
    } else if (historicalAvg !== null) {
      context = `**${lastName}** has not faced the **${teamName}** this season but averages **${historicalAvg} ${statType.toUpperCase()}** against them all-time.`;
    } else {
      context = `No matchup history found for **${lastName}** vs the **${teamName}**.`;
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
