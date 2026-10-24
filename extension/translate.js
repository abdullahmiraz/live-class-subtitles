// Translation inside the extension (no companion needed): the same free endpoints and order as
// server/translate.py. Pure apart from fetch(), so it's unit-tested with a fake fetch (extension/tests).
//
//   yandex-nmt  classic Yandex (mobile app endpoint)  <- first for English (owner's choice)
//   google      Google "gtx" endpoint                  <- first for every other language
//   yandex      Yandex Browser endpoint (LLM-based; only accepts format=html)
// translateChain() tries them in order; an engine that errors is skipped for COOLDOWN_MS.
import { ALIGNED } from "./langs.js";

export const RANKED = ["yandex-nmt", "google", "yandex"]; // target English
export const RANKED_OTHER = ["google", "yandex-nmt", "yandex"]; // any other target
export const COOLDOWN_MS = 20000;
const GOOGLE_CODE = { zh: "zh-CN", he: "iw" };
const SID = crypto.randomUUID().replaceAll("-", "");
const downUntil = {};

async function getJson(url, init = {}, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
const form = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });
const unescapeHtml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function google(text, tl = "en", sl = "ru") {
  const q = new URLSearchParams({ client: "gtx", sl: GOOGLE_CODE[sl] || sl, tl: GOOGLE_CODE[tl] || tl, dt: "t", q: text });
  const d = await getJson(`https://translate.googleapis.com/translate_a/single?${q}`);
  return d[0].filter((p) => p && p[0]).map((p) => p[0]).join("").trim();
}

export async function yandexNmt(text, tl = "en", sl = "ru") {
  const d = await getJson(`https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-mobile&lang=${sl}-${tl}&id=${SID}-00-0`, form({ text }));
  if (d.code !== 200) throw new Error(JSON.stringify(d).slice(0, 80));
  return d.text.join(" ").trim();
}

export async function yandex(text, tl = "en", sl = "ru") {
  const q = new URLSearchParams({ translateMode: "context", context_title: "lecture", id: `${SID}-0-0`, srv: "yabrowser",
    lang: `${sl}-${tl}`, format: "html", text: escapeHtml(text) });
  const d = await getJson(`https://browser.translate.yandex.net/api/v1/tr.json/translate?${q}`);
  if (d.code !== 200) throw new Error(JSON.stringify(d).slice(0, 80));
  return unescapeHtml(d.text.join(" ")).trim();
}

/** Yandex classic + word alignment (learning colors): [translation, [[ruStart, ruLen, trStart, trLen], …]]. */
export async function yandexAligned(text, tl = "en") {
  const d = await getJson(`https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-mobile&lang=ru-${tl}&id=${SID}-00-0&options=4`, form({ text }));
  if (d.code !== 200) throw new Error(JSON.stringify(d).slice(0, 80));
  return [d.text.join(" ").trim(), parseAlign(d.align)];
}

export function parseAlign(align) {
  const out = [];
  for (const chunk of ((align || [""])[0] || "").split(",")) {
    const m = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(chunk.trim());
    if (m) out.push(m.slice(1).map(Number));
  }
  return out;
}

export const ENGINES = { "yandex-nmt": yandexNmt, google, yandex };

/** Translate with `first` (or "auto"), then the rest. Returns [translation, engine]. */
export async function translateChain(first, text, tl = "en", sl = "ru", engines = ENGINES) {
  if (!text.trim()) return ["", "none"];
  if (sl === tl) return [text, "none"];
  const ranked = tl === "en" ? RANKED : RANKED_OTHER;
  const order = engines[first] ? [first, ...ranked.filter((e) => e !== first)] : ranked;
  for (const name of order) {
    if ((downUntil[name] || 0) > Date.now()) continue;
    try {
      const out = await engines[name](text, tl, sl);
      if (out) return [out, name];
    } catch (e) {
      downUntil[name] = Date.now() + COOLDOWN_MS;
      console.warn(`[translate] ${name} failed (${e.message}); skipping it for ${COOLDOWN_MS / 1000}s`);
    }
  }
  return ["", "none"];
}
export const resetCooldowns = () => Object.keys(downUntil).forEach((k) => delete downUntil[k]);

/** Learning mode: aligned Yandex translation where Yandex provides word matches, else the normal chain. */
export async function translateForLearning(first, text, tl) {
  if (ALIGNED.has(tl)) {
    try {
      const [out, align] = await yandexAligned(text, tl);
      if (out) return [out, "yandex-nmt", align];
    } catch {}
  }
  const [out, used] = await translateChain(first, text, tl);
  return [out, used, []];
}

/** Mostly Latin letters = a sentence spoken in English (same rule as server/engine.py looks_english). */
export function looksEnglish(text) {
  const letters = [...text.replace(/<unk>/g, "")].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 4) return false;
  return letters.filter((c) => c.charCodeAt(0) < 128).length / letters.length > 0.5;
}

/** [[start, len, form], …] for each Russian word: the "dictionary form" here is just the lower-cased word
 * (the companion server gives real dictionary forms via pymorphy3). */
export function wordForms(text) {
  return [...text.matchAll(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g)].map((m) => [m.index, m[0].length, m[0].toLowerCase()]);
}
