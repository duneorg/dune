/**
 * Terminal helpers for commands that take a secret: a no-echo line prompt
 * and a stdin reader. Secrets are never accepted as arguments (shell history,
 * `ps`).
 *
 * @module
 */

/** Read a line from the terminal without echoing it. Exits 130 on Ctrl-C. */
export async function promptSecret(prompt: string): Promise<string> {
  const enc = new TextEncoder();
  await Deno.stdout.write(enc.encode(prompt));
  Deno.stdin.setRaw(true);
  const bytes: number[] = [];
  const buf = new Uint8Array(1);
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;
      const c = buf[0];
      if (c === 13 || c === 10 || c === 4) break; // Enter, or Ctrl-D
      if (c === 3) {
        Deno.stdin.setRaw(false);
        await Deno.stdout.write(enc.encode("\n"));
        Deno.exit(130);
      }
      if (c === 27) {
        // Escape sequence (arrow keys etc.): swallow it instead of adding
        // its bytes to the password.
        if ((await Deno.stdin.read(buf)) === null) break;
        if (buf[0] === 0x5b) {
          while ((await Deno.stdin.read(buf)) !== null) {
            if (buf[0] >= 0x40 && buf[0] <= 0x7e) break;
          }
        }
        continue;
      }
      if (c < 32 && c !== 8) continue; // other control characters (8 = backspace)
      if (c === 127 || c === 8) {
        // Backspace: drop a whole UTF-8 character
        while (bytes.length && (bytes[bytes.length - 1] & 0xc0) === 0x80) {
          bytes.pop();
        }
        bytes.pop();
        continue;
      }
      bytes.push(c);
    }
  } finally {
    Deno.stdin.setRaw(false);
    await Deno.stdout.write(enc.encode("\n"));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Read all of stdin and strip one trailing newline. */
export async function readSecretFromStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all).replace(/\r?\n$/, "");
}
