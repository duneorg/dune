/**
 * Headless smoke test: a site with the admin plugin turned off
 * (`admin.enabled: false`) must still do everything its public visitors see.
 *
 * Admin is optional (see the plugin-api contract audit), so a feature that
 * silently needs it is a bug. This boots a freshly scaffolded site with admin
 * off, adds pages with publish windows, and checks the public surface.
 *
 *   dune new /path/to/site
 *   deno run -A scripts/headless-smoke.ts /path/to/site [port]
 *
 * It runs this checkout's `src/cli.ts` against the site, so it tests the code
 * under review, not the core release the scaffold pins.
 *
 * Exits non-zero, listing every failed check, if anything is wrong. Run by the
 * `headless-smoke-test` CI job.
 */

const root = Deno.args[0];
const port = Number(Deno.args[1] ?? 3190);
if (!root) {
  console.error("usage: headless-smoke.ts <site-root> [port]");
  Deno.exit(2);
}
const base = `http://localhost:${port}`;

// ── Make the site headless and give it pages with publish windows ───────────

const systemPath = `${root}/config/system.yaml`;
const system = await Deno.readTextFile(systemPath);
// Public forms and the deploy webhook use their own config keys, not admin:.
await Deno.writeTextFile(
  systemPath,
  `${system.trimEnd()}\nadmin:\n  enabled: false\nwebhooks:\n  incoming:\n    - token: smoke-token\n      actions: [purge-cache]\n`,
);
const sitePath = `${root}/config/site.yaml`;
await Deno.writeTextFile(
  sitePath,
  `${(await Deno.readTextFile(sitePath)).trimEnd()}\nforms:\n  honeypot: _hp\n`,
);
await Deno.mkdir(`${root}/forms`, { recursive: true });
await Deno.writeTextFile(
  `${root}/forms/contact.yaml`,
  [
    "title: Contact",
    "success_url: /thanks",
    "fields:",
    "  name: { type: text, label: Name, required: true }",
    "  message: { type: textarea, label: Message, required: true }",
    "",
  ].join("\n"),
);

const page = (title: string, extra = "") => `---\ntitle: ${title}\n${extra}---\n\n${title} body.\n`;
for (
  const [dir, title, extra] of [
    ["03.future", "Future", 'publish_date: "2099-01-01T00:00:00Z"\n'],
    ["04.expired", "Expired", 'unpublish_date: "2020-01-01T00:00:00Z"\n'],
    ["05.window", "Window", 'publish_date: "2020-01-01"\nunpublish_date: "2099-01-01"\n'],
    ["06.draft", "Draft", "published: false\npublish_date: 2020-01-01\n"],
  ]
) {
  await Deno.mkdir(`${root}/content/${dir}`, { recursive: true });
  await Deno.writeTextFile(`${root}/content/${dir}/default.md`, page(title, extra));
}

// ── Boot ────────────────────────────────────────────────────────────────────

// Run THIS checkout against the site, not the core the scaffold pins from JSR
// (a site's main.ts would run that one; DUNE_SITE_ENTRYPOINT=off keeps the shim
// from handing over to it).
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const server = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", cli, "dev", "--root", root, "--port", String(port)],
  env: { DUNE_SITE_ENTRYPOINT: "off" },
  stdout: "piped",
  stderr: "piped",
}).spawn();
let log = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.pipeTo(
    new WritableStream({ write: (c) => void (log += new TextDecoder().decode(c)) }),
  ).catch(() => {});
}

async function get(path: string, init?: RequestInit): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, { redirect: "follow", ...init });
  return { status: res.status, text: await res.text() };
}

let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  try {
    ready = (await fetch(`${base}/`)).status === 200;
  } catch { /* not up yet */ }
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}

const failures: string[] = [];
async function check(name: string, fn: () => Promise<string | undefined>): Promise<void> {
  try {
    const problem = await fn();
    console.log(`${problem ? "✗" : "✓"} ${name}${problem ? ` — ${problem}` : ""}`);
    if (problem) failures.push(name);
  } catch (err) {
    console.log(`✗ ${name} — ${err instanceof Error ? err.message : err}`);
    failures.push(name);
  }
}
const expectStatus = (path: string, status: number, init?: RequestInit) => async () => {
  const res = await get(path, init);
  return res.status === status ? undefined : `${path} returned ${res.status}, expected ${status}`;
};

