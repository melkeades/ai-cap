export function clampIndex(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(total - 1, Math.trunc(value)));
}

export function parseOneBasedJump(input: string, total: number): number {
  const parsed = Number.parseInt(input.trim(), 10);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return clampIndex(parsed - 1, total);
}
