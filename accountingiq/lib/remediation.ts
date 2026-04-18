import type { Check, ParsedData } from './types';

function fmt(n: number): string {
  if (!n || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/**
 * Returns a specific, data-driven remediation instruction for a failing check.
 * Uses actual parsed figures wherever available so the CA gets exact steps, not generic guidance.
 */
export function getRemediation(check: Check, parsedData: Partial<ParsedData>): string | null {
  const note = check.note ?? '';

  switch (check.id) {

    // ── A: Data Completeness ─────────────────────────────────────────────────
    case 'A1':
      return 'The Day Book file could not be parsed or was not uploaded. Re-export from Tally: Gateway of Tally → Display → Day Book → set period to 1 Apr to 31 Mar → press Alt+E → select XML format → export. Upload the resulting .xml file. Ensure all voucher types (Sales, Purchase, Payment, Receipt, Journal, Contra) are included.';

    case 'A2':
      return 'The Trial Balance file could not be parsed. Re-export from Tally: Gateway of Tally → Display → Trial Balance → set date to 31 Mar → press Alt+E → XML format. Verify the exported file opens correctly before uploading.';

    case 'A3':
      return 'The Profit & Loss file could not be parsed. Re-export from Tally: Gateway of Tally → Display → Profit & Loss A/c → set date to 31 Mar → press Alt+E → XML. Confirm the report shows revenue and expense figures before exporting.';

    case 'A4':
      return 'The Balance Sheet file could not be parsed. Re-export from Tally: Gateway of Tally → Display → Balance Sheet → set date to 31 Mar → press Alt+E → XML. Verify total assets equals total liabilities + capital in Tally before exporting.';

    case 'A5':
      return 'The Group Summary file could not be parsed. Re-export from Tally: Gateway of Tally → Display → Group Summary → select "All Groups" → press Alt+E → XML. This report is required to verify ledger group classifications.';

    case 'A6': {
      // note: "${N} vouchers outside FY"
      const m = note.match(/(\d+)\s+voucher/);
      const count = m ? m[1] : 'some';
      return `${count} voucher${count !== '1' ? 's' : ''} have dates outside the financial year (April–March). Steps to fix:\n\n1. In Tally, go to Gateway → Display → Day Book.\n2. Press Alt+F2 and set the period to 1-Apr-1900 to 31-Mar-2099 to show ALL vouchers regardless of date.\n3. Look for entries dated before 1 April or after 31 March of this FY.\n4. For each such entry: press Enter → correct the date to the appropriate period.\n5. If the entry genuinely belongs to a different year, either delete it or move it to a separate company file for that year.`;
    }

    case 'A7':
      return 'Opening balances are missing from the Trial Balance. To enter them in Tally:\n\n1. Gateway → Accounts Info → Ledgers → Multi-alter (press Alt+Enter).\n2. For each ledger that had a balance from the previous year, enter the Opening Balance and select Dr or Cr side.\n3. Alternatively: Gateway → Accounts Info → Groups → alter the relevant group → enable "Opening Balance" if disabled.\n4. After entry, verify the Trial Balance shows the opening balance row at the top.';

    // ── B: Ledger Structure ──────────────────────────────────────────────────
    case 'B1': {
      const ledgers = parsedData.suspenseLedgers ?? [];
      if (ledgers.length > 0) {
        const lines = ledgers.map(l =>
          `• "${l.name}" — balance: ${fmt(Math.abs(l.amount))} ${l.amount < 0 ? 'Cr' : 'Dr'}`,
        ).join('\n');
        return `The following ${ledgers.length} suspense/miscellaneous ledger${ledgers.length > 1 ? 's' : ''} have non-zero balances:\n\n${lines}\n\nFor each ledger above:\n1. Gateway → Display → Ledger → select the ledger name → press Enter to see all transactions.\n2. For each transaction, identify what it represents (vendor payment, salary, expense, etc.).\n3. Create a proper ledger for it if one doesn't exist (e.g., "Staff Welfare Expenses" under Indirect Expenses).\n4. Pass a Journal voucher: Dr [correct ledger] → Cr [suspense ledger] for the exact amount.\n5. Repeat until the suspense ledger balance is zero.\n6. Once zero, you may delete the suspense ledger or leave it dormant.`;
      }
      return 'Suspense/miscellaneous ledgers have non-zero balances. Go to Gateway → Display → Ledger → select each suspense ledger → identify and reclassify all transactions via Journal vouchers until the balance is zero.';
    }

    case 'B2': {
      const pairs = parsedData.dupPairDetails ?? [];
      if (pairs.length > 0) {
        const listed = pairs.slice(0, 5).map(([a, b]) => `• "${a}"  ↔  "${b}"`).join('\n');
        const more = pairs.length > 5 ? `\n… and ${pairs.length - 5} more pair(s).` : '';
        return `${pairs.length} near-duplicate ledger pair${pairs.length > 1 ? 's' : ''} detected. These likely represent the same party entered twice under slightly different names:\n\n${listed}${more}\n\nFor each pair, decide which name to keep (the primary), then:\n1. Gateway → Display → Ledger → [duplicate ledger] to see its full transaction history and closing balance.\n2. Pass a Journal voucher to transfer the balance: Dr [duplicate] → Cr [primary] (or reverse if Cr balance).\n3. Go back through the Day Book and manually reassign any linked entries if needed.\n4. Once the duplicate ledger balance is zero, delete it: Gateway → Accounts Info → Ledgers → Delete → [duplicate].\n5. Repeat for each pair.`;
      }
      return 'Near-duplicate ledger names detected. Identify the pairs, merge entries into one ledger via Journal, then delete the duplicate.';
    }

    case 'B3':
      return 'No Capital or Owner\'s Equity ledger found. Steps:\n1. Gateway → Accounts Info → Ledgers → Create.\n2. Name: "Capital Account" (or "[Owner Name] Capital").\n3. Group: "Capital Account".\n4. Enter the opening capital balance (what the owner invested).\n5. If this is a company, create "Share Capital" under "Share Capital" group instead.\n6. Verify it appears on the Balance Sheet under Capital & Liabilities after creation.';

    case 'B4':
      return 'Sales ledgers are grouped incorrectly. To fix:\n1. Gateway → Accounts Info → Ledgers → Alter → select each sales-type ledger (e.g., "Sales – 18% GST", "Export Sales", "Service Income").\n2. Change the Group to "Sales Accounts".\n3. Save and verify the ledger now appears under Sales in the P&L.\n4. If you are unsure which ledgers are affected, check Gateway → Display → Trial Balance → expand "Direct Incomes" or other groups to find misplaced sales ledgers.';

    case 'B5':
      return 'Purchase ledgers are grouped incorrectly. To fix:\n1. Gateway → Accounts Info → Ledgers → Alter → select each purchase-type ledger (e.g., "Purchases – Local", "Raw Material Purchases").\n2. Change the Group to "Purchase Accounts".\n3. Save and verify the ledger appears under Purchases in the P&L.\n4. Check Gateway → Display → Trial Balance → expand "Direct Expenses" to find any misplaced purchase ledgers.';

    case 'B6':
      return 'No Bank Account ledger found. Steps:\n1. Gateway → Accounts Info → Ledgers → Create.\n2. Name: "[Bank Name] Current A/c" (e.g., "HDFC Bank – Current A/c").\n3. Group: "Bank Accounts".\n4. Under Bank Details: enter Account Number, IFSC Code, Branch.\n5. Enter the opening balance (bank statement balance on 1 April).\n6. Create separate ledgers for each bank account.\n7. Re-enter any bank transactions (receipts, payments) using this ledger.';

    case 'B7':
      return 'No Cash-in-Hand ledger found. Tally creates a default "Cash" ledger — it may have been renamed or deleted. Steps:\n1. Check if it exists under a different name: Gateway → Accounts Info → Ledgers → scroll through the list.\n2. If missing, create: Gateway → Accounts Info → Ledgers → Create → Name: "Cash" → Group: "Cash-in-Hand".\n3. Enter the opening cash balance as on 1 April.\n4. Ensure all cash transactions (petty cash, cash sales, cash purchases) are posted to this ledger.';

    case 'B8':
      return 'No Sundry Debtors ledger found. This means customer ledgers are either absent or placed under the wrong group. Steps:\n1. Gateway → Accounts Info → Ledgers → check if customer names exist under any group.\n2. If found under wrong group: alter each → change Group to "Sundry Debtors".\n3. If no customer ledgers exist: create one per customer → Group: "Sundry Debtors" → enter outstanding balance.\n4. All Sales vouchers must use a Sundry Debtor ledger as the party account.';

    case 'B9':
      return 'No Sundry Creditors ledger found. This means supplier ledgers are absent or misclassified. Steps:\n1. Gateway → Accounts Info → Ledgers → check if supplier names exist under any group.\n2. If found under wrong group: alter each → change Group to "Sundry Creditors".\n3. If no supplier ledgers exist: create one per supplier → Group: "Sundry Creditors" → enter outstanding balance.\n4. All Purchase vouchers must use a Sundry Creditor ledger as the party account.';

    case 'B10':
      return 'GST or TDS duty ledgers are placed under an Expense group, which inflates your expense total in P&L. Steps:\n1. Gateway → Display → Trial Balance → expand Direct/Indirect Expenses → identify any ledgers named "CGST", "SGST", "IGST", "TDS Payable", "Output GST", "Input ITC".\n2. For each: Gateway → Accounts Info → Ledgers → Alter → change Group to "Duties & Taxes".\n3. After saving, verify the P&L expense total decreases and the Balance Sheet shows these under Current Liabilities → Duties & Taxes.';

    // ── C: Voucher Integrity ─────────────────────────────────────────────────
    case 'C1': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} voucher${count !== '1' ? 's' : ''} are missing voucher numbers. Steps to fix:\n\n1. Go to Gateway → Display → Day Book.\n2. Press F12 (Configure) → set "Show Voucher Numbers" to Yes.\n3. Scroll through and find entries where the voucher number column is blank.\n4. Click on each → press Enter to open → manually enter the voucher number in the "Voucher No." field.\n5. To prevent this going forward: Gateway → Accounts Info → Voucher Types → alter each type → set "Method of Voucher Numbering" to "Automatic".\n6. For automatic numbering, set the starting number and prefix (e.g., "SALES/24-25/001").`;
    }

    case 'C2': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} duplicate voucher number${count !== '1' ? 's' : ''} found in the Day Book. Steps:\n\n1. Gateway → Display → Account Books → Voucher Register → select voucher type (Sales / Purchase / etc.).\n2. Sort by Voucher Number — duplicates will appear adjacent to each other.\n3. For each duplicate: open the older entry → change its number to the next available number in the series.\n4. After fixing, switch all voucher types to Automatic numbering: Gateway → Accounts Info → Voucher Types → Alter → Method: Automatic → Starting Number: [next number after current highest].\n5. This prevents duplicates going forward.`;
    }

    case 'C3': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} trade voucher${count !== '1' ? 's' : ''} are missing the party (ledger) name. Steps:\n\n1. Gateway → Display → Day Book → set period to full year.\n2. Press F12 → enable "Show Ledger Name" column.\n3. Filter by voucher type (Sales, Purchase, Payment, Receipt) and look for entries where the Party A/c Name is blank.\n4. For each: press Enter → add the correct party ledger in the "Party A/c Name" field (first line of the voucher).\n5. If the party ledger doesn't exist yet, create it first: Gateway → Accounts Info → Ledgers → Create → set Group to Sundry Debtors (customers) or Sundry Creditors (suppliers).`;
    }

    case 'C4': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} voucher${count !== '1' ? 's' : ''} have dates outside the financial year. Steps:\n\n1. Gateway → Display → Day Book → press Alt+F2 → set period to 1-Apr-1900 to 31-Mar-2099.\n2. Identify entries with dates before 1 April or after 31 March.\n3. For each entry: press Enter → correct the date. Use the actual transaction date from the source document (invoice, bank statement).\n4. If the entry belongs to a different financial year entirely, delete it here and re-enter it in the correct year's company file.\n5. After correction, verify the Day Book with period set to 1 Apr – 31 Mar shows no entries outside range.`;
    }

    case 'C5': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} wrong-type posting${count !== '1' ? 's' : ''} detected (e.g., sales entered via Journal instead of Sales voucher, or expenses via Receipt). Steps:\n\n1. Gateway → Display → Day Book → filter by Voucher Type = "Journal".\n2. Identify journal entries that are actually sales, purchases, payments, or receipts (they will debit/credit revenue or expense accounts with a cash/bank counterpart).\n3. Note each entry's date, amount, and ledgers.\n4. Delete the incorrectly-typed voucher (press Alt+D in the voucher).\n5. Re-enter using the correct voucher type: Sales (Ctrl+F8), Purchase (Ctrl+F9), Payment (F5), Receipt (F6), Contra (F4).`;
    }

    case 'C6': {
      // note: "X.X% zero-amount vouchers (threshold: 2%)"
      const m = note.match(/([\d.]+)%/);
      const pct = m ? m[1] : 'excess';
      return `${pct}% of vouchers have zero amounts (above the 2% acceptable threshold). Steps:\n\n1. Gateway → Display → Day Book → press F12 → enable "Show Amount" column.\n2. Sort by Amount to bring zero-value entries to the top.\n3. For each zero-amount voucher:\n   a. If it is a genuine error (entered by mistake): press Alt+D to delete.\n   b. If it is an adjustment or placeholder: enter the correct amount from the source document.\n   c. If it is an opening balance reversal or technical entry: verify it is needed; if not, delete.\n4. After corrections, re-run the analysis — zero vouchers below 2% will pass this check.`;
    }

    // ── D: Arithmetical Accuracy ─────────────────────────────────────────────
    case 'D1': {
      // note: "TB imbalance: ₹X (Y%)" or "Minor imbalance: ₹X (Y%)"
      const amtMatch = note.match(/₹([^\s(]+)/);
      const pctMatch = note.match(/\(([^)]+%)\)/);
      const amt = amtMatch ? `₹${amtMatch[1]}` : 'a non-zero amount';
      const pct = pctMatch ? ` (${pctMatch[1]})` : '';
      return `The Trial Balance does not balance — Dr and Cr sides differ by ${amt}${pct}. Steps to identify and fix:\n\n1. Gateway → Display → Trial Balance → check the total Dr and total Cr at the bottom. The difference amount shows exactly what is out of balance.\n2. Most common causes:\n   a. Incorrect side (Dr/Cr) on a ledger's opening balance: Gateway → Accounts Info → Ledgers → find ledgers with suspicious balances (e.g., a liability showing as Dr when it should be Cr) → alter and correct the side.\n   b. A journal voucher where Dr total ≠ Cr total (Tally normally prevents this, but manual imports can cause it).\n   c. Deleted voucher that was partially recorded.\n3. To trace the imbalance: Display → Trial Balance → drill into each group until you find the ledger whose balance looks wrong.\n4. Once found, correct the opening balance or the voucher entry causing the difference.`;
    }

    case 'D2': {
      const np = parsedData.netProfit;
      const bsnp = parsedData.bsNetProfit;
      const npStr = np != null ? fmt(np) : '(not detected)';
      const bsnpStr = bsnp != null ? fmt(bsnp) : '(not detected)';
      return `P&L Net Profit (${npStr}) does not match the Profit & Loss A/c line in the Balance Sheet (${bsnpStr}). Steps:\n\n1. Go to Gateway → Display → Ledger → select "Profit & Loss A/c" → check all entries posted directly to this ledger.\n2. Any direct journal entry like: Dr Expense → Cr Profit & Loss A/c (or vice versa) will cause this mismatch. These bypass the income/expense accounts.\n3. Identify and reverse each such entry: note the date and amount → delete the journal → re-enter using the correct income/expense ledger.\n4. After corrections, the "Profit & Loss A/c" line on the Balance Sheet should equal the Net Profit on the P&L statement.`;
    }

    case 'D3':
      return 'The Balance Sheet does not balance (Assets ≠ Liabilities + Capital). Steps:\n\n1. Gateway → Display → Balance Sheet → note which side (assets or liabilities) is higher and by how much.\n2. Common causes:\n   a. An income or expense ledger placed under a Balance Sheet group (e.g., "Salary" under "Current Liabilities").\n   b. A Balance Sheet ledger placed under an income/expense group.\n3. To find misclassified ledgers: Display → Trial Balance → drill into each group → look for ledgers that seem out of place.\n4. Fix: Gateway → Accounts Info → Ledgers → Alter → change the Group to the correct one.\n5. After corrections, the Balance Sheet should balance automatically.';

    case 'D4': {
      const tb = parsedData.tbTotal;
      const tbStr = tb != null ? fmt(tb) : '(not detected)';
      return `Trial Balance total (${tbStr}) does not match the Balance Sheet total assets. Steps:\n\n1. The difference usually means some income or expense ledgers are under Balance Sheet groups, or vice versa.\n2. Gateway → Display → Trial Balance → note the grand total of Dr column.\n3. Gateway → Display → Balance Sheet → note the total assets figure.\n4. Compare the two. The gap points to misclassified ledgers — find them by drilling through the TB groups.\n5. Fix each by altering the ledger group: Gateway → Accounts Info → Ledgers → Alter → change Group.`;
    }

    case 'D5': {
      const closing = parsedData.closingStock;
      const opening = parsedData.openingStock;
      const closingStr = closing != null && closing !== 0 ? fmt(Math.abs(closing)) : null;
      const openingStr = opening != null && opening !== 0 ? fmt(Math.abs(opening)) : null;
      return `Closing stock is not recorded in the Balance Sheet${closingStr ? ` (P&L shows closing stock of ${closingStr})` : ''}. Steps:\n\n1. First confirm the physical stock count as on 31 March and note the value.\n2. Create a "Closing Stock" ledger if it doesn't exist: Gateway → Accounts Info → Ledgers → Create → Name: "Closing Stock" → Group: "Stock-in-Hand" (under Current Assets).\n3. Create a "Closing Stock (P&L)" ledger if needed → Group: "Closing Stock" (under Direct Income / Direct Expense).\n4. Pass a year-end Journal entry:\n   Dr Closing Stock (BS) [Stock-in-Hand] → ${closingStr ?? 'stock value'}\n   Cr Closing Stock (P&L) [Direct Income] → ${closingStr ?? 'stock value'}\n5. After posting, the Balance Sheet should show the closing stock${openingStr ? ` and the P&L opening stock of ${openingStr} should be carried forward` : ''}.`;
    }

    // ── E: Statutory Accuracy ────────────────────────────────────────────────
    case 'E1': {
      const outputGST = parsedData.outputGSTAmt;
      const gstStr = outputGST != null && outputGST !== 0 ? fmt(outputGST) : null;
      return `No Output GST ledger found${gstStr ? ` — expected approximately ${gstStr} based on sales` : ''}. Steps:\n\n1. First enable GST in Tally: Gateway → F11 (Features) → Statutory & Taxation → enable "Enable Goods and Services Tax (GST)" → enter your GSTIN and registration details.\n2. Create the following ledgers under Group: "Duties & Taxes":\n   • "Output CGST" (for intra-state sales)\n   • "Output SGST" (for intra-state sales)\n   • "Output IGST" (for inter-state sales)\n3. Alter each sales ledger: Gateway → Accounts Info → Ledgers → Alter → under GST Details, set the tax type, HSN/SAC code, and rate.\n4. Re-enter sales vouchers (or alter existing) to include the GST tax lines.\n5. Verify GST computation: Gateway → Display → Statutory Reports → GST Reports → GSTR-1.`;
    }

    case 'E2a':
      return 'Some sales ledgers do not have a GST rate configured. Steps:\n\n1. Gateway → Display → Trial Balance → expand "Sales Accounts" to list all sales ledgers.\n2. For each sales ledger: Gateway → Accounts Info → Ledgers → Alter → scroll down to "GST Details".\n3. Set:\n   • Nature of Transaction: "Sales Taxable" (or "Sales Exempt" / "Sales Nil Rated" as applicable)\n   • HSN/SAC Code: the applicable code for your goods/services\n   • Tax Rate: e.g., 5%, 12%, 18%, or 28%\n4. Save each ledger.\n5. Sales vouchers using this ledger will now auto-compute the GST amount.\n6. Verify in a sample sales voucher that CGST + SGST or IGST lines populate automatically.';

    case 'E2b': {
      const gstDiff = parsedData.gstDiffPct;
      const output = parsedData.outputGSTAmt;
      const diffStr = gstDiff != null ? `${(gstDiff * 100).toFixed(1)}%` : 'a significant percentage';
      const outputStr = output != null ? fmt(output) : null;
      return `Output GST in books (${outputStr ?? 'recorded amount'}) differs from the computed GST on sales by ${diffStr}. Steps to identify the discrepancy:\n\n1. Export GSTR-1 from Tally: Gateway → Display → Statutory Reports → GST → GSTR-1. Note the total tax liability.\n2. Compare with your filed GSTR-1 on the GST portal (www.gst.gov.in).\n3. Common causes of mismatch:\n   a. Some sales vouchers don't have GST tax lines → edit those vouchers and add CGST/SGST/IGST ledgers with the correct rate.\n   b. GST rate on a ledger is wrong → alter the ledger's GST rate (see E2a steps).\n   c. Exempt / nil-rated sales incorrectly classified as taxable.\n4. Correct each voucher causing the discrepancy.\n5. Reconcile the corrected Tally data with your GSTR-3B filed returns.`;
    }

    case 'E3': {
      const itc = parsedData.inputITCAmt;
      const itcStr = itc != null && itc !== 0 ? fmt(Math.abs(itc)) : null;
      return `No Input ITC (Input Tax Credit) ledger found${itcStr ? ` — expected approximately ${itcStr} based on purchases` : ''}. Steps:\n\n1. Create the following ledgers under Group: "Duties & Taxes":\n   • "Input CGST" (ITC on intra-state purchases)\n   • "Input SGST" (ITC on intra-state purchases)\n   • "Input IGST" (ITC on inter-state purchases)\n2. Alter each purchase ledger: Gateway → Accounts Info → Ledgers → Alter → set GST details (Nature: "Purchases Taxable", HSN code, rate).\n3. Re-enter or alter each purchase voucher: add ITC ledger lines (Input CGST + Input SGST or Input IGST).\n4. Ensure you claim ITC only on eligible purchases (not blocked under Section 17(5) of CGST Act).\n5. Verify total ITC claimed matches GSTR-2B auto-populated data.`;
    }

    case 'E4': {
      const itc = parsedData.inputITCAmt;
      const output = parsedData.outputGSTAmt;
      const itcStr = itc != null ? fmt(Math.abs(itc)) : '(ITC amount)';
      const outputStr = output != null ? fmt(output) : '(output GST amount)';
      return `Input ITC claimed (${itcStr}) exceeds Output GST liability (${outputStr}). Steps:\n\n1. Verify the ITC amount: Gateway → Display → Ledger → select each Input CGST/SGST/IGST ledger → check the total balance.\n2. Verify Output GST: Gateway → Display → Ledger → select each Output CGST/SGST/IGST → check total.\n3. Review purchases where ITC was claimed:\n   a. Section 17(5) blocks ITC on: motor vehicles (personal use), food & beverages, club memberships, construction (when not in that business), works contract (capitalised).\n   b. Purchases from unregistered dealers: remove ITC from these vouchers.\n   c. Purchases of capital goods: ITC may be restricted to 50% in certain cases.\n4. For each ineligible purchase, open the voucher → remove the ITC ledger line or reverse via a credit note.\n5. After corrections, ITC should not exceed Output GST (excess is unusual and triggers GST scrutiny).`;
    }

    case 'E5':
      return 'No TDS Payable ledger found. Steps:\n\n1. Create the TDS ledger: Gateway → Accounts Info → Ledgers → Create → Name: "TDS Payable" → Group: "Duties & Taxes" → Tax Type: TDS.\n2. Identify all payments made during the year where TDS should have been deducted:\n   • Professional/Technical fees (Sec 194J): 10%\n   • Contractor payments (Sec 194C): 2% (companies), 1% (individuals/HUF)\n   • Rent (Sec 194I): 10%\n   • Interest (Sec 194A): 10%\n3. For each such payment: open the Payment voucher → add TDS Payable ledger for the TDS amount → reduce the cash/bank payment by the TDS deducted.\n4. Enter monthly challans paid: Dr TDS Payable → Cr Bank (when TDS is remitted to government).';

    case 'E6':
      return 'TDS amounts could not be verified from available data. Ensure:\n\n1. TDS is deducted at correct statutory rates on every applicable payment:\n   • Sec 194J (Professional fees): 10%\n   • Sec 194C (Contracts): 2% companies / 1% individual-HUF (below ₹30,000 single, ₹1L aggregate exempt)\n   • Sec 194I (Rent): 10% (immovable), 2% (plant & machinery)\n   • Sec 194H (Commission): 5%\n2. Verify TDS amount in Tally: Display → Statutory Reports → TDS Reports → TDS Computation.\n3. Cross-check with TRACES portal (www.tdscpc.gov.in) for Form 26Q/27Q filed returns.\n4. Any short-deduction must be corrected by raising a debit note to the party for the TDS shortfall.';

    case 'E7':
      return 'No PF/ESI Payable ledger found. Steps:\n\n1. Create two ledgers: Gateway → Accounts Info → Ledgers → Create:\n   • "Provident Fund Payable" → Group: "Duties & Taxes"\n   • "ESI Payable" → Group: "Duties & Taxes"\n2. For each month\'s salary entry, the journal should be:\n   Dr Salary & Wages A/c → [gross salary total]\n   Cr Net Salary Payable → [gross − employee PF 12% − employee ESI 0.75%]\n   Cr Provident Fund Payable → [employer PF 12% + employee PF 12% = 24%]\n   Cr ESI Payable → [employer ESI 3.25% + employee ESI 0.75% = 4%]\n3. When PF/ESI is remitted: Dr PF Payable / ESI Payable → Cr Bank.\n4. Monthly due dates: PF by 15th, ESI by 21st of following month.';

    case 'E8': {
      const fa = parsedData.fixedAssets;
      const faStr = fa != null && fa !== 0 ? fmt(Math.abs(fa)) : null;
      return `No depreciation entry found in P&L${faStr ? ` — Fixed Assets value is ${faStr}` : ''}. Steps:\n\n1. Calculate depreciation on each fixed asset at the applicable rate:\n   • Computers & peripherals: 40% (IT Act) / 33.33% (Companies Act)\n   • Plant & Machinery: 15% (IT Act) / 5-25% (Companies Act)\n   • Vehicles: 15% (IT Act)\n   • Furniture & Fixtures: 10% (IT Act)\n   • Buildings: 5% (IT Act)\n${faStr ? `   Total fixed assets to depreciate: ${faStr}\n` : ''}2. Create ledgers if needed:\n   • "Depreciation" → Group: "Indirect Expenses"\n   • "Accumulated Depreciation" → under the Fixed Asset group (or reduce the asset directly)\n3. Pass year-end Journal:\n   Dr Depreciation A/c → [calculated amount]\n   Cr [Fixed Asset] A/c (or Accumulated Depreciation) → [same amount]\n4. Repeat for each category of fixed asset.`;
    }

    case 'E9': {
      const dep = parsedData.depAmt;
      const fa = parsedData.fixedAssets;
      const depStr = dep != null ? fmt(Math.abs(dep)) : '(recorded amount)';
      const faStr = fa != null ? fmt(Math.abs(fa)) : '(total fixed assets)';
      return `Depreciation amount (${depStr}) is unreasonable relative to Fixed Assets (${faStr}). Steps:\n\n1. Verify the Fixed Assets value: Gateway → Display → Balance Sheet → expand Fixed Assets group → note the value of each asset category.\n2. Recalculate depreciation:\n   • WDV (Written Down Value) = Opening WDV × Rate%\n   • Example: Plant ₹10L × 15% = ₹1.5L depreciation\n3. If recorded depreciation (${depStr}) is zero: you have likely forgotten the year-end depreciation journal. Pass it now (see E8 steps).\n4. If it exceeds fixed assets: depreciation was applied to the original cost instead of WDV, or the rate is wrong. Correct the journal amount.\n5. Amend the depreciation journal entry to reflect the correctly calculated amount.`;
    }

    case 'E10': {
      const closing = parsedData.closingStock;
      const closingStr = closing != null && closing !== 0 ? fmt(Math.abs(closing)) : null;
      return `No closing stock recorded in the Balance Sheet${closingStr ? ` (P&L appears to reference ${closingStr})` : ''}. Steps:\n\n1. Conduct a physical stock count as on 31 March and value it at cost (or NRV if lower).\n2. Create the "Closing Stock" ledger: Group: "Stock-in-Hand" (under Current Assets).\n3. Pass journal entry:\n   Dr Closing Stock (BS) → [stock value]\n   Cr Change in Stock / Closing Stock (P&L) → [stock value]\n4. This increases Current Assets and reduces Cost of Goods Sold, improving profitability.\n5. If you use Tally inventory features, ensure stock items are linked to purchase/sales vouchers and enable "Maintain Stock" in F11.`;
    }

    case 'E11': {
      const opening = parsedData.openingStock;
      const closing = parsedData.closingStock;
      const openStr = opening != null ? fmt(Math.abs(opening)) : '(opening stock)';
      const closeStr = closing != null ? fmt(Math.abs(closing)) : '(closing stock)';
      return `Stock equation does not balance. Your data shows Opening Stock: ${openStr}, Closing Stock: ${closeStr}.\n\nExpected: Opening Stock + Purchases − Cost of Goods Sold = Closing Stock.\n\nSteps:\n1. Verify the physical closing stock count matches the Tally figure.\n2. Check if all purchase returns/credit notes are entered correctly.\n3. Check if all stock consumption or internal use is recorded.\n4. Verify the opening stock matches last year's closing stock.\n5. Gateway → Display → Balance Sheet → Stock Summary → drill into stock items to find discrepancies.`;
    }

    case 'E12':
      return 'No stock movement entries found. Steps:\n\n1. If using Tally inventory: enable it in F11 → Inventory Features → "Maintain Stock" → Yes.\n2. Create stock items: Gateway → Inventory Info → Stock Items → Create (Name, Group, Unit of Measure).\n3. Link stock items to purchase vouchers: each Purchase voucher should have a Stock Item line with quantity and rate.\n4. Link to sales vouchers similarly.\n5. If not using inventory features, at minimum post a closing stock journal (see E10 steps). Tally will not track item-wise movement without inventory enabled.';

    // ── F: Recording Discipline ──────────────────────────────────────────────
    case 'F1': {
      const m = note.match(/([\d.]+)\s*days/);
      const days = m ? m[1] : 'more than 30';
      return `A gap of ${days} days exists between consecutive entry dates, indicating a period of no bookkeeping. Steps:\n\n1. Gateway → Display → Day Book → set the period to the full year.\n2. Look for months where no entries appear — these are the gap periods.\n3. Gather the source documents for those months: bank statements, invoices, bills, salary records.\n4. Enter all missing transactions with their actual dates.\n5. For bank entries: use the Bank Reconciliation statement (Banking → Bank Reconciliation) to ensure no bank transactions are missed.\n6. After catch-up entry, set up a routine of weekly or fortnightly bookkeeping to prevent future gaps.`;
    }

    case 'F2':
      return 'Books are not updated to the full financial year end (31 March). Steps:\n\n1. Gather all source documents from the last incomplete month(s): bank statements, invoices, salary slips, utility bills.\n2. Enter each transaction with its actual date in Tally.\n3. Run a Bank Reconciliation: Gateway → Banking → Bank Reconciliation → reconcile up to 31 March.\n4. Post year-end adjustments:\n   • Depreciation journal\n   • Outstanding expenses (prepaid/accruals)\n   • Closing stock journal\n5. Verify the Day Book shows entries up to 31 March.';

    case 'F3': {
      const m = note.match(/([\d.]+)%/);
      const pct = m ? m[1] : 'below threshold';
      return `Only ${pct}% of vouchers have narrations (minimum 70% required, 90%+ is ideal). Steps:\n\n1. Enable narration for all voucher types: F12 (Configure) in any voucher → set "Provide Narrations" → Yes (both voucher-level and ledger-level).\n2. Gateway → Display → Day Book → look for entries without narration (narration column blank).\n3. For each blank narration: press Enter → add a description such as:\n   • Payment voucher: "Paid to [Party] against Invoice #[X] dated [date]"\n   • Receipt: "Received from [Party] — Invoice #[X]"\n   • Journal: "Depreciation on Plant & Machinery for FY 24-25"\n4. For future vouchers, make narration mandatory in your bookkeeping process.`;
    }

    case 'F4': {
      // note: "X/Y high-value entries narrated" or "Only X/Y ..."
      const m = note.match(/(\d+)\/(\d+)/);
      const missing = m ? `${parseInt(m[2]) - parseInt(m[1])} of ${m[2]}` : 'several';
      return `${missing} high-value entries (above ₹1 lakh) are missing narrations. These entries are at highest risk of tax scrutiny. Steps:\n\n1. Gateway → Display → Day Book → sort by Amount (descending) — press Ctrl+F to configure sort column.\n2. Identify entries above ₹1 lakh with blank narrations.\n3. For each, add a narration that includes:\n   • Who: party name and relationship\n   • What: nature of transaction (raw material purchase, loan repayment, capital contribution, etc.)\n   • Reference: invoice number, agreement number, or bank ref\n   • Example: "Payment to XYZ Traders — Invoice #2024/567 — Raw Material Purchase"\n4. Priority: fix narrations on cash entries above ₹50,000 first (Section 269ST documentation requirements).`;
    }

    case 'F5': {
      const m = note.match(/([\d.]+)%/);
      const pct = m ? m[1] : 'excess';
      return `Journal vouchers represent ${pct}% of total entries (above the 25% threshold). Journals should only be used for adjustments — not for routine transactions. Steps:\n\n1. Gateway → Display → Day Book → filter by Voucher Type = "Journal".\n2. Review each journal entry. Ask: "Could this have been entered as a proper voucher type?"\n3. If a journal entry is:\n   • Cash/bank payment → re-enter as Payment voucher (F5)\n   • Cash/bank receipt → re-enter as Receipt voucher (F6)\n   • Sales invoice → re-enter as Sales voucher (Ctrl+F8 or F8)\n   • Purchase bill → re-enter as Purchase voucher (Ctrl+F9 or F9)\n   • Bank-to-cash or bank-to-bank → re-enter as Contra voucher (F4)\n4. Delete the incorrect journal, then re-enter with the correct type.\n5. Legitimate journals: depreciation, provisions, closing stock, accruals, write-offs.`;
    }

    case 'F6': {
      const m = note.match(/([\d.]+)×/);
      const spike = m ? `${m[1]}×` : 'significantly';
      return `One month has ${spike} the average monthly entries, indicating year-end bunching or backdated entry. Steps:\n\n1. Gateway → Display → Day Book → go through each month's entries to identify the spike month.\n2. For the spike month: check if entries have dates matching that month or if they were entered in that month but relate to earlier months.\n3. For backdated entries: if the source documents (invoices, bank statements) are from an earlier month, correct the dates.\n4. If entries were genuinely made in arrears: note this in the management letter but correct dates from source documents.\n5. Going forward: maintain monthly bookkeeping (update books within 30 days of each month-end).`;
    }

    // ── G: Consistency ───────────────────────────────────────────────────────
    case 'G1':
      return 'The same party appears under multiple ledgers (e.g., "HDFC Bank", "HDFC Bank A/c", "HDFC Current A/c"). Steps:\n\n1. Gateway → Display → Trial Balance → look for ledgers with similar names.\n2. For each duplicate set:\n   a. Display → Ledger → [duplicate ledger] → note the closing balance and all transactions.\n   b. Pass a Journal to transfer the balance: Dr [duplicate] → Cr [primary] (or reverse for Cr balance).\n   c. Go through Day Book and verify all entries in [duplicate] are re-assigned to [primary] if needed.\n3. Once the duplicate balance is zero: Gateway → Accounts Info → Ledgers → Delete → [duplicate].\n4. Apply this for both party ledgers (customers/suppliers) and bank/cash ledgers.';

    case 'G2': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} potential duplicate expense categories detected (same expense type in multiple ledger groups). Steps:\n\n1. Gateway → Display → Trial Balance → expand Indirect Expenses group.\n2. Look for ledgers with similar names under different groups (e.g., "Travelling Expenses" under Indirect Expenses AND "Travel Charges" under Direct Expenses).\n3. For each duplicate: decide which group is correct for your business.\n4. Transfer balances via Journal from the incorrect ledger to the correct one.\n5. Delete the incorrectly grouped ledger.\n6. For future: maintain a standard chart of accounts so each expense type has exactly one ledger.`;
    }

    case 'G3': {
      const m = note.match(/(\d+)/);
      const count = m ? m[1] : 'some';
      return `${count} cash entries exceed ₹10,000 to a single party in a single day, violating Section 40A(3) of the Income Tax Act (these are disallowed as deduction). Steps:\n\n1. Gateway → Display → Day Book → filter by Ledger: Cash → sort by Amount (descending).\n2. Identify each cash payment above ₹10,000 to a single party.\n3. For each:\n   a. If payment can be reversed and reissued: contact the party, issue a cheque/bank transfer instead, and alter the voucher to use the bank ledger.\n   b. If cash payment has already been made and cannot be reversed: document it but note it will be disallowed under Section 40A(3) in your tax computation. Inform the tax consultant.\n4. For cash entries ≥ ₹2 lakh (Section 269ST): these are prohibited and attract penalty equal to the amount. These must be reversed immediately.`;
    }

    case 'G4': {
      const m = note.match(/([\d.]+)%/);
      const pct = m ? m[1] : 'above 20%';
      return `${pct}% of entries are round-number amounts (e.g., ₹10,000, ₹50,000, ₹1,00,000), exceeding the 20% threshold. Round numbers suggest estimated or unverified entries. Steps:\n\n1. Gateway → Display → Day Book → press F12 → enable Show Amount.\n2. Identify entries with round figures — especially payments, receipts, and journal adjustments.\n3. For each round-number entry:\n   a. Compare with the source document (invoice, bank statement). The actual amount almost never ends in exactly 00.\n   b. Correct the entry to reflect the exact amount from the source document.\n4. High round-number frequency is a red flag during tax audits. Prioritise correcting entries above ₹1 lakh.`;
    }

    // ── H: Cross-Statement Reconciliation ────────────────────────────────────
    case 'H1': {
      const m = note.match(/DB total ₹([^\s]+).*TB total ₹([^\s(]+)/);
      const dbStr = m ? `₹${m[1]}` : '(Day Book total)';
      const tbStr = m ? `₹${m[2]}` : '(Trial Balance total)';
      return `Day Book total (${dbStr}) does not match Trial Balance total (${tbStr}). This usually means vouchers in DayBook are not reflected in the ledger. Steps:\n\n1. Check for "Optional" vouchers: Gateway → Display → Day Book → press F12 → enable "Show Optional Vouchers". Optional vouchers appear in the Day Book but DO NOT post to ledgers. To make them regular: open each → press Ctrl+L (toggle optional/regular).\n2. Check for "Post-dated" vouchers set to a future date — they won't appear in the current period's TB.\n3. If the difference corresponds to a specific voucher, find it by sorting the Day Book by Amount and looking for the matching entry.\n4. Check if any ledgers were deleted after entries were made — orphaned entries cause TB/DB discrepancy.`;
    }

    case 'H2': {
      const m = note.match(/DB ₹([^\s]+) vs TB ₹([^\s]+)/);
      const dbStr = m ? `₹${m[1]}` : '(Day Book sales total)';
      const tbStr = m ? `₹${m[2]}` : '(Trial Balance Sales ledger)';
      return `Sales voucher total in Day Book (${dbStr}) does not match Sales ledger in Trial Balance (${tbStr}). Steps:\n\n1. Gateway → Display → Trial Balance → drill into "Sales Accounts" group → note the closing balance of each sales ledger.\n2. Gateway → Display → Account Books → Sales Register → note the total.\n3. The difference = entries posted to Sales ledger via Journal instead of Sales vouchers.\n4. Find them: Display → Ledger → [Sales Ledger] → filter for Journal-type entries.\n5. For each journal entry that should be a sales voucher: delete the journal → re-enter as a Sales voucher (with party, GST, etc.).\n6. After correction, Sales Register total should match the Sales ledger closing balance.`;
    }

    case 'H3': {
      const m = note.match(/DB ₹([^\s]+) vs TB ₹([^\s]+)/);
      const dbStr = m ? `₹${m[1]}` : '(Day Book purchase total)';
      const tbStr = m ? `₹${m[2]}` : '(Trial Balance Purchase ledger)';
      return `Purchase voucher total in Day Book (${dbStr}) does not match Purchase ledger in Trial Balance (${tbStr}). Steps:\n\n1. Gateway → Display → Account Books → Purchase Register → note the total.\n2. Display → Trial Balance → expand "Purchase Accounts" → note closing balance.\n3. Difference = purchases entered via Journal or Payment vouchers instead of Purchase vouchers.\n4. Find them: Display → Ledger → [Purchase Ledger] → filter for Journal/Payment type entries.\n5. For each: delete the journal/payment entry → re-enter as a Purchase voucher with party name, TDS, GST lines as applicable.\n6. Purchase vouchers are required for ITC claim — entries via journal will not appear in GSTR-2.`;
    }

    case 'H4': {
      const m = note.match(/DB ₹([^\s]+) vs BS ₹([^\s]+)/);
      const dbStr = m ? `₹${m[1]}` : '(Day Book cash+bank movement)';
      const bsStr = m ? `₹${m[2]}` : '(Balance Sheet closing cash+bank)';
      return `Cash + Bank movement in Day Book (${dbStr}) does not match Balance Sheet closing balance (${bsStr}). Steps:\n\n1. Perform a Bank Reconciliation for each bank account:\n   a. Gateway → Banking → Bank Reconciliation → select bank ledger → enter bank statement opening balance.\n   b. Mark all cleared cheques and deposits against the bank statement.\n   c. Unreconciled items = missing entries or date errors.\n2. For each unreconciled item:\n   a. Bank charges/interest: enter as Payment (bank charges) or Receipt (interest) using the relevant date.\n   b. ECS/NEFT debits not in Tally: enter as Payment with the actual bank date.\n   c. Cheques not yet cleared: these are timing differences — don't add them; they'll reconcile when cleared.\n3. After BRS, the Tally bank balance should match the bank statement closing balance.`;
    }

    case 'H5':
      return 'Tax voucher totals do not reconcile with Duties & Taxes ledger in Trial Balance. Steps:\n\n1. Ensure all GST/TDS entries are made through tax-enabled vouchers (Sales/Purchase with tax lines) and NOT through standalone Journal entries to the Duties & Taxes ledger.\n2. Gateway → Display → Statutory Reports → GST → GST Audit to find mismatches.\n3. For each discrepancy: trace the entry in the Day Book → delete the direct journal → re-enter via the correct voucher type that auto-populates the tax ledger.\n4. TDS: use Payment vouchers with TDS deduction lines rather than manual journal entries to TDS Payable.';

    case 'H6': {
      const m = note.match(/Journal net ₹([^\s]+) vs P&L profit ₹([^\s]+)/);
      const jStr = m ? `₹${m[1]}` : '(journal net)';
      const pStr = m ? `₹${m[2]}` : '(P&L profit)';
      return `Journal voucher net amount (${jStr}) does not match P&L net profit (${pStr}). This means some journal entries are pure income/expense (without a Balance Sheet counterpart) which distorts the P&L. Steps:\n\n1. Gateway → Display → Day Book → filter by Voucher Type = Journal.\n2. Identify journals that only affect P&L accounts (both Dr and Cr are income or expense ledgers).\n3. For each such journal:\n   a. If it is a year-end provision (e.g., interest payable): Dr Interest Expense → Cr Interest Payable (BS). Add the Cr leg to a liability account.\n   b. If it is an accrual: similar — always have a BS counterpart.\n   c. If it appears to be an error: reverse it and re-enter correctly.\n4. Every journal entry should balance the P&L with the Balance Sheet.`;
    }

    case 'H7': {
      const m = note.match(/Sales ₹([^\s]+) vs P&L revenue ₹([^\s]+)/);
      const dbStr = m ? `₹${m[1]}` : '(sales voucher total)';
      const plStr = m ? `₹${m[2]}` : '(P&L revenue)';
      return `Sales voucher total (${dbStr}) does not closely match P&L revenue (${plStr}). Steps:\n\n1. The difference = income recorded via Journal instead of Sales voucher.\n2. Gateway → Display → Ledger → select each revenue ledger (Sales, Service Income, etc.) → filter for Journal-type entries.\n3. For each Journal posting to a revenue ledger: delete the Journal → re-enter as a Sales voucher (with party, GST, date matching the invoice).\n4. Also check if any receipts were directly posted to Sales ledger — these should go through Sundry Debtors.`;
    }

    case 'H8': {
      const m = note.match(/([\d.]+)×/);
      const ratio = m ? `${m[1]}×` : 'significantly';
      return `One month has ${ratio} the average monthly entry volume, indicating possible bulk backdated entry. Steps:\n\n1. Gateway → Display → Day Book → navigate month by month to identify the spike month.\n2. For the spike month: check each entry's date against its creation date (Tally logs creation date in Alt+Enter on each voucher).\n3. If entries were created recently but backdated: verify each against source documents. If the source document date matches, the entry is correct (just late).\n4. If no source document exists for backdated entries: these may be estimated — replace with actual amounts from original documents.\n5. Going forward: implement monthly close — update books within 15 days of each month-end.`;
    }

    default:
      return null;
  }
}
