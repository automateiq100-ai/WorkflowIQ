'use client';

/**
 * ── Industry Templates ───────────────────────────────────────────────────
 *
 * One-click preset packs of (ledger-name-pattern → category) mappings for
 * the most common Indian SME industry verticals.  The user picks an
 * industry on a fresh company and 30-50 typical ledgers get pre-classified
 * in one click — they only have to manually review the residual.
 *
 * Where this fits architecturally:
 *
 *   1. Override store (per-company, persisted via Phase 2 Supabase) wins
 *   2. Tally master-map walk (catalog) — handles standard groups
 *   3. BS-hierarchy fallback (Phase 6)
 *   4. Pattern fallback (regex)
 *
 * Industry templates *create overrides* — they slot into Layer 1 above.
 * That's the design choice: templates aren't a separate classification
 * tier, they're seeded user overrides.  Two consequences:
 *
 *   • Applying a template is reversible per row (user can override the
 *     template for any specific ledger).
 *   • Multi-device sync works automatically (overrides go to Supabase).
 *
 * Patterns are case-insensitive substrings on the lowercased ledger name.
 * Regex would be more powerful but harder to author and audit; substring
 * is good enough for the long tail of vertical-specific naming.
 */

import type { LedgerCategory } from './tally-groups';

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  /** Patterns applied in order — first match wins.  Use the most
   *  specific pattern first (e.g. "patient" before "receipt"). */
  rules: Array<{ pattern: string; category: LedgerCategory; primaryGroup?: string }>;
}

const SERVICES_TEMPLATE: IndustryTemplate = {
  id: 'services',
  name: 'Services / Consulting',
  description: 'Professional services, consultancies, IT/ITES, agencies — software/SaaS revenue + payroll-heavy expenses',
  rules: [
    // Income
    { pattern: 'amc', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'consulting', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'consultancy', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'professional fee', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'service revenue', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'subscription', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'retainer', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'license fee', category: 'sales', primaryGroup: 'Sales Accounts' },

    // Expenses
    { pattern: 'salary', category: 'indirect-expense' },
    { pattern: 'wages', category: 'direct-expense' },
    { pattern: 'rent', category: 'indirect-expense' },
    { pattern: 'office expense', category: 'indirect-expense' },
    { pattern: 'travel', category: 'indirect-expense' },
    { pattern: 'internet', category: 'indirect-expense' },
    { pattern: 'subscription expense', category: 'indirect-expense' },
    { pattern: 'aws', category: 'indirect-expense' },
    { pattern: 'gcp', category: 'indirect-expense' },
    { pattern: 'azure', category: 'indirect-expense' },
    { pattern: 'cloud', category: 'indirect-expense' },
    { pattern: 'marketing', category: 'indirect-expense' },
    { pattern: 'advertis', category: 'indirect-expense' },
  ],
};

const TRADING_TEMPLATE: IndustryTemplate = {
  id: 'trading',
  name: 'Trading / Distribution',
  description: 'Wholesale or retail trading — stock-heavy, sales returns, freight, godown rent',
  rules: [
    // Stock & inventory
    { pattern: 'opening stock', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'closing stock', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'stock', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'inventory', category: 'stock', primaryGroup: 'Stock-in-Hand' },

    // Direct expenses (CoGS-related)
    { pattern: 'carriage inward', category: 'direct-expense' },
    { pattern: 'freight inward', category: 'direct-expense' },
    { pattern: 'transport inward', category: 'direct-expense' },
    { pattern: 'octroi', category: 'direct-expense' },
    { pattern: 'loading', category: 'direct-expense' },
    { pattern: 'godown rent', category: 'direct-expense' },
    { pattern: 'warehouse rent', category: 'direct-expense' },

    // Indirect expenses (shipping/distribution)
    { pattern: 'carriage outward', category: 'indirect-expense' },
    { pattern: 'freight outward', category: 'indirect-expense' },
    { pattern: 'delivery', category: 'indirect-expense' },
    { pattern: 'commission paid', category: 'indirect-expense' },
    { pattern: 'discount allowed', category: 'indirect-expense' },

    // Income
    { pattern: 'discount received', category: 'indirect-income' },
    { pattern: 'commission received', category: 'indirect-income' },
  ],
};

