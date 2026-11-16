// Phrase quality for the keyword-gap list (pure functions, unit-tested in tests/kwgap-clean.test.ts).
// Competitor titles are cut into 2–3 word n-grams; most of those are not things anyone searches
// ("بعدی مناسب", "سی با بهترین", "انواع ضد"). This module decides which n-grams are real topics,
// normalizes spelling so duplicates collapse, and groups wording variants into one cluster
// ("اسپیکر بلوتوث" / "اسپیکر بلوتوثی" / "انواع اسپیکر بلوتوثی" → one row).

/** Big marketplaces / non-shop sites: they rank for everything, so they say nothing about topical rivals. */
export const MARKETPLACE_HOSTS = new Set([
  "digikala.com", "torob.com", "emalls.ir", "divar.ir", "sheypoor.com", "basalam.com", "snappshop.ir", "timcheh.com",
  "wikipedia.org", "instagram.com", "aparat.com", "youtube.com", "amazon.com", "aliexpress.com",
]);

// Words that never carry a topic on their own (Persian function words + shop/template filler).
export const STOP = new Set((
  "از به در با و که برای این آن یا را تا هم است های ها ی بر هر چه چی چرا چگونه چطور کدام یک دو سه " +
  "انواع نوع مناسب بهترین بهتر همه همه‌ی کلیه تمام سی بعدی قبلی چند کاره کار جدید جدیدترین ویژه " +
  "قیمت خرید فروش ارزان ارزانترین اصل اصلی اورجینال انلاین آنلاین اینترنتی فروشگاه فروشگاهی نقد بررسی مشخصات تخصصی مشاهده لیست " +
  "همراه بدون دارای مدل سری طرح رنگ رنگی سایز عدد عددی بسته پک ست مجموعه محصول محصولات کالا برند " +
  "گارانتی ارسال رایگان تخفیف حراج پیشنهاد شگفت انگیز ضد مخصوص ویژگی ویژگیها راهنمای راهنما نکته نکات"
).split(" "));

// Adjective-making suffix written as its own token ("شیشه ای", "حرفه ای") — never a topic alone.
const SUFFIX_TOKENS = new Set(["ای", "اي", "ی", "ها", "های", "تر", "ترین"]);

const ZWNJ = /[‌‍‎‏]/g;

/** One spelling per word: Arabic ي/ك → ی/ک, ZWNJ → space, Persian/Arabic digits → Latin, Latin lowercased, spaces collapsed. */
export function normalize(s: string): string {
  return String(s || "")
    .replace(ZWNJ, " ")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ؤ/g, "و")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[ً-ْ]/g, "") // harakat
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough Persian stem so variants meet: «بلوتوثی»→«بلوتوث», «قاب‌ها»→«قاب», «گوشی‌های»→«گوشی». */
export function stem(w: string): string {
  if (/^[a-z0-9]+$/.test(w)) return w.replace(/s$/, "");
  let x = w;
  for (const suf of ["هایی", "های", "ها", "ترین", "تر"]) {
    if (x.length > suf.length + 2 && x.endsWith(suf)) { x = x.slice(0, -suf.length); break; }
  }
  // Adjectival «ی» («بلوتوثی»), but keep words where ی is part of the root («گوشی», «بازی», «کیفی»).
  if (x.length > 4 && x.endsWith("ی") && !KEEP_YEH.has(x)) x = x.slice(0, -1);
  return x;
}
const KEEP_YEH = new Set(["گوشی", "بازی", "کیفی", "صوتی", "ورزشی", "هوشی", "جانبی", "مغناطیسی", "مگنتی", "سیلیکونی", "چرمی", "شارژی", "دیواری", "ماشینی", "بی‌سیم", "بیسیم"]);

const tokens = (s: string) => normalize(s).split(" ").filter(Boolean);
const isNum = (w: string) => /^\d+$/.test(w);

/** Content words: not stopwords, not suffix tokens, not bare numbers. */
export function contentWords(phrase: string): string[] {
  return tokens(phrase).filter((w) => !STOP.has(w) && !SUFFIX_TOKENS.has(w) && !isNum(w) && w.length > 1);
}

