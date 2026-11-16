import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, rejectReason, clusterPhrases, clusterKey, relevance, vocabulary, score, stem } from "../lib/kwgap-clean";

test("normalize: Arabic letters, ZWNJ, digits, latin case, spaces", () => {
  assert.equal(normalize("گوشي‌هاي  USB ۳"), "گوشی های usb 3");
  assert.equal(normalize("كيف"), "کیف");
});

test("rejects meaningless fragments from competitor titles", () => {
  for (const p of ["بعدی مناسب", "سی با بهترین", "مناسب انواع", "انواع ضد", "چند کاره", "همه کاره", "شیشه ای", "حرفه ای", "اینترنتی انواع", "مناسب برای samsung", "قیمت خرید"]) {
    assert.notEqual(rejectReason(p), "", `should reject: ${p}`);
  }
});

test("keeps real topics", () => {
  for (const p of ["محافظ صفحه نمایش", "اسپیکر بلوتوث", "شارژر دیواری", "کیف تبلت", "usb 3 هاب", "پایه نگهدارنده موبایل", "ساعت هوشمند"]) {
    assert.equal(rejectReason(p), "", `should keep: ${p}`);
  }
});

test("variants share a cluster key", () => {
  assert.equal(clusterKey("اسپیکر بلوتوث"), clusterKey("اسپیکر بلوتوثی"));
  assert.equal(clusterKey("اسپیکر بلوتوث"), clusterKey("انواع اسپیکر بلوتوثی"));
  assert.notEqual(clusterKey("اسپیکر بلوتوث"), clusterKey("هدفون بلوتوث"));
  assert.equal(stem("گوشی"), "گوشی");
});

test("clusters merge duplicates and variants, union competitors", () => {
  const out = clusterPhrases([
    { phrase: "اسپیکر بلوتوث", competitors: ["a.com"], pages: 5, weight: 10 },
    { phrase: "اسپیکر بلوتوثی", competitors: ["b.com"], pages: 2, weight: 4 },
    { phrase: "انواع اسپیکر بلوتوثی", competitors: ["a.com"], pages: 1, weight: 3 },
    { phrase: "usb 3", competitors: ["a.com"], pages: 1, weight: 2 },
    { phrase: "USB ۳", competitors: ["c.com"], pages: 1, weight: 2 },
  ]);
  const sp = out.find((c) => c.phrase === "اسپیکر بلوتوث")!;
  assert.ok(sp);
  assert.deepEqual(sp.competitors, ["a.com", "b.com"]);
  assert.equal(sp.pages, 8);
  assert.deepEqual(sp.variants.sort(), ["اسپیکر بلوتوثی", "انواع اسپیکر بلوتوثی"].sort());
  const usb = out.filter((c) => clusterKey(c.phrase) === "usb");
  assert.equal(usb.length, 1);
  assert.deepEqual(usb[0].competitors, ["a.com", "c.com"]);
});

test("relevance to own vocabulary drops off-niche topics", () => {
  const field = vocabulary(["قاب مگنتی آیفون ۱۷", "اسپیکر بلوتوثی هیسکا", "محافظ لنز دوربین"]);
  assert.ok(relevance("اسپیکر بلوتوث", field) > 0.4);
  assert.equal(relevance("شامپو بدن", field), 0);
  assert.equal(relevance("قهوه ساز", field), 0);
});

test("score rises with competitors, impressions and relevance", () => {
  assert.ok(score(3, 10, 0, 0) > score(2, 10, 0, 0));
  assert.ok(score(2, 10, 100, 0) > score(2, 10, 0, 0));
  assert.ok(score(2, 10, 0, 1) > score(2, 10, 0, 0));
});
