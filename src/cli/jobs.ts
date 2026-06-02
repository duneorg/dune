/**
 * dune jobs:list — list registered background jobs with their current state.
 * dune jobs:run <name> — trigger a job immediately (dev/ops use only).
 */

import { join, resolve } from "@std/path";
import { scanJobs } from "../jobs/scanner.ts";
import { JobScheduler } from "../jobs/scheduler.ts";
import { createEmailClient, createEmailProvider } from "../email/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { bootstrap } from "./bootstrap.ts";

export interface JobsOptions {
  json?: boolean;
  debug?: boolean;
}

export async function jobsListCommand(root: string, opts: JobsOptions = {}): Promise<void> {
  root = resolve(root);
  const { json = false } = opts;

  // Load config first so we can pass the explicit jobs list to scanJobs.
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });

  const declaredJobs = (config.site as { jobs?: string[] }).jobs;
  const jobDefs = await scanJobs(root, declaredJobs);

  if (jobDefs.length === 0) {
    if (json) {
      console.log(JSON.stringify({ jobs: [] }));
    } else {
      console.log("🏜️  Dune — jobs:list\n");
      console.log("  No jobs registered. Add a `jobs:` list to site.yaml to enable background jobs.");
    }
    return;
  }

  // Resolve state directory from config
  const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
  const jobStateDir = `${runtimeDir}/jobs`;

  // Minimal context for state reads — email is a no-op since we won't run handlers
  const noop = () => {};
  const noopEmail = { send: async () => {} };
  const jobContext = {
    content: null as never,
    config,
    storage,
    logger: { info: noop, warn: noop, error: noop },
    email: noopEmail,
  };

  const scheduler = new JobScheduler({
    definitions: jobDefs,
    context: jobContext,
    stateDir: jobStateDir,
    storage,
  });

  const states = await scheduler.listStatus();

  if (json) {
    console.log(JSON.stringify({ jobs: states }, null, 2));
    return;
  }

  console.log("🏜️  Dune — jobs:list\n");
  const colW = Math.max(...jobDefs.map((d) => d.name.length), 4);
  console.log(`  ${"NAME".padEnd(colW)}  SCHEDULE              STATUS    LAST RUN`);
  console.log(`  ${"─".repeat(colW)}  ${"─".repeat(20)}  ${"─".repeat(8)}  ${"─".repeat(20)}`);

  for (const s of states) {
    const def = jobDefs.find((d) => d.name === s.name)!;
    const lastRun = s.lastRun ? new Date(s.lastRun).toLocaleString() : "never";
    console.log(
      `  ${s.name.padEnd(colW)}  ${def.schedule.padEnd(20)}  ${s.status.padEnd(8)}  ${lastRun}`,
    );
    if (s.lastError) {
      console.log(`  ${"".padEnd(colW)}  ✗ ${s.lastError}`);
    }
  }
}

export async function jobsRunCommand(root: string, name: string, opts: JobsOptions = {}): Promise<void> {
  root = resolve(root);

  if (!name) {
    console.error("  ✗ Usage: dune jobs:run <name>");
    Deno.exit(1);
  }

  // Load config for the explicit jobs list before scanning.
  const _storage = createStorage({ rootDir: root });
  const _config = await loadConfig({ storage: _storage, rootDir: root, skipConfigTs: true })
    .catch(() => null);
  const declaredJobs = (_config?.site as { jobs?: string[] } | undefined)?.jobs;
  const jobDefs = await scanJobs(root, declaredJobs);
  const def = jobDefs.find((d) => d.name === name);

  if (!def) {
    const available = jobDefs.map((d) => d.name).join(", ") || "(none)";
    console.error(`  ✗ Unknown job: "${name}"`);
    console.error(`    Available: ${available}`);
    Deno.exit(1);
  }

  console.log(`🏜️  Dune — jobs:run ${name}\n`);

  // Need a full bootstrap to get engine + storage for JobContext
  const ctx = await bootstrap(root, { debug: opts.debug }).catch((err) => {
    console.error(`  ✗ Bootstrap failed: ${err.message}`);
    Deno.exit(1);
  });

  const runtimeDir = ctx.config.admin?.runtimeDir ?? ".dune/admin";
  const noop = () => {};
  const jobLogger = {
    info: (event: string, data?: Record<string, unknown>) =>
      console.log(`[jobs] ${event}`, data ?? ""),
    warn: (event: string, data?: Record<string, unknown>) =>
      console.warn(`[jobs] WARN ${event}`, data ?? ""),
    error: (event: string, data?: Record<string, unknown>) =>
      console.error(`[jobs] ERROR ${event}`, data ?? ""),
  };

  const emailCfg = (ctx.config as { site?: { email?: Record<string, unknown> } }).site?.email ?? {};
  const emailProvider = createEmailProvider(emailCfg as Parameters<typeof createEmailProvider>[0]);
  const emailFrom = (emailCfg as { from?: string }).from ?? `noreply@${new URL(ctx.config.site.url).hostname}`;
  const emailClient = createEmailClient({ provider: emailProvider, from: emailFrom, storage: ctx.storage });

  const jobContext = {
    content: ctx.engine,
    config: ctx.config,
    storage: ctx.storage,
    logger: jobLogger,
    email: emailClient,
  };

  const scheduler = new JobScheduler({
    definitions: [def],
    context: jobContext,
    stateDir: `${runtimeDir}/jobs`,
    storage: ctx.storage,
  });

  console.log(`  ▶ Running ${name}...`);
  const start = Date.now();
  try {
    await scheduler.run(name);
    console.log(`  ✅ Done in ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`  ✗ Failed:`, err);
    Deno.exit(1);
  }
}
