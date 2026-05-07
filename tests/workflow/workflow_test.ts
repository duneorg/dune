/**
 * Tests for workflow engine, scheduler, and history.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createWorkflowEngine } from "../../src/workflow/engine.ts";
import { createScheduler } from "../../src/workflow/scheduler.ts";
import { createHistoryEngine } from "../../src/history/engine.ts";
import { computeDiff, applyPatch } from "../../src/history/diff.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { ContentStatus } from "../../src/workflow/types.ts";
import { createStorage } from "../../src/storage/mod.ts";

// === Test helpers ===

function makePage(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.test/default.md",
    route: "/test",
    language: "en",
    format: "md",
    template: "default",
    title: "Test Page",
    navTitle: "Test Page",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

// === Workflow Engine Tests ===

Deno.test("WorkflowEngine: getStatus returns explicit status", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  const page = makePage({ status: "in_review" });
  assertEquals(engine.getStatus(page), "in_review");

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("WorkflowEngine: getStatus infers from published flag", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  const publishedPage = makePage({ published: true });
  assertEquals(engine.getStatus(publishedPage), "published");

  const draftPage = makePage({ published: false, status: "draft" });
  assertEquals(engine.getStatus(draftPage), "draft");

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("WorkflowEngine: canTransition checks valid transitions", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  assertEquals(engine.canTransition("draft", "in_review"), true);
  assertEquals(engine.canTransition("draft", "published"), true);
  assertEquals(engine.canTransition("in_review", "published"), true);
  assertEquals(engine.canTransition("published", "archived"), true);
  assertEquals(engine.canTransition("archived", "draft"), true);

  // Invalid transitions
  assertEquals(engine.canTransition("archived", "published"), false);
  assertEquals(engine.canTransition("archived", "in_review"), false);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("WorkflowEngine: allowedTransitions returns valid targets", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  const fromDraft = engine.allowedTransitions("draft");
  assertEquals(fromDraft.includes("in_review"), true);
  assertEquals(fromDraft.includes("published"), true);
  assertEquals(fromDraft.length, 2);

  const fromArchived = engine.allowedTransitions("archived");
  assertEquals(fromArchived, ["draft"]);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("WorkflowEngine: findByStatus filters pages", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  const pages = [
    makePage({ sourcePath: "a.md", status: "published" }),
    makePage({ sourcePath: "b.md", status: "draft", published: false }),
    makePage({ sourcePath: "c.md", status: "published" }),
    makePage({ sourcePath: "d.md", status: "archived" }),
  ];

  assertEquals(engine.findByStatus(pages, "published").length, 2);
  assertEquals(engine.findByStatus(pages, "draft").length, 1);
  assertEquals(engine.findByStatus(pages, "archived").length, 1);
  assertEquals(engine.findByStatus(pages, "in_review").length, 0);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("WorkflowEngine: statusCounts returns correct counts", () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const engine = createWorkflowEngine({ storage, dataDir: `${tmpDir}/.dune` });

  const pages = [
    makePage({ status: "published" }),
    makePage({ status: "draft", published: false }),
    makePage({ status: "published" }),
    makePage({ status: "archived" }),
    makePage({ status: "in_review" }),
  ];

  const counts = engine.statusCounts(pages);
  assertEquals(counts.published, 2);
  assertEquals(counts.draft, 1);
  assertEquals(counts.archived, 1);
  assertEquals(counts.in_review, 1);

  Deno.removeSync(tmpDir, { recursive: true });
});

// === Scheduler Tests ===

Deno.test("Scheduler: schedule and list actions", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const scheduler = createScheduler({ storage, dataDir: "data" });

  const action = await scheduler.schedule({
    sourcePath: "test/page.md",
    action: "publish",
    scheduledAt: Date.now() + 60000,
    createdBy: "admin",
  });

  assertExists(action.id);
  assertEquals(action.action, "publish");
  assertEquals(action.sourcePath, "test/page.md");

  const all = await scheduler.list();
  assertEquals(all.length, 1);
  assertEquals(all[0].id, action.id);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("Scheduler: cancel removes action", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const scheduler = createScheduler({ storage, dataDir: "data" });

  const action = await scheduler.schedule({
    sourcePath: "test/page.md",
    action: "archive",
    scheduledAt: Date.now() + 60000,
  });

  assertEquals(await scheduler.cancel(action.id), true);

  const all = await scheduler.list();
  assertEquals(all.length, 0);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("Scheduler: listForPage filters by path", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const scheduler = createScheduler({ storage, dataDir: "data" });

  await scheduler.schedule({
    sourcePath: "page-a.md",
    action: "publish",
    scheduledAt: Date.now() + 60000,
  });

  await scheduler.schedule({
    sourcePath: "page-b.md",
    action: "archive",
    scheduledAt: Date.now() + 60000,
  });

  const forA = await scheduler.listForPage("page-a.md");
  assertEquals(forA.length, 1);
  assertEquals(forA[0].sourcePath, "page-a.md");

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("Scheduler: tick executes due actions", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const scheduler = createScheduler({ storage, dataDir: "data" });

  // Schedule in the past
  await scheduler.schedule({
    sourcePath: "page.md",
    action: "publish",
    scheduledAt: Date.now() - 1000,
  });

  // Schedule in the future
  await scheduler.schedule({
    sourcePath: "page2.md",
    action: "archive",
    scheduledAt: Date.now() + 60000,
  });

  const executed: string[] = [];
  const count = await scheduler.tick(async (action) => {
    executed.push(action.sourcePath);
  });

  assertEquals(count, 1);
  assertEquals(executed, ["page.md"]);

  // Only future action remains
  const remaining = await scheduler.list();
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].sourcePath, "page2.md");

  Deno.removeSync(tmpDir, { recursive: true });
});

// === Diff Tests ===

Deno.test("Diff: computeDiff identical text", () => {
  const diff = computeDiff("hello\nworld", "hello\nworld");
  assertEquals(diff.additions, 0);
  assertEquals(diff.deletions, 0);
  assertEquals(diff.patch, "");
});

Deno.test("Diff: computeDiff added lines", () => {
  const diff = computeDiff("hello", "hello\nworld");
  assertEquals(diff.additions, 1);
  assertEquals(diff.deletions, 0);
});

Deno.test("Diff: computeDiff removed lines", () => {
  const diff = computeDiff("hello\nworld", "hello");
  assertEquals(diff.additions, 0);
  assertEquals(diff.deletions, 1);
});

Deno.test("Diff: computeDiff changed lines", () => {
  const diff = computeDiff("hello\nworld", "hello\nearth");
  assertEquals(diff.additions, 1);
  assertEquals(diff.deletions, 1);
});

Deno.test("Diff: computeDiff multi-line changes", () => {
  const old = "line 1\nline 2\nline 3\nline 4\nline 5";
  const nu = "line 1\nline 2 modified\nline 3\nnew line\nline 5";
  const diff = computeDiff(old, nu);
  assertEquals(diff.additions > 0, true);
  assertEquals(diff.deletions > 0, true);
  assertEquals(diff.patch.includes("@@"), true);
});

Deno.test("Diff: empty to content", () => {
  const diff = computeDiff("", "hello\nworld");
  assertEquals(diff.additions, 2);
  assertEquals(diff.deletions, 1); // empty string splits to [""] which counts as 1 removal
});

Deno.test("Diff: content to empty", () => {
  const diff = computeDiff("hello\nworld", "");
  assertEquals(diff.deletions, 2);
});

// === History Engine Tests ===

Deno.test("HistoryEngine: record and getHistory", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  await history.record({
    sourcePath: "test/page.md",
    content: "# Hello\n\nWorld",
    frontmatter: { title: "Hello" },
    author: "admin",
    message: "Initial version",
  });

  await history.record({
    sourcePath: "test/page.md",
    content: "# Hello\n\nUpdated world",
    frontmatter: { title: "Hello" },
    author: "admin",
    message: "Updated content",
  });

  const revisions = await history.getHistory("test/page.md");
  assertEquals(revisions.length, 2);
  assertEquals(revisions[0].number, 2); // newest first
  assertEquals(revisions[1].number, 1);
  assertEquals(revisions[0].message, "Updated content");

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: getRevision returns specific revision", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  await history.record({
    sourcePath: "test/page.md",
    content: "Version 1",
    frontmatter: { title: "Test" },
  });

  await history.record({
    sourcePath: "test/page.md",
    content: "Version 2",
    frontmatter: { title: "Test Updated" },
  });

  const rev1 = await history.getRevision("test/page.md", 1);
  assertExists(rev1);
  assertEquals(rev1!.content, "Version 1");

  const rev2 = await history.getRevision("test/page.md", 2);
  assertExists(rev2);
  assertEquals(rev2!.content, "Version 2");

  const rev3 = await history.getRevision("test/page.md", 3);
  assertEquals(rev3, null);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: getLatest returns most recent", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  await history.record({
    sourcePath: "page.md",
    content: "First",
    frontmatter: {},
  });

  await history.record({
    sourcePath: "page.md",
    content: "Second",
    frontmatter: {},
  });

  const latest = await history.getLatest("page.md");
  assertExists(latest);
  assertEquals(latest!.content, "Second");
  assertEquals(latest!.number, 2);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: diff between revisions", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  await history.record({
    sourcePath: "page.md",
    content: "hello\nworld",
    frontmatter: {},
  });

  await history.record({
    sourcePath: "page.md",
    content: "hello\nearth",
    frontmatter: {},
  });

  const diff = await history.diff("page.md", 1, 2);
  assertExists(diff);
  assertEquals(diff!.additions, 1);
  assertEquals(diff!.deletions, 1);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: diffWithCurrent", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  await history.record({
    sourcePath: "page.md",
    content: "original",
    frontmatter: {},
  });

  const diff = await history.diffWithCurrent("page.md", 1, "modified");
  assertExists(diff);
  assertEquals(diff!.additions, 1);
  assertEquals(diff!.deletions, 1);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: getRevisionCount", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  assertEquals(await history.getRevisionCount("nonexistent.md"), 0);

  await history.record({
    sourcePath: "page.md",
    content: "v1",
    frontmatter: {},
  });

  await history.record({
    sourcePath: "page.md",
    content: "v2",
    frontmatter: {},
  });

  assertEquals(await history.getRevisionCount("page.md"), 2);

  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("HistoryEngine: getLatest for nonexistent page returns null", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const storage = createStorage({ rootDir: tmpDir });
  const history = createHistoryEngine({ storage, dataDir: "data" });

  const latest = await history.getLatest("nonexistent.md");
  assertEquals(latest, null);

  Deno.removeSync(tmpDir, { recursive: true });
});
