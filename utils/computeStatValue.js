export function computeStatValue(row, statColumns) {
  return statColumns.reduce((sum, col) => sum + (row[col] ?? 0), 0);
}
