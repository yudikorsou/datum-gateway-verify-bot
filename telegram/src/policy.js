export function membershipAction(scan) {
  if (scan.activeDatum) return 'keep'
  if (!scan.conclusive) return 'skip'
  return 'revoke'
}
