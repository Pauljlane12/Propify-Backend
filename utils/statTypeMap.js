export const statTypeMap = {
  // Single stats
  points: ["pts"],
  rebounds: ["reb"],
  assists: ["ast"],
  steals: ["stl"],
  blocks: ["blk"],
  turnovers: ["tov"],
  "3pt made": ["fg3m"],
  "fg made": ["fgm"],
  "ft made": ["ftm"],
  "fg attempts": ["fga"],
  "ft attempts": ["fta"],
  "3pt attempts": ["fg3a"],
  "offensive rebounds": ["oreb"],
  "defensive rebounds": ["dreb"],

  // Combo stats
  pras: ["pts", "reb", "ast"],
  "pts+rebounds": ["pts", "reb"],
  "pts+assists": ["pts", "ast"],
  "rebs+assists": ["reb", "ast"],
  "blocks+steals": ["blk", "stl"],
};
