// Shared GST-variance computation used by:
//   • the E2b engine check (engine.ts) — drives the pass / partial / fail
//     verdict for "Output GST matches computed amount"
//   • the Statutory-Compliance insight backup modal (InsightBackup.tsx) —
//     surfaces the working to the user
//
// Assumption: Tally's Sales ledger holds the TAXABLE VALUE (GST-exclusive).
// Output GST sits in a separate ledger.  So expected output GST is
// `taxable_sales × headline_rate / 100`, not `× rate / (100+rate)`.
//
// "Headline rate" is picked by snapping the observed effective rate to
// the nearest Indian GST slab (5 / 12 / 18 / 28).  This isn't perfect for
// multi-rate businesses, but for a single-rate business it correctly
// surfaces under-collection: e.g. 18%-only business showing 7% effective
// is a clear red flag, regardless of which slab we snap to.

export const GST_HEADLINE_RATES = [0.05, 0.12, 0.18, 0.28];

export interface GSTVariance {
  /** Total taxable sales (GST-exclusive).  0 when neither P&L revenue
   *  nor TB sales reads non-zero. */
  sales: number;
  /** Output GST as a fraction of sales (e.g. 0.158 = 15.8%). */
  effectiveRate: number;
  /** Indian GST slab nearest to the observed effective rate. */
  headlineRate: number;
  /** sales × headlineRate — what output GST should be if every sale was
   *  at the chosen headline rate. */
  expectedGST: number;
  /** |actual − expected| / expected.  Returns 0 when sales or expected
   *  are zero (no signal to surface). */
  variance: number;
}

export function computeGSTVariance(sales: number, outputGST: number): GSTVariance {
  if (sales <= 0) {
    return { sales, effectiveRate: 0, headlineRate: 0, expectedGST: 0, variance: 0 };
  }
  const effectiveRate = outputGST / sales;
  let headlineRate = GST_HEADLINE_RATES[0];
  for (const r of GST_HEADLINE_RATES) {
    if (Math.abs(r - effectiveRate) < Math.abs(headlineRate - effectiveRate)) headlineRate = r;
  }
  const expectedGST = sales * headlineRate;
  const variance = expectedGST > 0 ? Math.abs(outputGST - expectedGST) / expectedGST : 0;
  return { sales, effectiveRate, headlineRate, expectedGST, variance };
}
