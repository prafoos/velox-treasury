export type TreasuryUnavailable = {
  unavailable: true;
  functionName: string;
  error: string;
};

export function isUnavailable(value: unknown): value is TreasuryUnavailable {
  return Boolean(
    value !== null
    && typeof value === 'object'
    && 'unavailable' in value
    && (value as { unavailable?: unknown }).unavailable === true,
  );
}

export function normalizeBigIntValue(value: unknown, fallback: bigint | null = null): bigint | null {
  if (isUnavailable(value)) return fallback;
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') {
    const raw = String(value).trim();
    if (!raw) return fallback;
    return BigInt(raw);
  }
  return fallback;
}

export function normalizeBigIntArray(value: unknown): readonly bigint[] | null {
  if (isUnavailable(value) || !Array.isArray(value)) return null;
  const parsed = value.map((entry) => normalizeBigIntValue(entry, null));
  return parsed.every((entry): entry is bigint => entry !== null) ? parsed : null;
}
