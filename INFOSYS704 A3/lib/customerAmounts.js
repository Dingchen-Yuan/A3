// Currency-aware order amounts. Arithmetic uses integer minor units so a SAP
// line total is never multiplied by quantity again, and decimal cents stay exact.
function currencyCode(value = 'AUD') {
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new RangeError('Invalid order currency');
  return code;
}

function currencyFor(order) {
  return currencyCode(order.currency || 'AUD');
}

function fractionDigits(currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: currencyCode(currency)
  }).resolvedOptions().maximumFractionDigits;
}

function decimalParts(value) {
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 128 || !Number.isFinite(Number(text))) {
    throw new RangeError('Invalid monetary value');
  }
  const exponent = Number(match[4] || 0);
  if (Math.abs(exponent) > 100) throw new RangeError('Monetary value is out of range');
  const fraction = match[3] || '';
  const coefficient = BigInt(match[2] + fraction) * (match[1] === '-' ? -1n : 1n);
  return { coefficient, scale: fraction.length - exponent };
}

function safeInteger(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Monetary value is out of range');
  }
  return Number(value);
}

function roundedMinor(coefficient, scale, currency) {
  const shift = fractionDigits(currency) - scale;
  if (shift >= 0) return safeInteger(coefficient * 10n ** BigInt(shift));
  const divisor = 10n ** BigInt(-shift);
  const sign = coefficient < 0n ? -1n : 1n;
  const absolute = coefficient * sign;
  const rounded = absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n);
  return safeInteger(rounded * sign);
}

function toMinor(value, currency = 'AUD') {
  const { coefficient, scale } = decimalParts(value);
  return roundedMinor(coefficient, scale, currency);
}

function fromMinor(value, currency = 'AUD') {
  if (!Number.isSafeInteger(value)) throw new RangeError('Invalid minor-unit amount');
  return value / 10 ** fractionDigits(currency);
}

function lineTotalMinor(item, currency = 'AUD') {
  if (item.lineTotalMinor != null) {
    if (!Number.isSafeInteger(item.lineTotalMinor)) throw new RangeError('Invalid line total');
    return item.lineTotalMinor;
  }
  if (item.lineTotal != null) return toMinor(item.lineTotal, currency);
  // Demo/legacy items store a unit price, unlike SAP NetAmount (a line total).
  const price = decimalParts(item.price == null ? 0 : item.price);
  const quantity = decimalParts(item.qty == null ? 0 : item.qty);
  return roundedMinor(price.coefficient * quantity.coefficient, price.scale + quantity.scale, currency);
}

function lineTotal(item, currency = 'AUD') {
  return fromMinor(lineTotalMinor(item, currency), currency);
}

function partialLineMinor(item, qty, currency = 'AUD') {
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0 || Number(qty) > Number(item.qty) || Number(item.qty) <= 0) {
    throw new RangeError('Invalid affected quantity');
  }
  const total = lineTotalMinor(item, currency);
  if (total < 0) throw new RangeError('Invalid line total');
  const selected = decimalParts(qty), ordered = decimalParts(item.qty);
  let numerator = BigInt(total) * selected.coefficient;
  let denominator = ordered.coefficient;
  const shift = ordered.scale - selected.scale;
  if (shift >= 0) numerator *= 10n ** BigInt(shift);
  else denominator *= 10n ** BigInt(-shift);
  // Round the selected proportion of the authoritative line total once. In
  // particular, 2 of 3 units on a $1 line are 67 cents, not 2 x 33 cents.
  return safeInteger(numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n));
}

function sumMinor(items, currency = 'AUD') {
  return safeInteger((items || []).reduce((sum, item) => sum + BigInt(lineTotalMinor(item, currency)), 0n));
}

function money(value, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: currencyCode(currency)
  }).format(Number(value) || 0);
}

module.exports = { currencyCode, currencyFor, toMinor, fromMinor, lineTotalMinor, lineTotal, partialLineMinor, sumMinor, money };
