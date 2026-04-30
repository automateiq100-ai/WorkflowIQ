import { describe, it, expect } from 'vitest';
import {
  buildReportRequest,
  buildListCompaniesRequest,
  buildVoucherImportRequest,
} from '../connectors/tally/tdl';

const PERIOD = { start: '2025-04-01', end: '2026-03-31' };

describe('Tally TDL templates', () => {
  it('builds a deterministic Trial Balance request', () => {
    const xml = buildReportRequest('trialbal', 'Acme Pvt Ltd', PERIOD);
    expect(xml).toMatchInlineSnapshot(`
      "<ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Data</TYPE>
          <ID>Trial Balance</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>Acme Pvt Ltd</SVCURRENTCOMPANY>
              <SVFROMDATE TYPE="Date">20250401</SVFROMDATE>
              <SVTODATE TYPE="Date">20260331</SVTODATE>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <EXPLODEFLAG>Yes</EXPLODEFLAG>
            </STATICVARIABLES>
          </DESC>
        </BODY>
      </ENVELOPE>"
    `);
  });

  it('escapes XML metacharacters in company names', () => {
    const xml = buildReportRequest('pandl', 'A & B <Co>', PERIOD);
    expect(xml).toContain('A &amp; B &lt;Co&gt;');
  });

  it('builds a List of Companies request', () => {
    const xml = buildListCompaniesRequest();
    expect(xml).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    expect(xml).toContain('<ID>List of Companies</ID>');
    expect(xml).toContain('<COLLECTION NAME="List of Companies"');
  });

  it('builds a balanced voucher import request', () => {
    const xml = buildVoucherImportRequest('Acme Pvt Ltd', {
      date: '20260420',
      voucherType: 'Journal',
      narration: 'Reclassify suspense to Capital',
      lines: [
        { ledger: 'Suspense A/c', amount: -2098400 }, // Dr
        { ledger: 'Capital Account', amount: 2098400 }, // Cr
      ],
    });
    expect(xml).toContain('<TALLYREQUEST>Import</TALLYREQUEST>');
    expect(xml).toContain('<DATE>20260420</DATE>');
    expect(xml).toContain('<LEDGERNAME>Suspense A/c</LEDGERNAME>');
    expect(xml).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>'); // Dr line
    expect(xml).toContain('<AMOUNT>-2098400.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Capital Account</LEDGERNAME>');
    expect(xml).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>'); // Cr line
    expect(xml).toContain('<AMOUNT>2098400.00</AMOUNT>');
  });
});
