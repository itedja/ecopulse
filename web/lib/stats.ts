// A headline stat is shown only when it says something: a missing value or a zero count is hidden
// rather than printed as a large "0".
export function worthShowing(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && n > 0;
}
