import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join, resolve } from "@std/path";
import { buildThemePackageIndex, buildThemePackageStaticDirs } from "../../src/themes/packages.ts";
import { createThemeLoader } from "../../src/themes/loader.ts";
import { createStorage } from "../../src/storage/mod.ts";

const FIXTURES = resolve(new URL("../fixtures", import.meta.url).pathname);
const REPO_ROOT = resolve(FIXTURES, "../..");
const BASE_SRC = "./tests/fixtures/theme-base";
const PARENT_SRC = "./tests/fixtures/theme-parent";

Deno.test("buildThemePackageIndex: resolves local package paths", async () => {
  const index = await buildThemePackageIndex({
    siteRoot: REPO_ROOT,
    packages: [{ name: "base", src: BASE_SRC }],
  });
  assertEquals(index.byName.get("base"), join(FIXTURES, "theme-base"));
  assertEquals(index.bySrc.get(BASE_SRC), join(FIXTURES, "theme-base"));
});

Deno.test("buildThemePackageStaticDirs: maps theme name to static/", async () => {
  const index = await buildThemePackageIndex({
    siteRoot: REPO_ROOT,
    packages: [{ name: "base", src: BASE_SRC }],
  });
  const dirs = buildThemePackageStaticDirs(index);
  assertEquals(dirs.get("base"), join(FIXTURES, "theme-base", "static"));
});

Deno.test("createThemeLoader: loads package-backed active theme via activeSrc", async () => {
  const storage = createStorage({ rootDir: REPO_ROOT });
  const index = await buildThemePackageIndex({
    siteRoot: REPO_ROOT,
    packages: [{ name: "base", src: BASE_SRC }],
    active: { name: "base", src: BASE_SRC },
  });
  const loader = await createThemeLoader({
    storage,
    themesDir: "themes",
    themeName: "base",
    siteRoot: REPO_ROOT,
    packages: index,
    activeSrc: BASE_SRC,
  });
  assertEquals(loader.theme.manifest.name, "base");
  assertEquals(loader.theme.absoluteRoot, join(FIXTURES, "theme-base"));
  assertEquals(loader.theme.templateNames, ["default"]);
});

Deno.test("createThemeLoader: local child inherits package parent", async () => {
  const siteDir = await Deno.makeTempDir({ prefix: "dune-theme-test-" });
  const themesDir = join(siteDir, "themes");
  const childDir = join(themesDir, "child");
  await Deno.mkdir(join(childDir, "templates"), { recursive: true });
  await Deno.writeTextFile(join(childDir, "theme.yaml"), "name: child\nparent: parent\n");
  await Deno.writeTextFile(join(childDir, "templates/article.tsx"), "export default () => null;");

  try {
    const index = await buildThemePackageIndex({
      siteRoot: REPO_ROOT,
      packages: [{ name: "parent", src: PARENT_SRC }],
    });
    const loader = await createThemeLoader({
      storage: createStorage({ rootDir: siteDir }),
      themesDir: "themes",
      themeName: "child",
      siteRoot: REPO_ROOT,
      packages: index,
    });
    assertEquals(loader.theme.manifest.name, "child");
    assertEquals(loader.theme.parent?.manifest.name, "parent");
    assertEquals(loader.getAvailableTemplates().sort(), ["article"]);
  } finally {
    await Deno.remove(siteDir, { recursive: true });
  }
});
