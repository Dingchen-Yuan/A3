(function (global) {
  'use strict';

  function variantList(line) {
    const out = [];
    for (let ci = 0; ci < line.colours.length; ci++) {
      for (let si = 0; si < line.sizes.length; si++) {
        out.push({ colour: line.colours[ci], size: line.sizes[si], signal: (line.signal[ci] || [])[si] || 0 });
      }
    }
    return out;
  }

  function suggestAlloc(line, committed) {
    const pack = line.casePack || 12;
    const vars = variantList(line);
    const n = vars.length;
    const totalSignal = vars.reduce((s, v) => s + (Number(v.signal) || 0), 0) || 1;
    const floorUnits = 0.05 * committed;
    const floorPacks = Math.max(1, Math.ceil(floorUnits / pack));
    const floorQty = floorPacks * pack;

    // proportional shares
    const raw = vars.map(v => (Number(v.signal) || 0) / totalSignal * committed);

    // variants below floor
    const isLow = raw.map(r => r < floorUnits);
    const numLow = isLow.filter(Boolean).length;
    const sumLowRaw = raw.reduce((s, r, i) => (isLow[i] ? s + r : s), 0);
    const highRawSum = raw.reduce((s, r, i) => (!isLow[i] ? s + r : s), 0);

    // real allocations: lows at floor; highs rescaled to absorb the adjustment
    const realAlloc = vars.map((v, i) => {
      if (isLow[i]) return floorQty;
      if (highRawSum <= 0 || (committed - numLow * floorQty) <= 0) return floorQty;
      return raw[i] * (committed - numLow * floorQty) / highRawSum;
    });

    // round to case packs (nearest), enforce minimum
    const packs = realAlloc.map((q, i) => {
      let p = Math.round(q / pack);
      if (p < floorPacks) p = floorPacks;
      return p;
    });

    const targetPacks = Math.round(committed / pack);
    // adjust the largest variant (by real allocation) so the total equals committed
    let totalPacks = packs.reduce((a, b) => a + b, 0);
    let diff = targetPacks - totalPacks;
    if (diff !== 0 && packs.length) {
      let largestIdx = 0;
      for (let i = 1; i < packs.length; i++) {
        if (realAlloc[i] > realAlloc[largestIdx]) largestIdx = i;
      }
      packs[largestIdx] += diff;
      if (packs[largestIdx] < floorPacks) packs[largestIdx] = floorPacks;
    }

    return vars.map((v, i) => Object.assign({}, v, { qty: packs[i] * pack }));
  }

  function evenAlloc(line, committed) {
    const pack = line.casePack || 12;
    const vars = variantList(line);
    const n = vars.length;
    const totalPacks = Math.round(committed / pack);
    const base = Math.floor(totalPacks / n);
    const packs = vars.map(() => base);
    let leftover = totalPacks - base * n;
    let i = 0;
    while (leftover > 0) { packs[i % n] += 1; leftover -= 1; i++; }
    return vars.map((v, idx) => Object.assign({}, v, { qty: (packs[idx] || 0) * pack }));
  }

  function riskAmount(alloc, committed, line) {
    const totalSignal = alloc.reduce((s, v) => s + (Number(v.signal) || 0), 0);
    const unitValue = (line.unitPrice || 0) * (line.markdownPct || 0.4);
    let risk = 0;
    for (const v of alloc) {
      const ideal = totalSignal > 0 ? (v.signal / totalSignal) * committed : committed / (alloc.length || 1);
      const excess = v.qty - ideal;
      if (excess > 0) risk += excess * unitValue;
    }
    return Math.round(risk);
  }

  const api = { variantList, suggestAlloc, evenAlloc, riskAmount };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  // attach to global for browser usage
  Object.keys(api).forEach(k => { global[k] = api[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
