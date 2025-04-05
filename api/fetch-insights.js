import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: true,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const statMap = {
  points: 'pts',
  rebounds: 'reb',
  assists: 'ast',
  blocks: 'blk',
  steals: 'stl',
  threes: 'fg3m'
};

export default async function handler(req, res) {
  console.log('🔥 HIT /api/fetch-insights');

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  const legs = req.body;

  if (!Array.isArray(legs)) {
    return res.status(400).json({ message: 'Expected array of legs' });
  }

  const results = await Promise.all(
    legs.map(async (leg) => {
      const { player, prop, line, type } = leg;
      const insights = [];

      try {
        let statLogic;
        if (prop.includes('+')) {
          const parts = prop.split('+').map(part => statMap[part.trim().toLowerCase()]);
          statLogic = (row) => parts.reduce((sum, col) => sum + (row[col] ?? 0), 0);
        } else {
          const col = statMap[prop.toLowerCase()];
          if (!col) return { ...leg, insights: ['Unsupported prop type'] };
          statLogic = (row) => row[col];
        }

        const [firstName, ...lastParts] = player.split(' ');
        const lastName = lastParts.join(' ');

        const { data: playerData } = await supabase
          .from('players')
          .select('player_id')
          .ilike('first_name', `%${firstName}%`)
          .ilike('last_name', `%${lastName}%`)
          .maybeSingle();

        if (!playerData) {
          return { ...leg, insights: ['Player not found'] };
        }

        const { data: allStats } = await supabase
          .from('player_stats')
          .select('*')
          .eq('player_id', playerData.player_id)
          .order('game_date', { ascending: false })
          .limit(30); // fetch more to filter

        const eligibleStats = allStats
          .filter(row =>
            row.min && row.min.match(/^[0-9]+$/) &&
            parseInt(row.min) >= 10 &&
            statLogic(row) !== null &&
            statLogic(row) !== undefined
          )
          .slice(0, 10); // limit to 10 after filtering

        const hits = eligibleStats.filter(row =>
          type === 'over' ? statLogic(row) > line : statLogic(row) < line
        ).length;

        const hitRate = (hits / 10 * 100).toFixed(1);
        insights.push(`Hit line in ${hits} of last 10 eligible games (${hitRate}%).`);

        return { ...leg, insights };
      } catch (err) {
        console.error(`🔥 Error generating insight:`, err);
        return { ...leg, insights: ['Error generating insight'] };
      }
    })
  );

  return res.status(200).json(results);
}
