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
  console.log('🏈 Request body:', JSON.stringify(req.body, null, 2));

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  const { 
    playerId,  // Optional
    playerName, 
    statType, 
    line, 
    direction = 'over',
    teamId,
    opponentTeamId 
  } = req.body;

  // Validate required parameters (only playerName and statType are required)
  if (!playerName || !statType) {
    console.log('❌ Missing required parameters:', { playerName, statType });
    return res.status(400).json({ 
      message: 'Missing required parameters: playerName, statType' 
    });
  }

  // Validate stat type
  const normalizedStatType = nflStatMap[statType.toLowerCase()];
  if (!normalizedStatType) {
    console.log('❌ Unsupported stat type:', statType);
    return res.status(400).json({ 
      message: `Unsupported NFL stat type: ${statType}. Supported types: ${Object.keys(nflStatMap).join(', ')}` 
    });
  }

  // NFL nickname mapping for common variations
  const nicknameMap = {
    'dak': 'rayne dakota',
    'josh': 'joshua',
    'pat': 'patrick',
    'mike': 'michael',
    'rob': 'robert',
    'dave': 'david',
    'jim': 'james',
    'bill': 'william',
    'tom': 'thomas',
    'joe': 'joseph',
    'aj': 'a.j.',
    'cj': 'c.j.',
    'dj': 'd.j.',
    'jj': 'j.j.',
    'tj': 't.j.'
  };

  // Function to perform fuzzy player lookup with multiple strategies
  async function findPlayerByName(playerName) {
    console.log(`🔍 Starting fuzzy lookup for: ${playerName}`);
    
    // Strategy 1: Exact match (case insensitive)
    const [firstName, ...lastParts] = playerName.toLowerCase().split(' ');
    const lastName = lastParts.join(' ');
    
    console.log(`🔍 Strategy 1 - Exact match: firstName="${firstName}", lastName="${lastName}"`);
    
    let { data: playerData } = await supabase
      .from('players')
      .select('id, first_name, last_name, team_id, position')
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .maybeSingle();

    if (playerData) {
      console.log(`✅ Strategy 1 success: Found ${playerData.first_name} ${playerData.last_name} (ID: ${playerData.id})`);
      return playerData;
    }

    // Strategy 2: Partial match with wildcards
    console.log(`🔍 Strategy 2 - Partial match with wildcards`);
    
    ({ data: playerData } = await supabase
      .from('players')
      .select('id, first_name, last_name, team_id, position')
      .ilike('first_name', `%${firstName}%`)
      .ilike('last_name', `%${lastName}%`)
      .maybeSingle());

    if (playerData) {
      console.log(`✅ Strategy 2 success: Found ${playerData.first_name} ${playerData.last_name} (ID: ${playerData.id})`);
      return playerData;
    }

    // Strategy 3: Try nickname expansion
    const expandedFirstName = nicknameMap[firstName] || firstName;
    if (expandedFirstName !== firstName) {
      console.log(`🔍 Strategy 3 - Nickname expansion: "${firstName}" → "${expandedFirstName}"`);
      
      ({ data: playerData } = await supabase
        .from('players')
        .select('id, first_name, last_name, team_id, position')
        .ilike('first_name', `%${expandedFirstName}%`)
        .ilike('last_name', `%${lastName}%`)
        .maybeSingle());

      if (playerData) {
        console.log(`✅ Strategy 3 success: Found ${playerData.first_name} ${playerData.last_name} (ID: ${playerData.id})`);
        return playerData;
      }
    }

    // Strategy 4: Search full name in concatenated field
    console.log(`🔍 Strategy 4 - Full name search`);
    
    const { data: players } = await supabase
      .from('players')
      .select('id, first_name, last_name, team_id, position')
      .ilike('first_name', `%${firstName}%`)
      .limit(10);

    if (players && players.length > 0) {
      // Find best match by checking if last name is contained in any result
      const bestMatch = players.find(p => 
        p.last_name.toLowerCase().includes(lastName) || 
        lastName.includes(p.last_name.toLowerCase())
      );
      
      if (bestMatch) {
        console.log(`✅ Strategy 4 success: Found ${bestMatch.first_name} ${bestMatch.last_name} (ID: ${bestMatch.id})`);
        return bestMatch;
      }
    }

    // Strategy 5: Last resort - search by last name only and find closest first name
    console.log(`🔍 Strategy 5 - Last name only search`);
    
    const { data: lastNameMatches } = await supabase
      .from('players')
      .select('id, first_name, last_name, team_id, position')
      .ilike('last_name', `%${lastName}%`)
      .limit(5);

    if (lastNameMatches && lastNameMatches.length > 0) {
      console.log(`🔍 Found ${lastNameMatches.length} players with similar last name:`, 
        lastNameMatches.map(p => `${p.first_name} ${p.last_name}`));
      
      // Return the first match as a fallback
      const fallbackMatch = lastNameMatches[0];
      console.log(`⚠️ Strategy 5 fallback: Using ${fallbackMatch.first_name} ${fallbackMatch.last_name} (ID: ${fallbackMatch.id})`);
      return fallbackMatch;
    }

    console.log(`❌ All strategies failed for: ${playerName}`);
    return null;
  }

  try {
    console.log(`🏈 Getting NFL insights for ${playerName} - ${statType} ${direction} ${line}`);
    
    // If playerId is not provided, look it up using fuzzy matching
    let finalPlayerId = playerId;
    
    if (!finalPlayerId) {
      const playerData = await findPlayerByName(playerName);

      if (!playerData) {
        console.log(`❌ Player not found after all strategies: ${playerName}`);
        return res.status(404).json({ 
          message: `Player not found: ${playerName}. Please check the spelling or try a different name format.` 
        });
      }
      
      finalPlayerId = playerData.id;  // Fixed: use 'id' instead of 'player_id'
      console.log(`✅ Final player ID: ${finalPlayerId} for ${playerName} → ${playerData.first_name} ${playerData.last_name}`);
    }
    
    const result = await getNFLInsightsForStat({
      playerId: finalPlayerId,
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
