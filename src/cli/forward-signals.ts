/**
 * Signal forwarding for the CLI re-exec shims.
 *
 * Both cli.ts and cli-impl.ts re-exec the real server as a child process and
 * wait for it. Without forwarding, killing the shim (SIGTERM from a process
 * manager, SIGHUP when the terminal or session closes) leaves the child
 * orphaned and still serving. This relays those signals to the child and
 * resolves with its exit status.
 *
 * @module
 */

const FORWARDED: Deno.Signal[] = ["SIGTERM", "SIGINT", "SIGHUP"];

/**
 * Relay termination signals to `child` until it exits, then return its
 * status. Listeners are removed before returning.
 */
export async function waitForwardingSignals(
  child: Deno.ChildProcess,
): Promise<Deno.CommandStatus> {
  const handlers: Array<[Deno.Signal, () => void]> = [];
  for (const signal of FORWARDED) {
    const handler = () => {
      try {
        child.kill(signal);
      } catch {
        // Child already exited — status below unblocks momentarily
      }
    };
    try {
      Deno.addSignalListener(signal, handler);
      handlers.push([signal, handler]);
    } catch {
      // Signal not supported on this platform (e.g. SIGHUP on Windows)
    }
  }
  try {
    return await child.status;
  } finally {
    for (const [signal, handler] of handlers) {
      Deno.removeSignalListener(signal, handler);
    }
  }
}
