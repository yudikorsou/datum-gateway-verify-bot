export function verifyEntry({ miner, challenge, hasRole, suppliedAddress }) {
  if (suppliedAddress) {
    if (miner?.address === suppliedAddress) return 'menu'
    if (hasRole && !miner) return 'menu'
    return 'challenge'
  }
  if (miner) return 'menu'
  if (hasRole && challenge?.address) return 'menu'
  if (challenge?.address && challenge.expiresAt > Date.now()) return 'resume-challenge'
  return 'ask-address'
}

export function linkedAddress(miner, challenge) {
  return miner?.address || challenge?.address || null
}
