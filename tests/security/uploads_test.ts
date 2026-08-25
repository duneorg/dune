import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkUpload,
  contentMatchesMime,
  DEFAULT_UPLOAD_EXTENSIONS,
} from "../../src/security/uploads.ts";

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

Deno.test("contentMatchesMime: accepts correct magic bytes", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const webp = new Uint8Array(12);
  webp.set(enc("RIFF"), 0);
  webp.set(enc("WEBP"), 8);

  assert(contentMatchesMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"));
  assert(contentMatchesMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"));
  assert(contentMatchesMime(enc("GIF89a"), "image/gif"));
  assert(contentMatchesMime(webp, "image/webp"));
  assert(contentMatchesMime(enc("....ftypavif...."), "image/avif"));
  assert(contentMatchesMime(enc("%PDF-1.7"), "application/pdf"));
  assert(contentMatchesMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "application/zip"));
  assert(contentMatchesMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
});

Deno.test("contentMatchesMime: rejects polyglot mismatches", () => {
  const html = new TextEncoder().encode("<html><script>x</script></html>");
  assert(!contentMatchesMime(html, "image/gif"));
  assert(!contentMatchesMime(html, "image/png"));
  assert(!contentMatchesMime(new TextEncoder().encode("%PDF-1.7"), "image/jpeg"));
  assert(!contentMatchesMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "image/jpeg"));
});

Deno.test("contentMatchesMime: unknown types pass through (no false rejections)", () => {
  assert(contentMatchesMime(new TextEncoder().encode("anything"), "text/plain"));
  assert(contentMatchesMime(new TextEncoder().encode("\xd0\xcf\x11\xe0"), "application/msword"));
});
