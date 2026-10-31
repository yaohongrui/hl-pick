export function normalizeAddress(
  input: string | undefined | null,
): string | null {
  if (!input) return null;
  const a = input.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}

export function shortAddress(a: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
