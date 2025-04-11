export async function getMatchupHistory({
  playerId,
  opponentTeamId,
  statType,
  supabase,
}) {
  try {
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

    console.log("📊 Matchup lookup:", {
      playerId,
      opponentTeamId,
      inputStatType: statType,
      normalizedStatType,
    });

    const { data, error } = await supabase
      .from("player_matchup_flat")
      .select("games_played, avg_value, hit_rate, stat_list")
      .eq("player_id", playerId)
      .eq("opponent_team_id", opponentTeamId)
      .eq("stat_type", normalizedStatType)
      .eq("season", 2024)
      .maybeSingle();

    if (error) {
      return { error: error.message };
    }

    if (!data || !data.games_played) {
      return {
        info: "No matchup history found for this stat vs this team.",
      };
    }

    return {
      gamesPlayed: data.games_played,
      average: +data.avg_value.toFixed(1),
      hitRatePercent: data.hit_rate ? (data.hit_rate * 100).toFixed(1) : null,
      statList: data.stat_list,
    };
  } catch (err) {
    return { error: err.message };
  }
}
