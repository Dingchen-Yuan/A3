const { suggestAlloc, evenAlloc, riskAmount } = require('../public/allocation.js');

const line = {
  colours: ['Black','Sage','Cream','Terracotta'],
  sizes: ['100x150cm','130x170cm','150x200cm'],
  signal: [
    [420,310,180],
    [360,440,260],
    [290,220,150],
    [180,140,90]
  ],
  casePack: 12,
  unitPrice: 24,
  markdownPct: 0.4
};

const committed = 1368;
const suggested = suggestAlloc(line, committed);
const original = evenAlloc(line, committed);

console.log('Committed volume:', committed);
console.log('Total signal:', suggested.reduce((s,v)=>s+v.signal,0));
console.log('Variants:', suggested.length);
console.log('Total suggested qty:', suggested.reduce((s,v)=>s+v.qty,0));
console.log('Any non-pack?', suggested.some(v=>v.qty%12!==0));
console.log('');
console.log('Colour         Size          Signal  Even  Suggested');
for (let i=0;i<suggested.length;i++){
  const v=suggested[i];
  const o=original[i];
  console.log(
    v.colour.padEnd(14), v.size.padEnd(13),
    String(v.signal).padStart(6),
    String(o.qty).padStart(5),
    String(v.qty).padStart(10)
  );
}
console.log('');
console.log('Original (even) risk: $' + riskAmount(original,committed,line));
console.log('Suggested risk:     $' + riskAmount(suggested,committed,line));
console.log('Risk reduction:     $' + (riskAmount(original,committed,line)-riskAmount(suggested,committed,line)));
