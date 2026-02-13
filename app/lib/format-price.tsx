/**
 * DeFi-style price formatter with subscript notation for small prices.
 *
 * Examples:
 *   1.2345     → "1.2345"
 *   0.0542     → "0.0542"
 *   0.00000021 → "0.0₆21"  (6 zeros after decimal, then "21")
 *   0.000042   → "0.0₄42"  (4 zeros after decimal, then "42")
 */

import React from 'react';

/**
 * Format a small price using DeFi subscript notation.
 * Returns a React element with <sub> for the zero count.
 *
 * @param price - The price as a number
 * @param suffix - Optional suffix like " MON"
 * @param minZeros - Minimum leading zeros to trigger subscript format (default: 4)
 */
export function FormatPrice({
  price,
  suffix = '',
  minZeros = 4,
}: {
  price: number;
  suffix?: string;
  minZeros?: number;
}) {
  if (price === 0) {
    return <span>0{suffix}</span>;
  }

  if (price >= 0.01) {
    return <span>{price.toFixed(4)}{suffix}</span>;
  }

  // Count leading zeros after "0."
  const priceStr = price.toFixed(18); // max precision
  const match = priceStr.match(/^0\.(0+)([1-9]\d*?)0*$/);

  if (!match || match[1].length < minZeros) {
    // Not enough zeros for subscript — show normally
    return <span>{price.toFixed(6)}{suffix}</span>;
  }

  const zeroCount = match[1].length;
  const significantDigits = match[2].slice(0, 4); // show up to 4 significant digits

  return (
    <span>
      0.0<sub style={{ fontSize: '0.7em', verticalAlign: 'baseline', opacity: 0.6 }}>{zeroCount}</sub>
      {significantDigits}{suffix}
    </span>
  );
}

/**
 * Plain string version for non-React contexts (logs, tooltips, etc.)
 * Uses Unicode subscript digits.
 */
export function formatPriceString(price: number, suffix = ''): string {
  if (price === 0) return `0${suffix}`;
  if (price >= 0.01) return `${price.toFixed(4)}${suffix}`;

  const priceStr = price.toFixed(18);
  const match = priceStr.match(/^0\.(0+)([1-9]\d*?)0*$/);

  if (!match || match[1].length < 4) {
    return `${price.toFixed(6)}${suffix}`;
  }

  const subscriptDigits = '₀₁₂₃₄₅₆₇₈₉';
  const zeroCount = match[1].length;
  const subscript = String(zeroCount).split('').map(d => subscriptDigits[parseInt(d)]).join('');
  const significantDigits = match[2].slice(0, 4);

  return `0.0${subscript}${significantDigits}${suffix}`;
}
