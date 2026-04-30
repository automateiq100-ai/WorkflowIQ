const fs = require('fs');

function parseBillsFlat(xml) {
  const bills = [];
  const chunkRe = /<BILLFIXED>([\s\S]*?)(?=<BILLFIXED>|<\/ENVELOPE>|$)/gi;
  let chunkMatch;
  while ((chunkMatch = chunkRe.exec(xml)) !== null) {
    const chunk = chunkMatch[0]; // the full match including BILLFIXED up to the next BILLFIXED
    const party = chunk.match(/<BILLPARTY[^>]*>\s*([\s\S]*?)\s*<\/BILLPARTY>/i)?.[1]?.trim() ?? '';
    const ref = chunk.match(/<BILLREF[^>]*>\s*([\s\S]*?)\s*<\/BILLREF>/i)?.[1]?.trim() ?? '';
    const amtStr = chunk.match(/<BILLFINAL[^>]*>\s*([\s\S]*?)\s*<\/BILLFINAL>/i)?.[1]?.trim() ?? '0';
    const dueStr = chunk.match(/<BILLDUE[^>]*>\s*([\s\S]*?)\s*<\/BILLDUE>/i)?.[1]?.trim() ?? '';
    const overdueStr = chunk.match(/<BILLOVERDUE[^>]*>\s*([\s\S]*?)\s*<\/BILLOVERDUE>/i)?.[1]?.trim() ?? '';
    
    const amount = parseFloat(amtStr.replace(/,/g, '')) || 0;
    const overdue = overdueStr.toLowerCase() === 'yes' || overdueStr === '1' || parseInt(overdueStr) > 0;
    
    if (party || ref) {
      bills.push({ party, billRef: ref, amount: Math.abs(amount), dueDate: dueStr, overdue });
    }
  }
  return bills;
}

const xml = fs.readFileSync('accountingiq/Sample data/Dummy data/Bills.xml', 'utf16le');
console.log(parseBillsFlat(xml));
