// Surface common Tally error envelopes / suspicious responses.
//
// Tally's XML server returns 200 OK with an error envelope in the BODY when
// it can't find a report or hits a syntax issue, instead of an HTTP error
// code. Without this check, the sync route would treat the envelope as a
// valid empty report and the file counter would inflate.

/** Turn a raw Tally LINEERROR string into a clearer, actionable message
 *  for the common cases we recognise. */
function explainLineError(raw: string): string {
  if (/could not set\s+'?SVCurrentCompany'?/i.test(raw)) {
    return 'Tally could not select the company. Make sure the company is '
      + 'LOADED in Tally Prime (Gateway shows it in the company list), not just '
      + 'present on disk. If the company has books across multiple financial '
      + 'years, load it and retry — AccountingIQ now sends the bare company name.';
  }
  return `Tally LINEERROR: ${raw}`;
}

export function detectTallyError(xml: string): string | null {
  if (!xml) return 'empty response';
  if (xml.length < 200) return `unusually short response (${xml.length} chars) — likely Tally rejected the request`;
  if (/<RESPONSE\b[\s\S]*?<ERRORS>(\d+)<\/ERRORS>/i.test(xml)) {
    const m = /<LINEERROR>([^<]+)<\/LINEERROR>/i.exec(xml);
    return m ? explainLineError(m[1].trim()) : 'Tally returned an error envelope';
  }
  if (/<LINEERROR>([^<]+)<\/LINEERROR>/i.test(xml)) {
    const raw = /<LINEERROR>([^<]+)<\/LINEERROR>/i.exec(xml)?.[1]?.trim() ?? '?';
    return explainLineError(raw);
  }
  if (/^\s*<!DOCTYPE\s+html/i.test(xml) || /^\s*<html\b/i.test(xml)) {
    return 'Tally returned HTML instead of XML — gateway misconfigured?';
  }
  return null;
}