const MANUFACTURING_TEMPLATE: IndustryTemplate = {
  id: 'manufacturing',
  name: 'Manufacturing',
  description: 'Production businesses — raw material, WIP, finished goods, factory overheads',
  rules: [
    { pattern: 'raw material', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'work in progress', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'wip', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'finished goods', category: 'stock', primaryGroup: 'Stock-in-Hand' },
    { pattern: 'consumables', category: 'direct-expense' },
    { pattern: 'spares', category: 'direct-expense' },
    { pattern: 'factory wages', category: 'direct-expense' },
    { pattern: 'production wages', category: 'direct-expense' },
    { pattern: 'factory rent', category: 'direct-expense' },
    { pattern: 'power & fuel', category: 'direct-expense' },
    { pattern: 'electricity', category: 'direct-expense' },
    { pattern: 'fuel', category: 'direct-expense' },
    { pattern: 'manufacturing expense', category: 'direct-expense' },
    { pattern: 'plant maintenance', category: 'indirect-expense' },
    { pattern: 'machinery repair', category: 'indirect-expense' },
    { pattern: 'depreciation', category: 'indirect-expense' },
    { pattern: 'plant', category: 'fixed-asset', primaryGroup: 'Fixed Assets' },
    { pattern: 'machinery', category: 'fixed-asset', primaryGroup: 'Fixed Assets' },
  ],
};

const HEALTHCARE_TEMPLATE: IndustryTemplate = {
  id: 'healthcare',
  name: 'Healthcare / Medical',
  description: 'Hospitals, clinics, diagnostics — patient revenue + medical consumables',
  rules: [
    { pattern: 'patient', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'consultation fee', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'opd', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'ipd', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'pharmacy sale', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'lab', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'diagnostic', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'surgery', category: 'sales', primaryGroup: 'Sales Accounts' },
    { pattern: 'medicine purchase', category: 'purchase', primaryGroup: 'Purchase Accounts' },
    { pattern: 'pharmacy purchase', category: 'purchase', primaryGroup: 'Purchase Accounts' },
    { pattern: 'medical consumable', category: 'direct-expense' },
    { pattern: 'doctor fee', category: 'direct-expense' },
    { pattern: 'nursing', category: 'direct-expense' },
    { pattern: 'medical equipment', category: 'fixed-asset', primaryGroup: 'Fixed Assets' },
  ],
};

const NGO_TEMPLATE: IndustryTemplate = {
  id: 'ngo',
  name: 'Non-Profit / NGO',
  description: 'Trusts, societies, NGOs — donation revenue, grant accounting',
  rules: [
    { pattern: 'donation received', category: 'indirect-income' },
    { pattern: 'grant received', category: 'indirect-income' },
    { pattern: 'fcra', category: 'indirect-income' },
    { pattern: 'corpus fund', category: 'capital', primaryGroup: 'Capital Account' },
    { pattern: 'general fund', category: 'capital', primaryGroup: 'Capital Account' },
    { pattern: 'restricted fund', category: 'capital', primaryGroup: 'Capital Account' },
    { pattern: 'membership fee', category: 'indirect-income' },
    { pattern: 'donation paid', category: 'indirect-expense' },
    { pattern: 'programme expense', category: 'indirect-expense' },
    { pattern: 'project expense', category: 'indirect-expense' },
  ],
};

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  SERVICES_TEMPLATE,
  TRADING_TEMPLATE,
  MANUFACTURING_TEMPLATE,
  HEALTHCARE_TEMPLATE,
  NGO_TEMPLATE,
];

/** Find the matching template rule for a ledger name (lowercased
 *  substring match — first rule that fits wins).  Returns undefined
 *  when no rule matches. */
export function matchTemplate(
  template: IndustryTemplate,
  ledgerName: string,
): { category: LedgerCategory; primaryGroup?: string } | undefined {
  const lname = ledgerName.toLowerCase();
  for (const rule of template.rules) {
    if (lname.includes(rule.pattern)) {
      return { category: rule.category, primaryGroup: rule.primaryGroup };
    }
  }
  return undefined;
}
