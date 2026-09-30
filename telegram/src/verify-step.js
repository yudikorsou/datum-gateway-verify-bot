export function restoreDecision(scan) {
  if (scan?.activeDatum) return 'grant'
  if (scan?.conclusive) return 'deny'
  return 'retry'
}
