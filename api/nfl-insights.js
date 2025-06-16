import { createClient } from '@supabase/supabase-js';
import { getNFLInsightsForStat } from './nfl/index.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// NFL stat type mapping for API requests
const nflStatMap = {
  // Passing stats
  pass_yds: 'pass_yds',
  pass_tds: 'pass_tds', 
  pass_comp: 'pass_comp',
  pass_att: 'pass_att',
  pass_int: 'pass_int',
  qb_rating: 'qb_rating',
  
  // Rushing stats
  rush_yds: 'rush_yds',
  rush_tds: 'rush_tds',
  rush_att: 'rush_att',
  
  // Receiving stats
  rec_yds: 'rec_yds',
  rec_tds: 'rec_tds',
  receptions: 'receptions',
  targets: 'targets',
  
  // Defense stats
  tackles: 'tackles',
  sacks: 'sacks',
  ints: 'ints',
  
  // Kicking stats
  fg_made: 'fg_made',
  fg_att: 'fg_att',
  xp_made: 'xp_made',
  
  // Combined stats
  'pass_yds+rush_yds': 'pass_yds+rush_yds',
  'rec_yds+rush_yds': 'rec_yds+rush_yds',
  'pass_tds+rush_tds': 'pass_tds+rush_tds',
};

export default async function handler(req, res) {
  console.log('🏈 HIT /api/nfl-insights');

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  const { 
    playerId, 
    playerName, 
    statType, 
    line, 
    direction = 'over',
    teamId,
    opponentTeamId 
  } = req.body;

  // Validate required parameters
  if (!playerId || !playerName || !statType) {
    return res.status(400).json({ 
      message: 'Missing required parameters: playerId, playerName, statType' 
    });
  }

  // Validate stat type
  const normalizedStatType = nflStatMap[statType.toLowerCase()];
  if (!normalizedStatType) {
    return res.status(400).json({ 
      message: `Unsupported NFL stat type: ${statType}. Supported types: ${Object.keys(nflStatMap).join(', ')}` 
    });
  }

  try {
    console.log(`🏈 Getting NFL insights for ${playerName} - ${statType} ${direction} ${line}`);
    
    const result = await getNFLInsightsForStat({
      playerId,
      playerName,
      statType: normalizedStatType,
      line: parseFloat(line),
      direction,
      teamId,
      opponentTeamId,
      supabase,
    });

    if (result.error) {
      console.error('🏈 NFL Insights Error:', result.error);
      return res.status(500).json({ 
        message: 'Error generating NFL insights', 
        error: result.error 
      });
    }

    console.log('🏈 NFL insights generated successfully');
    return res.status(200).json(result);

  } catch (error) {
    console.error('🏈 NFL Insights Handler Error:', error);
    return res.status(500).json({ 
      message: 'Internal server error generating NFL insights',
      error: error.message 
    });
  }
} 
