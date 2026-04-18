import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkUpload, DEFAULT_UPLOAD_EXTENSIONS } from "../../src/security/uploads.ts";

Deno.test("checkUpload: accepts common image extensions", () => {
  for (const name of ["a.jpg", "b.JPEG", "c.png", "d.gif", "e.webp", "f.avif"]) {
    const r = checkUpload(name);
    assert(r.ok, `expected ${name} to be accepted`);
    if (r.ok) assert(r.contentType.startsWith("image/"));
  }
});

Deno.test("checkUpload: accepts pdf, office docs, txt, csv, zip", () => {
  for (const name of ["a.pdf", "b.doc", "c.docx", "d.xls", "e.xlsx", "f.odt", "g.ods", "h.txt", "i.csv", "j.zip"]) {
    const r = checkUpload(name);
    assert(r.ok, `expected ${name} to be accepted`);
  }
});

Deno.test("checkUpload: rejects executable and script extensions", () => {
  for (const name of ["evil.php", "evil.sh", "evil.exe", "evil.js", "evil.html", "evil.svg", "evil.phtml", "evil.py"]) {
    const r = checkUpload(name);
    assertEquals(r.ok, false, `expected ${name} to be rejected`);
  }
});

Deno.test("checkUpload: rejects files without an extension", () => {
  const r = checkUpload("README");
  assertEquals(r.ok, false);
});

Deno.test("checkUpload: content-type is derived server-side, not from client", () => {
  const r = checkUpload("report.pdf");
  assert(r.ok);
  if (r.ok) assertEquals(r.contentType, "application/pdf");
});

Deno.test("checkUpload: extension check is case-insensitive", () => {
  const r = checkUpload("PHOTO.JPG");
  assert(r.ok);
  if (r.ok) assertEquals(r.contentType, "image/jpeg");
});

Deno.test("checkUpload: respects custom allowlist override", () => {
  const custom = { ".md": "text/markdown" };
  const ok = checkUpload("notes.md", custom);
  assert(ok.ok);
  const no = checkUpload("photo.jpg", custom);
  assertEquals(no.ok, false);
});

Deno.test("checkUpload: default allowlist does not include html or svg", () => {
  assert(!(".html" in DEFAULT_UPLOAD_EXTENSIONS));
  assert(!(".svg" in DEFAULT_UPLOAD_EXTENSIONS));
  assert(!(".js" in DEFAULT_UPLOAD_EXTENSIONS));
});
