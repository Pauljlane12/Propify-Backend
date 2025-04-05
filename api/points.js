// /pages/api/points.js

import { createClient } from '@supabase/supabase-js';
import {
  INSIGHT_1_LAST_10_GAME_HIT_RATE,
  INSIGHT_2_SEASON_AVG_VS_LAST_3,
  INSIGHT_5_HOME_VS_AWAY
} from '../../insights/pointsInsights.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("🔥 /api/points was hit", req.body); // ✅ Vercel will log this

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { player, line } = req.body;

  if (!player || !line) {
    return res.status(400).json({ error: 'Missing player or line' });
  }

  const [firstName, ...lastParts] = player.trim().split(' ');
  const lastName = lastParts.join(' ');

  try {
    const { data: playerRow, error: playerErr } = await supabase
      .from('players')
      .select('player_id, team_id')
      .ilike('first_name', `%${firstName}%`)
      .ilike('last_name', `%${lastName}%`)
      .maybeSingle();

    if (playerErr || !playerRow) {
      console.error('❌ Player not found:', playerErr);
      return res.status(404).json({ error: 'Player not found' });
    }

    const params = {
      ':firstName': firstName.toLowerCase(),
      ':lastName': lastName.toLowerCase(),
      ':line': line.toString(),
    };

    const queries = [
      { key: 'insight_1_hit_rate', sql: INSIGHT_1_LAST_10_GAME_HIT_RATE },
      { key: 'insight_2_season_vs_last3', sql: INSIGHT_2_SEASON_AVG_VS_LAST_3 },
      { key: 'insight_5_home_vs_away', sql: INSIGHT_5_HOME_VS_AWAY },
    ];

    const insights = {};

    for (const { key, sql } of queries) {
      let filled = sql;
      for (const [placeholder, value] of Object.entries(params)) {
        filled = filled.replaceAll(placeholder, value);
      }

      const { data, error } = await supabase.rpc('run_sql', { sql: filled });
      insights[key] = error ? `Error: ${error.message}` : data;
    }

    return res.status(200).json({ player, line, insights });
  } catch (err) {
    console.error('❌ Error in /api/points:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
