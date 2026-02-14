/**
 * CLI i18n commands — content:i18n-status.
 *
 * Reports translation coverage across configured languages.
 */

import { bootstrap } from "./bootstrap.ts";

export interface I18nOptions {
  debug?: boolean;
}

export async function i18nStatusCommand(root: string, options: I18nOptions = {}) {
  const ctx = await bootstrap(root, { debug: options.debug });
  const { engine, config } = ctx;

  const languages = config.system.languages?.supported ?? [];
  const defaultLang = config.system.languages?.default ?? "en";

  if (languages.length === 0) {
    console.log("\n  ℹ️  No languages configured in site config.");
    console.log("     Add site.languages.supported to enable i18n tracking.\n");
    return;
  }

  const otherLangs = languages.filter((l: string) => l !== defaultLang);

  if (otherLangs.length === 0) {
    console.log("\n  ℹ️  Only one language configured. Nothing to report.\n");
    return;
  }

  // One logical page per route (use default-language pages)
  const defaultLangPages = engine.pages.filter((p) => p.language === defaultLang);

  console.log(`\n  🌐 Translation Status`);
  console.log(`     Default language: ${defaultLang}`);
  console.log(`     Languages: ${languages.join(", ")}`);
  console.log(`     Total pages: ${defaultLangPages.length}\n`);

  // Check each non-default language
  for (const lang of otherLangs) {
    let translated = 0;
    let missing = 0;

    for (const page of defaultLangPages) {
      // Convention: translations live in {sourcePath}.{lang}.{ext}
      // or in a parallel directory structure under {lang}/
      const langPath = page.sourcePath.replace(
        /\.(md|mdx|tsx)$/,
        `.${lang}.$1`,
      );

      const hasTranslation = engine.pages.some(
        (p) => p.sourcePath === langPath,
      );

      if (hasTranslation) {
        translated++;
      } else {
        missing++;
      }
    }

    const total = defaultLangPages.length;
    const pct = total > 0 ? Math.round((translated / total) * 100) : 0;
    const bar = renderBar(pct, 30);

    console.log(`  ${lang.toUpperCase()} ${bar} ${pct}%`);
    console.log(`     ✅ ${translated} translated  ❌ ${missing} missing`);
  }

  console.log("");
}

function renderBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
