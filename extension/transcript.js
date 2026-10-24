// Transcript formatting: pure functions (no chrome.* APIs), unit-tested with `node --test extension/tests`.
//
// A transcript is { site, url, title, startedAt, endedAt, entries: [entry] } where every entry is
// { start, end, lang: "ru"|"en", ru, en, engine } and start/end are epoch milliseconds.

export const FORMATS = {
  md: { ext: "md", mime: "text/markdown", label: "Markdown" },
  srt: { ext: "srt", mime: "application/x-subrip", label: "SRT subtitles" },
  txt: { ext: "txt", mime: "text/plain", label: "Plain text" },
  json: { ext: "json", mime: "application/json", label: "JSON" },
};

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** "01:02:03" — offset from the start of the transcript. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "01:02:03,456" — SRT timestamp. */
export function srtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  return `${clock(ms)},${pad(ms % 1000, 3)}`;
}

/** Local "YYYY-MM-DD_HH-MM" for file names. */
export function stamp(epochMs) {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/** Downloads-relative path, e.g. "ru-en-subtitles/meet.google.com_2026-10-24_18-05.md". */
export function fileName(t, format) {
  const site = (t.site || "tab").replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
  return `ru-en-subtitles/${site}_${stamp(t.startedAt)}.${FORMATS[format].ext}`;
}

const ruLine = (e) => (e.lang === "en" ? "(spoken in English)" : e.ru);

export function toMarkdown(t) {
  const head = [
    `# Transcript: ${t.title || t.site}`,
    "",
    `- Site: ${t.url || t.site}`,
    `- Date: ${new Date(t.startedAt).toLocaleString()}`,
    `- Sentences: ${t.entries.length}`,
    ...(t.audioFile ? [`- Audio: ${t.audioFile}`] : []),
    "",
  ];
  const body = t.entries.map((e) => `**[${clock(e.start - t.startedAt)}]** ${e.en}  \n<sub>${ruLine(e)}</sub>\n`);
  return head.concat(body, wordsSection(t)).join("\n");
}

/** End-of-class summary: words saved with the hover card during this class. */
function wordsSection(t) {
  if (!t.words || !t.words.length) return [];
  return ["", `## Words saved this class (${t.words.length})`, "",
    ...t.words.map((w) => `- **${w.lemma}** — ${w.meaning}${w.grammar ? ` _(${w.grammar})_` : ""}${w.sentence ? `  \n  <sub>${w.sentence}</sub>` : ""}`)];
}

export function toSrt(t) {
  return t.entries
    .map((e, i) => {
      const a = e.start - t.startedAt;
      const b = Math.max(e.end - t.startedAt, a + 500);
      return `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${e.en}\n${ruLine(e)}\n`;
    })
    .join("\n");
}

export function toText(t) {
  const lines = [`Transcript: ${t.title || t.site} (${new Date(t.startedAt).toLocaleString()})`, ""];
  for (const e of t.entries) lines.push(`[${clock(e.start - t.startedAt)}] ${e.en}`, `           ${ruLine(e)}`, "");
  if (t.words && t.words.length) lines.push("Words saved this class:", ...t.words.map((w) => `  ${w.lemma} — ${w.meaning}`), "");
  return lines.join("\n");
}

export function toJson(t) {
  return JSON.stringify(
    {
      site: t.site,
      url: t.url,
      title: t.title,
      audioFile: t.audioFile ?? null,
      startedAt: new Date(t.startedAt).toISOString(),
      endedAt: new Date(t.endedAt ?? Date.now()).toISOString(),
      entries: t.entries.map((e) => ({
        start: +((e.start - t.startedAt) / 1000).toFixed(2),
        end: +((e.end - t.startedAt) / 1000).toFixed(2),
        lang: e.lang,
        ru: e.lang === "en" ? null : e.ru,
        en: e.en,
        engine: e.engine,
      })),
      words: (t.words || []).map((w) => ({ lemma: w.lemma, word: w.word, meaning: w.meaning, grammar: w.grammar, sentence: w.sentence })),
    },
    null,
    2,
  );
}

/** Anki import file (tab-separated, with Anki's header lines) from the saved vocabulary. */
export function toAnki(vocab) {
  const clean = (x) => String(x || "").replace(/[\t\n\r]+/g, " ").trim();
  const rows = vocab.map((w) => [w.lemma, w.meaning, w.grammar, w.sentence, w.sentenceEn, new Date(w.ts).toISOString().slice(0, 10)].map(clean).join("\t"));
  return ["#separator:tab", "#html:false", "#columns:Russian\tEnglish\tGrammar\tExample\tExample (EN)\tDate", ...rows].join("\n") + "\n";
}

export function render(t, format) {
  return { md: toMarkdown, srt: toSrt, txt: toText, json: toJson }[format](t);
}

/** data: URL for chrome.downloads (MV3 service workers have no URL.createObjectURL). */
export function dataUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};charset=utf-8;base64,${btoa(bin)}`;
}
