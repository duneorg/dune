/**
 * dune backup / dune restore — Archive and restore a Dune site.
 *
 * Commands:
 *   dune backup [--output filename.tar.gz]   Back up content, data, uploads, and config
 *   dune restore <archive.tar.gz> [--yes]    Restore from a backup archive
 */

/** @module */

import { basename, join } from "@std/path";
import { exists } from "@std/fs";

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------

export interface BackupOptions {
  /** Output filename. Defaults to backup-YYYY-MM-DD.tar.gz */
  output?: string;
}

export async function backupCommand(
  root: string,
  opts: BackupOptions,
): Promise<void> {
  const dateSlug = new Date().toISOString().slice(0, 10);
  const output = opts.output ?? `backup-${dateSlug}.tar.gz`;

  console.log(`📦 Backing up ${root}...`);

  // Build manifest
  const manifest = {
    duneVersion: "0.10.0",
    timestamp: new Date().toISOString(),
    site: basename(root === "." ? Deno.cwd() : root),
  };

  // Write manifest to a temp file
  const manifestTmp = await Deno.makeTempFile({ suffix: "-dune-backup-manifest.json" });
  try {
    await Deno.writeTextFile(manifestTmp, JSON.stringify(manifest, null, 2));

    // Determine which optional paths actually exist
    const candidatePaths = [
      "content",
      "data",
      join("public", "uploads"),
      "site.yaml",
      "themes",
      "plugins",
    ];

    const presentPaths: string[] = [];
    for (const p of candidatePaths) {
      if (await exists(join(root, p))) {
        presentPaths.push(p);
      }
    }

    if (presentPaths.length === 0) {
      console.error("✗ No content, data, or config found to back up.");
      Deno.exit(1);
    }

    // Build tar args
    // We use --transform to rename the manifest temp file to dune-backup-manifest.json
    // GNU tar and BSD tar both support -T for reading paths from a file, but the
    // manifest rename trick differs. The cleanest cross-platform approach is to
    // include the manifest via a wrapper temp dir so it lands at a predictable name.
    const manifestDir = await Deno.makeTempDir({ prefix: "dune-backup-" });
    const manifestInDir = join(manifestDir, "dune-backup-manifest.json");
    try {
      await Deno.copyFile(manifestTmp, manifestInDir);

      // Construct the tar command:
      //   tar -czf <output> \
      //     --exclude='.dune' --exclude='node_modules' --exclude='.git' \
      //     -C <root> <present-paths...> \
      //     -C <manifestDir> dune-backup-manifest.json
      const tarArgs = [
        "-czf",
        output,
        "--exclude=.dune",
        "--exclude=node_modules",
        "--exclude=.git",
        "-C",
        root,
        ...presentPaths,
        "-C",
        manifestDir,
        "dune-backup-manifest.json",
      ];

      const cmd = new Deno.Command("tar", {
        args: tarArgs,
        stdout: "inherit",
        stderr: "piped",
      });

      const result = await cmd.output();

      if (!result.success) {
        const errText = new TextDecoder().decode(result.stderr);
        console.error(`✗ tar failed:\n${errText.trim()}`);
        Deno.exit(1);
      }

      // Report archive size
      let sizeStr = "";
      try {
        const stat = await Deno.stat(output);
        const bytes = stat.size;
        if (bytes >= 1024 * 1024) {
          sizeStr = ` (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
        } else if (bytes >= 1024) {
          sizeStr = ` (${(bytes / 1024).toFixed(1)} KB)`;
        } else {
          sizeStr = ` (${bytes} B)`;
        }
      } catch { /* size is optional */ }

      console.log(`✅ Backup saved to ${output}${sizeStr}`);
    } finally {
      await Deno.remove(manifestDir, { recursive: true });
    }
  } finally {
    await Deno.remove(manifestTmp).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  /** Skip interactive confirmation prompt even when root is non-empty */
  yes?: boolean;
}

export async function restoreCommand(
  root: string,
  archivePath: string,
  opts: RestoreOptions,
): Promise<void> {
  if (!archivePath) {
    console.error("✗ Archive path required. Usage: dune restore <archive.tar.gz>");
    Deno.exit(1);
  }

  // Verify archive exists
  if (!await exists(archivePath)) {
    console.error(`✗ Archive not found: ${archivePath}`);
    Deno.exit(1);
  }

  // Validate the archive contains a dune-backup-manifest.json
  const listCmd = new Deno.Command("tar", {
    args: ["-tzf", archivePath],
    stdout: "piped",
    stderr: "piped",
  });
  const listResult = await listCmd.output();
  if (!listResult.success) {
    const errText = new TextDecoder().decode(listResult.stderr);
    console.error(`✗ Cannot read archive: ${errText.trim()}`);
    Deno.exit(1);
  }
  const fileList = new TextDecoder().decode(listResult.stdout);
  if (!fileList.includes("dune-backup-manifest.json")) {
    console.error("✗ Archive does not appear to be a Dune backup (missing dune-backup-manifest.json).");
    Deno.exit(1);
  }

  // Check if destination is non-empty and prompt if needed
  if (!opts.yes) {
    let isEmpty = true;
    try {
      for await (const _entry of Deno.readDir(root)) {
        isEmpty = false;
        break;
      }
    } catch {
      // root may not exist — treat as empty, tar -C will create it
      isEmpty = true;
    }

    if (!isEmpty) {
      // Print prompt and read from stdin
      await Deno.stdout.write(
        new TextEncoder().encode(
          `⚠️  Destination is not empty. Continue? [y/N] `,
        ),
      );
      const buf = new Uint8Array(8);
      const n = await Deno.stdin.read(buf);
      const answer = n ? new TextDecoder().decode(buf.subarray(0, n)).trim().toLowerCase() : "";
      if (answer !== "y" && answer !== "yes") {
        console.log("Aborted.");
        Deno.exit(0);
      }
    }
  }

  // Ensure root directory exists
  await Deno.mkdir(root, { recursive: true });

  // Extract archive
  const extractCmd = new Deno.Command("tar", {
    args: ["-xzf", archivePath, "-C", root],
    stdout: "inherit",
    stderr: "piped",
  });
  const extractResult = await extractCmd.output();
  if (!extractResult.success) {
    const errText = new TextDecoder().decode(extractResult.stderr);
    console.error(`✗ Restore failed:\n${errText.trim()}`);
    Deno.exit(1);
  }

  console.log(`✅ Restored from ${archivePath}`);
}
