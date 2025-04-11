export const statTypeMap = {
  // ✅ Single stat types (atomic)
  points: ["pts"],
  pts: ["pts"],
  rebounds: ["reb"],
  rebs: ["reb"],
  assists: ["ast"],
  ast: ["ast"],
  steals: ["stl"],
  blocks: ["blk"],
  turnovers: ["turnover"],
  "3pt made": ["fg3m"],
  "3pt": ["fg3m"],
  fg3m: ["fg3m"],
  "fg made": ["fgm"],
  fgm: ["fgm"],
  "fg attempts": ["fga"],
  fga: ["fga"],
  "3pt attempts": ["fg3a"],
  fg3a: ["fg3a"],
  "ft made": ["ftm"],
  ftm: ["ftm"],
  "ft attempts": ["fta"],
  fta: ["fta"],
  "offensive rebounds": ["oreb"],
  oreb: ["oreb"],
  "defensive rebounds": ["dreb"],
  dreb: ["dreb"],

  // ✅ Combo stat types
  pras: ["pts", "reb", "ast"],
  "points+rebounds+assists": ["pts", "reb", "ast"],
  "pts+rebs+asts": ["pts", "reb", "ast"],
  "pts+rebs+assists": ["pts", "reb", "ast"],

  "pts+assists": ["pts", "ast"],
  "points+assists": ["pts", "ast"],

  "pts+rebounds": ["pts", "reb"],
  "points+rebounds": ["pts", "reb"],
  "pts+rebs": ["pts", "reb"],

  "rebs+assists": ["reb", "ast"],
  "rebounds+assists": ["reb", "ast"],

  "blocks+steals": ["blk", "stl"],
  "steals+blocks": ["stl", "blk"],
  "stocks": ["blk", "stl"],

  "points+turnovers": ["pts", "turnover"],

  "points+rebounds+blocks": ["pts", "reb", "blk"], // optional combo
  "rebounds+blocks": ["reb", "blk"], // optional combo
};