try {
  if (!ready) {
    failures.push("boot");
    console.log("✗ boot — the site never answered on /");
  } else {
    await check("home page renders", async () => {
      const res = await get("/");
      return res.status === 200 && res.text.includes("Welcome to Your Dune Site")
        ? undefined
        : `status ${res.status}`;
    });
    await check("blog index renders", expectStatus("/blog", 200));
    await check("RSS feed", expectStatus("/feed.xml", 200));
    await check("sitemap", expectStatus("/sitemap.xml", 200));
    await check("search API", expectStatus("/api/search?q=window", 200));
    await check("content API", expectStatus("/api/pages", 200));

    // Publish windows (frontmatter publish_date / unpublish_date)
    await check("page inside its publish window is live", expectStatus("/window", 200));
    await check("page before its publish_date is hidden", expectStatus("/future", 404));
    await check("page after its unpublish_date is hidden", expectStatus("/expired", 404));
    await check("published: false beats an open window", expectStatus("/draft", 404));
    await check("sitemap lists only live pages", async () => {
      const { text } = await get("/sitemap.xml");
      const bad = ["/future", "/expired", "/draft"].filter((p) => text.includes(p));
      return !bad.length && text.includes("/window") ? undefined : `bad: ${bad.join(", ") || "window missing"}`;
    });
    await check("search finds only live pages", async () => {
      const { text } = await get("/api/search?q=body");
      const bad = ["Future", "Expired", "Draft"].filter((t) => text.includes(t));
      return bad.length ? `hidden pages found: ${bad.join(", ")}` : undefined;
    });

    // Public forms and the incoming webhook (no admin plugin to register them)
    const submissionsDir = `${root}/data/submissions/contact`;
    const stored = async () => {
      try {
        return [...Deno.readDirSync(submissionsDir)].filter((e) => e.name.endsWith(".json")).length;
      } catch {
        return 0;
      }
    };
    const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
      get(path, { method: "POST", body, headers });
    const asJson = { "content-type": "application/json", accept: "application/json" };

    await check("form schema is served", async () => {
      const res = await get("/api/forms/contact");
      return res.status === 200 && res.text.includes('"honeypot":"_hp"') ? undefined : `status ${res.status}`;
    });
    await check("unknown form is 404", expectStatus("/api/forms/nope", 404));
    await check("form submission is accepted and stored", async () => {
      const before = await stored();
      const res = await post("/api/forms/contact", JSON.stringify({ name: "A", message: "hello" }), asJson);
      if (res.status !== 200) return `status ${res.status}: ${res.text}`;
      return (await stored()) === before + 1 ? undefined : "no submission file written";
    });
    await check("form-encoded submission redirects to success_url", async () => {
      const res = await fetch(`${base}/api/forms/contact`, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({ name: "B", message: "hello" }),
      });
      await res.body?.cancel();
      return res.status === 302 && res.headers.get("location") === "/thanks"
        ? undefined
        : `status ${res.status} → ${res.headers.get("location")}`;
    });
    await check("invalid submission is rejected, not stored", async () => {
      const before = await stored();
      const res = await post("/api/forms/contact", JSON.stringify({ name: "" }), asJson);
      return res.status === 422 && (await stored()) === before ? undefined : `status ${res.status}`;
    });
    await check("honeypot submission is swallowed, not stored", async () => {
      const before = await stored();
      const res = await post("/api/forms/contact", JSON.stringify({ name: "A", message: "x", _hp: "bot" }), asJson);
      return res.status === 200 && (await stored()) === before ? undefined : `status ${res.status}`;
    });
    await check("incoming webhook rejects a wrong token", async () => {
      const res = await post("/api/webhook/incoming", "{}", { authorization: "Bearer nope" });
      return res.status === 401 ? undefined : `status ${res.status}`;
    });
    await check("incoming webhook runs a permitted action", async () => {
      const res = await post("/api/webhook/incoming", "{}", { authorization: "Bearer smoke-token" });
      return res.status === 200 && res.text.includes("purge-cache") ? undefined : `status ${res.status}: ${res.text}`;
    });
    await check("form submissions are rate limited", async () => {
      for (let i = 0; i < 8; i++) {
        const res = await post("/api/forms/contact", JSON.stringify({ name: "R", message: "hello" }), asJson);
        if (res.status === 429) return undefined;
      }
      return "never got a 429 in 8 submissions";
    });

    // Admin must be genuinely absent, not just unlinked
    await check("admin panel is not mounted", expectStatus("/admin/login", 404));
    await check("no default admin user was created", async () => {
      try {
        await Deno.stat(`${root}/data/users`);
        return "data/users exists";
      } catch {
        return undefined;
      }
    });
  }
} finally {
  try {
    server.kill("SIGTERM");
  } catch { /* already gone */ }
  await Promise.race([server.status, new Promise((r) => setTimeout(r, 3000))]);
  try {
    server.kill("SIGKILL");
  } catch { /* already gone */ }
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join("; ")}`);
  if (!ready) console.log(`\n--- server output ---\n${log}`);
  Deno.exit(1);
}
console.log("\nAll headless checks passed.");
