'use client';

import type { ParsedData, ChunkedStats, HealthSignal } from './types';

function fmtINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function generateHealthSignals(
  parsedData: Partial<ParsedData>,
  dbStats: ChunkedStats | null,
): HealthSignal[] {
  const signals: HealthSignal[] = [];

  const {
    revenue = 0, netProfit = 0, expenses = 0,
    ca = 0, cl = 0,
    bankBal = 0, debtorBal = 0, creditorBal = 0,
    closingStock = 0, openingStock = 0,
    tbPurch = 0, tbSales = 0,
  } = parsedData;

  // ── Profitability ──────────────────────────────────────────────────────
  if (revenue > 0) {
    signals.push({
      category: 'Profitability',
      signal: 'Revenue (Turnover)',
      value: fmtINR(revenue),
      note: 'Total sales / income per P&L',
    });

    if (netProfit !== 0) {
      signals.push({
        category: 'Profitability',
        signal: 'Net Profit',
        value: fmtINR(netProfit),
        note: netProfit >= 0 ? 'Profitable year' : 'Loss-making year — review cost structure',
      });

      signals.push({
        category: 'Profitability',
        signal: 'Net Profit Margin',
        value: pct(netProfit, revenue),
        note: netProfit / revenue >= 0.1 ? 'Healthy margin (>10%)' : 'Margin below 10% — monitor expenses',
      });
    }
  }

  // ── Liquidity (Bug 1: preserve signs, handle negative CA) ──────────────
  if (ca !== 0 || cl !== 0) {
    signals.push({
      category: 'Liquidity',
      signal: 'Current Assets',
      value: fmtINR(ca),
      // Bug 1: flag anomalous negative CA
      note: ca < 0 ? 'ANOMALY: Current Assets negative — structurally impossible, check Tally setup' : 'From Balance Sheet',
    });
    signals.push({
      category: 'Liquidity',
      signal: 'Current Liabilities',
      value: fmtINR(cl),
      note: 'From Balance Sheet',
    });

    if (ca === 0) {
      // Cannot compute current ratio when CA is zero
    } else if (cl !== 0) {
      const currentRatio = ca / Math.abs(cl);
      signals.push({
        category: 'Liquidity',
        signal: 'Current Ratio',
        value: currentRatio.toFixed(2),
        note: currentRatio >= 1.5 ? 'Good liquidity' : currentRatio >= 1 ? 'Adequate but tight' : 'Liquidity risk — current liabilities exceed assets',
      });
    }

    signals.push({
      category: 'Liquidity',
      signal: 'Working Capital',
      value: fmtINR(ca - cl),
      note: (ca - cl) >= 0 ? 'Positive working capital' : 'Negative working capital — short-term solvency risk',
    });
  }

  // ── Balances ──────────────────
  // bankBal comes from the BS parser as an unsigned magnitude — Tally's BS
  // XML stores asset Dr-balances as negative, which we abs() upstream.  A
  // genuine overdraft surfaces as a separate "Bank OD A/c" ledger on the
  // liabilities side, classified via bank-od, not as a negative bankBal.
  if (bankBal !== 0) {
    signals.push({
      category: 'Balances',
      signal: 'Cash & Bank Balance',
      value: fmtINR(bankBal),
      note: 'Closing balance per Balance Sheet',
    });
  }

  if (debtorBal !== 0) {
    signals.push({
      category: 'Balances',
      signal: 'Trade Receivables (Debtors)',
      value: fmtINR(debtorBal),
      note: debtorBal < 0
        ? 'ANOMALY: Debtors negative — customer overpayment or Dr/Cr flip'
        : revenue > 0 ? `${pct(debtorBal, revenue)} of revenue — monitor for overdue` : 'From Balance Sheet',
    });
  }

  if (creditorBal !== 0) {
    signals.push({
      category: 'Balances',
      signal: 'Trade Payables (Creditors)',
      value: fmtINR(creditorBal),
      note: creditorBal > 0
        ? 'ANOMALY: Creditors positive (Dr balance) — possible overpayment or misposting'
        : 'Outstanding supplier balances',
    });
  }

  // ── Inventory ─────────────────────────────────────────────────────────
  if (closingStock > 0) {
    signals.push({
      category: 'Inventory',
      signal: 'Closing Stock',
      value: fmtINR(closingStock),
      note: 'Per Balance Sheet',
    });

    if (tbPurch > 0 && openingStock >= 0) {
      const cogs = openingStock + tbPurch - closingStock;
      if (cogs > 0) {
        signals.push({
          category: 'Inventory',
          signal: 'Cost of Goods Sold (est.)',
          value: fmtINR(cogs),
          note: 'Opening Stock + Purchases − Closing Stock',
        });

        if (revenue > 0) {
          const grossMargin = (revenue - cogs) / revenue;
          signals.push({
            category: 'Inventory',
            signal: 'Gross Margin (est.)',
            value: pct(revenue - cogs, revenue),
            note: grossMargin >= 0.25 ? 'Healthy gross margin' : 'Low gross margin — check purchase/sales mix',
          });
        }
      }
    }
  }

  // ── DayBook stats ─────────────────────────────────────────────────────
  if (dbStats) {
    const { totalVouchers, narrated, highValueCount, highValueNarrated } = dbStats;

    signals.push({
      category: 'Recording Quality',
      signal: 'Total Vouchers',
      value: totalVouchers.toLocaleString('en-IN'),
      note: 'Entries in DayBook',
    });

    if (totalVouchers > 0) {
      signals.push({
        category: 'Recording Quality',
        signal: 'Narration Coverage',
        value: pct(narrated, totalVouchers),
        note: narrated / totalVouchers >= 0.7 ? 'Acceptable narration rate' : 'Below 70% — improve narration discipline',
      });
    }

    if (highValueCount > 0) {
      signals.push({
        category: 'Recording Quality',
        signal: 'High-Value Narration Rate',
        value: pct(highValueNarrated, highValueCount),
        note: `${highValueCount} entries >₹1L; ${highValueNarrated} narrated`,
      });
    }
  }

  return signals;
}
