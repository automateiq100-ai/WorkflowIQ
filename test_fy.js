const fs = require('fs');

const data = fs.readFileSync('accountingiq/Sample data/Dummy data/DayBook.xml', 'utf16le');
const voucherRe = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/gi;
let m;
const monthCounts = {};
while ((m = voucherRe.exec(data)) !== null) {
  const block = m[1];
  const dateMatch = block.match(/<DATE>([^<]*)<\/DATE>/i);
  if (dateMatch) {
    const s = dateMatch[1];
    if (s.length >= 8) {
      const y = parseInt(s.slice(0, 4));
      const mo = parseInt(s.slice(4, 6)) - 1;
      const d = parseInt(s.slice(6, 8));
      const dt = new Date(y, mo, d);
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    }
  }
}

console.log("monthCounts:", monthCounts);

const entries = Object.entries(monthCounts);
const fyVouchers = {};
for (const [monthKey, count] of entries) {
  const [yr, mo] = monthKey.split('-').map(Number);
  const fyYear = mo >= 4 ? yr : yr - 1;
  fyVouchers[fyYear] = (fyVouchers[fyYear] || 0) + count;
}
console.log("fyVouchers:", fyVouchers);

const best = Object.entries(fyVouchers).reduce(
  (acc, cur) => (Number(cur[1]) > Number(acc[1]) ? cur : acc),
  ['0', 0]
);
console.log("best:", best);
