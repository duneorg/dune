#!/usr/bin/env python3
"""
Rewrite all admin route files to use ctx.state.adminContext instead of getAdminContext().

Rules:
- _layout.tsx: replace getAdminContext() → state.adminContext
  (component function receives { Component, state, url })
- _middleware.ts + all other files: replace getAdminContext() → ctx.state.adminContext
  (handler functions receive ctx: FreshContext<AdminState>)
- Remove `import { getAdminContext } from "*.*/context.ts"` lines
"""

import os
import re
import sys

ROUTES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "src", "admin", "routes")

def transform_file(path: str) -> tuple[str, bool]:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if "getAdminContext" not in content:
        return content, False

    original = content

    # Determine the replacement expression based on file
    basename = os.path.basename(path)
    if basename == "_layout.tsx":
        replacement = "state.adminContext"
    else:
        replacement = "ctx.state.adminContext"

    # Replace all getAdminContext() calls
    content = content.replace("getAdminContext()", replacement)

    # Remove the import line (handles varying relative depths and whitespace)
    # Pattern: import { getAdminContext } from "...context.ts";
    content = re.sub(
        r'import \{ getAdminContext \} from "[^"]*context\.ts";\n?',
        "",
        content,
    )

    # Clean up any double blank lines left behind
    content = re.sub(r'\n{3,}', '\n\n', content)

    changed = content != original
    return content, changed


def main():
    changed_files = []
    unchanged_files = []

    for dirpath, _dirnames, filenames in os.walk(ROUTES_DIR):
        for filename in sorted(filenames):
            if not (filename.endswith(".ts") or filename.endswith(".tsx")):
                continue
            full_path = os.path.join(dirpath, filename)
            new_content, changed = transform_file(full_path)
            if changed:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                rel = os.path.relpath(full_path, os.path.dirname(ROUTES_DIR))
                changed_files.append(rel)
            else:
                rel = os.path.relpath(full_path, os.path.dirname(ROUTES_DIR))
                unchanged_files.append(rel)

    print(f"Modified  ({len(changed_files)} files):")
    for f in changed_files:
        print(f"  ✓ {f}")
    if unchanged_files:
        print(f"\nUnchanged ({len(unchanged_files)} files):")
        for f in unchanged_files:
            print(f"  - {f}")


if __name__ == "__main__":
    main()
