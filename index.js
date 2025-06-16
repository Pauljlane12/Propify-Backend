import { getNFLLast10GameHitRate } from "./last10Games.js";
import { getNFLSeasonVsLast3 } from "./seasonVsLast3.js";
import { getNFLMatchupHistory } from "./matchupHistory.js";
import { getNFLHomeAwaySplit } from "./homeAwaySplit.js";
import { getNFLTeamDefenseRank } from "./teamDefenseRank.js";
import { getNFLPlayerInjuryImpact } from "./playerInjuryImpact.js";
import { getNFLWeatherImpact } from "./weatherImpact.js";
import { getNFLRedZonePerformance } from "./redZonePerformance.js";

const getLastName = (name) => {
  if (!name) return "Player";
  const parts = name.trim().split(" ");
  const lastName = parts.length > 1 ? parts[parts.length - 1] : name;
  return lastName.charAt(0).toUpperCase() + lastName.slice(1);
};

export async function getNFLInsightsForStat({
  playerId,
  playerName,
  statType,
  line,
  direction,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};
  const playerLastName = getLastName(playerName);

  try {
    // Core NFL insights
    const [
      last10Games,
      seasonVsLast3,
      matchupHistory,
      homeAwaySplit,
      teamDefenseRank,
      playerInjuryImpact,
      weatherImpact,
      redZonePerformance,
    ] = await Promise.all([
      getNFLLast10GameHitRate({
        playerId,
        playerName,
        statType,
        line,
        direction,
        supabase,
      }),
      getNFLSeasonVsLast3({
        playerId,
        playerName,
        statType,
        supabase,
      }),
      getNFLMatchupHistory({
        playerId,
        playerName,
        opponentTeamId,
        statType,
        bettingLine: line,
        supabase,
      }),
      getNFLHomeAwaySplit({
        playerId,
        teamId,
        statType,
        supabase,
      }),
      getNFLTeamDefenseRank({
        opponentTeamId,
        statType,
        supabase,
      }),
      getNFLPlayerInjuryImpact({
        playerId,
        playerName,
        statType,
        supabase,
      }),
      getNFLWeatherImpact({
        playerId,
        playerName,
        statType,
        supabase,
      }),
      getNFLRedZonePerformance({
        playerId,
        playerName,
        statType,
        supabase,
      }),
    ]);

    // Assign insights
    insights.last10Games = last10Games;
    insights.seasonVsLast3 = seasonVsLast3;
    insights.matchupHistory = matchupHistory;
    insights.homeAwaySplit = homeAwaySplit;
    insights.teamDefenseRank = teamDefenseRank;
    insights.playerInjuryImpact = playerInjuryImpact;
    insights.weatherImpact = weatherImpact;
    insights.redZonePerformance = redZonePerformance;

    return {
      playerName,
      playerLastName,
      statType,
      line,
      direction,
      insights,
    };
  } catch (error) {
    return {
      error: `Failed to get NFL insights: ${error.message}`,
    };
  }
} 