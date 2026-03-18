import pc from 'picocolors'

export function churnBenchmark(rate: number): string {
  if (rate <= 3) return pc.green('✓ Excellent (<3%)')
  if (rate <= 5) return pc.green('✓ Good (3-5%)')
  if (rate <= 7) return pc.yellow('⚠ Median for seed stage: 5-7%')
  if (rate <= 10) return pc.yellow('⚠ Above average (7-10%)')
  return pc.red('⚠ High (>10%) — investigate causes')
}

export function nrrBenchmark(nrr: number): string {
  if (nrr >= 130) return pc.green('✓ Best-in-class (>130%)')
  if (nrr >= 110) return pc.green('✓ Strong (110-130%)')
  if (nrr >= 100) return pc.green('✓ Healthy (≥100% = growing without new customers)')
  if (nrr >= 90) return pc.yellow('⚠ Below 100% = revenue shrinking')
  return pc.red('⚠ Significant contraction (<90%)')
}

export function quickRatioBenchmark(qr: number): string {
  if (qr >= 4) return pc.green('✓ Very healthy (>4)')
  if (qr >= 2) return pc.green('✓ Good (2-4)')
  if (qr >= 1) return pc.yellow('⚠ Fragile (1-2)')
  return pc.red('⚠ Below 1 = losing more than gaining')
}

export function revenueChurnBenchmark(rate: number): string {
  if (rate <= 2) return pc.green('✓ Excellent (<2%)')
  if (rate <= 5) return pc.yellow('⚠ Average (2-5%)')
  return pc.red('⚠ Above 5% needs attention')
}
