export const normalizeDirection = (raw = 'over') => {
  const dir = String(raw).trim().toLowerCase();
  return ['under', 'less', '<', 'u'].includes(dir) ? 'under' : 'over';
};