/** Why a phrase is not a usable search topic, or "" when it is. */
export function rejectReason(phrase: string): string {
  const t = tokens(phrase);
  if (t.length < 2) return "تک‌کلمه";
  if (STOP.has(t[0]) || SUFFIX_TOKENS.has(t[0])) return "با کلمه بی‌معنی شروع می‌شود";
  if (STOP.has(t[t.length - 1])) return "با کلمه بی‌معنی تمام می‌شود";
  const c = contentWords(phrase);
  if (!c.length) return "کلمه موضوعی ندارد";
  // «شیشه ای», «حرفه ای»: one word + a split-off suffix is just an adjective.
  if (c.length === 1 && t.some((w) => SUFFIX_TOKENS.has(w))) return "فقط یک صفت است";
  // «چند کاره», «سی با بهترین»: under half of the words carry meaning.
  if (c.length * 2 < t.length) return "بیشترش کلمه بی‌معنی است";
  return "";
}

/** Same key for wording variants of one topic: stems of content words, order-independent. */
export function clusterKey(phrase: string): string {
  return [...new Set(contentWords(phrase).map(stem))].sort().join(" ");
}

/** Share of the phrase's content words that also appear in our own catalog/queries (0..1). */
export function relevance(phrase: string, field: Set<string>): number {
  const c = contentWords(phrase).map(stem);
  if (!c.length) return 0;
  return c.filter((w) => field.has(w)).length / c.length;
}

/** Stemmed vocabulary of our own site (product/page titles, Google queries, tracked keywords). */
export function vocabulary(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of contentWords(t)) out.add(stem(w));
  return out;
}

export type ClusterInput = { phrase: string; competitors: string[]; pages: number; weight: number };
export type Cluster = { phrase: string; variants: string[]; competitors: string[]; pages: number; weight: number };

/** Merges duplicates (after normalization) and wording variants; the most-used wording leads. */
export function clusterPhrases(items: ClusterInput[]): Cluster[] {
  const groups = new Map<string, ClusterInput[]>();
  for (const it of items) {
    const key = clusterKey(it.phrase);
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)!).push({ ...it, phrase: normalize(it.phrase) });
  }
  const out: Cluster[] = [];
  for (const list of groups.values()) {
    const byPhrase = new Map<string, ClusterInput>();
    for (const it of list) {
      const prev = byPhrase.get(it.phrase);
      byPhrase.set(it.phrase, prev
        ? { phrase: it.phrase, competitors: [...new Set([...prev.competitors, ...it.competitors])], pages: prev.pages + it.pages, weight: prev.weight + it.weight }
        : it);
    }
    const uniq = [...byPhrase.values()].sort((a, b) => b.pages - a.pages || contentWords(a.phrase).length - contentWords(b.phrase).length || a.phrase.length - b.phrase.length);
    // Prefer a lead wording that doesn't start with filler («انواع اسپیکر» → «اسپیکر بلوتوث»).
    const lead = uniq.find((u) => !rejectReason(u.phrase)) || uniq[0];
    out.push({
      phrase: lead.phrase,
      variants: uniq.map((u) => u.phrase).filter((p) => p !== lead.phrase),
      competitors: [...new Set(uniq.flatMap((u) => u.competitors))].sort(),
      pages: uniq.reduce((a, u) => a + u.pages, 0),
      weight: uniq.reduce((a, u) => a + u.weight, 0),
    });
  }
  return out;
}

/**
 * امتیاز = ۳۰ × تعداد رقبایی که این موضوع را دارند
 *        + ۸ × log2(وزن تکرار در عنوان/H1/H2 رقبا + ۱)   (عنوان ۳، H1 ۲، H2 ۱)
 *        + ۳ × log2(نمایش گوگل سایت ما + ۱)
 *        + ۲۰ × میزان ربط به محصولات و جستجوهای خود سایت (۰ تا ۱)
 */
export function score(competitors: number, weight: number, impressions: number, rel: number): number {
  return Math.round(competitors * 30 + 8 * Math.log2(weight + 1) + 3 * Math.log2(impressions + 1) + 20 * rel);
}
export const SCORE_HELP = "امتیاز = ۳۰ × تعداد رقبایی که این موضوع را دارند + ۸ × log₂(وزن تکرار در عنوان/H1/H2 رقبا + ۱) + ۳ × log₂(نمایش گوگل سایت شما + ۱) + ۲۰ × میزان ربط به محصولات و جستجوهای خود سایت (۰ تا ۱). وزن: عنوان ۳، H1 ۲، H2 ۱.";
