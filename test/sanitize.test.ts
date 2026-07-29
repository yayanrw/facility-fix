import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanRemarks } from "../lib/sanitize.ts";

test("strips script tags and their contents", () => {
  const out = cleanRemarks('<p>ok</p><script>alert(1)</script>') ?? "";
  assert.equal(out.includes("<script"), false);
  assert.equal(out.includes("alert(1)"), false);
  assert.match(out, /<p>ok<\/p>/);
});

test("drops <img> entirely, so onerror has nothing to attach to", () => {
  const out = cleanRemarks('<p>a</p><img src=x onerror=alert(1)>') ?? "";
  assert.equal(out.includes("<img"), false);
  assert.equal(out.includes("onerror"), false);
});

test("strips event handler attributes from allowed tags", () => {
  const out = cleanRemarks('<p onclick="alert(1)">teks</p>') ?? "";
  assert.equal(out.includes("onclick"), false);
  assert.match(out, /teks/);
});

test("rejects javascript: and data: URLs on links", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  ]) {
    const out = cleanRemarks(`<a href="${href}">klik</a>`) ?? "";
    assert.equal(out.includes("javascript:"), false, href);
    assert.equal(out.toLowerCase().includes("javascript"), false, href);
    assert.equal(out.includes("data:text/html"), false, href);
  }
});

test("keeps http, https, and mailto links and hardens their rel", () => {
  const out = cleanRemarks('<a href="https://example.com">situs</a>') ?? "";
  assert.match(out, /href="https:\/\/example\.com"/);
  assert.match(out, /rel="noopener noreferrer"/);
  assert.match(out, /target="_blank"/);
});

test("keeps the formatting reviewers actually use", () => {
  const out =
    cleanRemarks("<p><b>Tebal</b> dan <i>miring</i></p><ul><li>Satu</li></ul>") ?? "";
  assert.match(out, /<b>Tebal<\/b>/);
  assert.match(out, /<i>miring<\/i>/);
  assert.match(out, /<ul><li>Satu<\/li><\/ul>/);
});

test("iframes, objects, and style blocks do not survive", () => {
  for (const payload of [
    '<iframe src="https://evil.test"></iframe>',
    "<object data=x></object>",
    "<style>body{display:none}</style>",
    "<svg/onload=alert(1)>",
  ]) {
    const out = cleanRemarks(payload) ?? "";
    assert.equal(/<(iframe|object|style|svg)/i.test(out), false, payload);
    assert.equal(/onload/i.test(out), false, payload);
  }
});

test("blank input collapses to null rather than empty markup", () => {
  assert.equal(cleanRemarks(null), null);
  assert.equal(cleanRemarks(""), null);
  assert.equal(cleanRemarks("<script>alert(1)</script>"), null);
});

test("an empty paragraph is preserved as markup, not silently dropped", () => {
  // sanitize-html keeps <p></p>; the blank-rejection guard is isRemarksEmpty's
  // job, not the sanitiser's. Documented here so the split stays deliberate.
  assert.equal(cleanRemarks("<p><br></p>"), "<p><br /></p>");
});
