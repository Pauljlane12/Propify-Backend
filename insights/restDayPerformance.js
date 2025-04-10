const statColumn = `avg_${statType}`; // matches your table column names

const { data: restRow } = await supabase
  .from("player_rest_day_averages")
  .select(`rest_days, games_played, ${statColumn}`)
  .eq("player_id", playerId)
  .eq("rest_days", restDays)
  .eq("game_season", CURRENT_SEASON)
  .maybeSingle();

if (!restRow || restRow[statColumn] == null) {
  return {
    rest_days: restDays,
    info: `No ${statType.toUpperCase()} data available for ${restDays} days rest.`,
  };
}

return {
  rest_days: restRow.rest_days,
  games_played: restRow.games_played,
  [statColumn]: restRow[statColumn],
  context: `On ${restRow.rest_days} days rest this season, this player is averaging ${restRow[statColumn]} ${statType.toUpperCase()} (${restRow.games_played} games).`,
};
