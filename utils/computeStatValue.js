export function computeStatValue(row, statColumns) {
  return statColumns.reduce((total, col) => {
    return total + (row[col] ?? 0);
  }, 0);
}
