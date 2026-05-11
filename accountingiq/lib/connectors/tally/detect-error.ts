// Surface common Tally error envelopes / suspicious responses.
//
// Tally's XML server returns 200 OK with an error envelope in the BODY when
// it can't find a report or hits a syntax issue, instead of an HTTP error
// code. Without this check, the sync route would treat the envelope as a
// valid empty report and the file counter would inflate.

export function detectTallyError(xml: string): string | null {
  if (!xml) return 'empty response';
  if (xml.length < 200) return `unusually short response (${xml.length} chars) — likely Tally rejected the request`;
  if (/<RESPONSE\b[\s\S]*?<ERRORS>(\d+)<\/ERRORS>/i.test(xml)) {
    const m = /<LINEERROR>([^<]+)<\/LINEERROR>/i.exec(xml);
    return `Tally returned an error envelope${m ? ': ' + m[1] : ''}`;
  }
  if (/<LINEERROR>([^<]+)<\/LINEERROR>/i.test(xml)) {
    return `Tally LINEERROR: ${/<LINEERROR>([^<]+)<\/LINEERROR>/i.exec(xml)?.[1] ?? '?'}`;
  }
  if (/^\s*<!DOCTYPE\s+html/i.test(xml) || /^\s*<html\b/i.test(xml)) {
    return 'Tally returned HTML instead of XML — gateway misconfigured?';
  }
  return null;
}
