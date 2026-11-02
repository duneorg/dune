/**
 * Name the startup step that failed, and keep the original error as `cause`.
 *
 * Bootstrap runs many steps whose failures surface as a bare library message
 * ("fetch failed"). Wrapping the failure-prone ones means the CLI's final
 * handler can say *which* step broke, with the underlying reason on the
 * `cause` chain (printed by `formatErrorChain`).
 */
export async function startupStep<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: ${detail}`, { cause: err });
  }
}
