// Shared weighted-score utility used by:
//   - src/lib/analyse.functions.ts (getAnalysisJob recompute)
//   - supabase/functions/analyse-listing/index.ts (post-Claude recompute)
//   - src/routes/dashboard.tsx (computeOverallScore)
//
// Pure TypeScript, no runtime dependencies — safe to import from Vite,
// TanStack server fns, and Deno edge functions alike.

export const SCORE_WEIGHTS: Record<string, number> = {
  valueForMoney: 0.25,
  locationQuality: 0.20,
  riskLevel: 0.20,
  resalePotential: 0.15,
  listingTransparency: 0.10,
  marketTiming: 0.10,
};

/**
 * Compute the overall vett score as a weighted average of sub-scores.
 * Missing / non-finite / zero sub-scores are skipped and their weight is
 * not counted toward the divisor. Returns NaN if no sub-scores contribute.
 * Result is rounded to one decimal place.
 */
export function computeWeightedScore(subScores: Record<string, number>): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [k, w] of Object.entries(SCORE_WEIGHTS)) {
    const v = Number(subScores?.[k]);
    if (isFinite(v) && v > 0) {
      weightedSum += v * w;
      totalWeight += w;
    }
  }
  if (totalWeight <= 0) return NaN;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
