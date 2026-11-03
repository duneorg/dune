/**
 * Shared password acquisition for commands that set a password
 * (`users:passwd`, `users:create --password-prompt`): TTY prompt with no
 * echo, stdin, or a generated random password. Never from an argument.
 *
 * @module
 */

import { encodeBase64Url } from "@std/encoding/base64url";
import { promptSecret, readSecretFromStdin } from "./prompt-secret.ts";

export interface PasswordInputOptions {
  /** Read the password from stdin instead of prompting. */
  stdin?: boolean;
  /** Generate a random password. */
  generate?: boolean;
  /** Prompt/stdin override — tests only. */
  readPassword?: () => Promise<string>;
}

/** Thrown for user-facing input problems; the command prints the message and exits 1. */
export class PasswordInputError extends Error {
  override name = "PasswordInputError";
}

export function generatePassword(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function acquirePassword(
  opts: PasswordInputOptions,
): Promise<{ password: string; generated: boolean }> {
  if (opts.stdin && opts.generate) {
    throw new PasswordInputError(
      "--stdin and --generate are mutually exclusive",
    );
  }
  if (opts.generate) return { password: generatePassword(), generated: true };
  if (opts.stdin) {
    return { password: await readSecretFromStdin(), generated: false };
  }
  if (opts.readPassword) {
    return { password: await opts.readPassword(), generated: false };
  }
  if (!Deno.stdin.isTerminal()) {
    throw new PasswordInputError(
      "No terminal to prompt on — use --stdin (password on stdin) or --generate.",
    );
  }
  const password = await promptSecret("New password: ");
  const again = await promptSecret("Repeat it:    ");
  if (password !== again) {
    throw new PasswordInputError(
      "The two entries differ; nothing was changed.",
    );
  }
  return { password, generated: false };
}
