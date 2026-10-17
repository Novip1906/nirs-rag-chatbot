const DIGITS = /^\d+$/;

export function isValidLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || !DIGITS.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidIban(value: string): boolean {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length < 15 || normalized.length > 34) {
    return false;
  }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) {
    return false;
  }
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const chunk = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of chunk) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

function weightedMod11(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i] * (digits.charCodeAt(i) - 48);
  }
  return (sum % 11) % 10;
}

const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN12_WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN12_WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;

export function isValidInn(digits: string): boolean {
  if (!DIGITS.test(digits)) {
    return false;
  }
  if (digits.length === 10) {
    return weightedMod11(digits, INN10_WEIGHTS) === digits.charCodeAt(9) - 48;
  }
  if (digits.length === 12) {
    return (
      weightedMod11(digits, INN12_WEIGHTS_11) === digits.charCodeAt(10) - 48 &&
      weightedMod11(digits, INN12_WEIGHTS_12) === digits.charCodeAt(11) - 48
    );
  }
  return false;
}

export function isValidSnils(digits: string): boolean {
  if (digits.length !== 11 || !DIGITS.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (digits.charCodeAt(i) - 48) * (9 - i);
  }
  let control = sum;
  if (sum > 101) {
    control = sum % 101;
  }
  if (control === 100 || control === 101) {
    control = 0;
  }
  return control === Number(digits.slice(9));
}
