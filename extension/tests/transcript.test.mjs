// Run: node --test extension/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, srtTime, fileName, render, dataUrl, FORMATS } from "../transcript.js";

const T0 = new Date(2026, 9, 24, 18, 5, 0).getTime();
const t = {
  site: "meet.google.com",
  url: "https://meet.google.com/abc-defg-hij",
  title: "Lecture 5",
  startedAt: T0,
  endedAt: T0 + 3_725_000,
  entries: [
    { start: T0 + 1_200, end: T0 + 4_800, lang: "ru", ru: "Добрый день, начнём лекцию.", en: "Good afternoon, let's start the lecture.", engine: "google" },
    { start: T0 + 3_661_000, end: T0 + 3_663_250, lang: "en", ru: "", en: "Any questions?", engine: "whisper" },
  ],
};

test("clock and srtTime", () => {
  assert.equal(clock(0), "00:00:00");
  assert.equal(clock(3_661_999), "01:01:01");
  assert.equal(srtTime(3_663_250), "01:01:03,250");
  assert.equal(srtTime(-5), "00:00:00,000");
});

test("file name is safe and dated", () => {
  assert.equal(fileName(t, "srt"), "ru-en-subtitles/meet.google.com_2026-10-24_18-05.srt");
  assert.equal(fileName({ ...t, site: "a/b:c?" }, "md"), "ru-en-subtitles/a_b_c__2026-10-24_18-05.md");
});

test("markdown has both languages and marks English speech", () => {
  const md = render(t, "md");
  assert.match(md, /\*\*\[00:00:01\]\*\* Good afternoon, let's start the lecture\.\s+\n<sub>Добрый день, начнём лекцию\.<\/sub>/);
  assert.match(md, /\*\*\[01:01:01\]\*\* Any questions\?\s+\n<sub>\(spoken in English\)<\/sub>/);
});

test("srt is valid", () => {
  const srt = render(t, "srt");
  assert.equal(
    srt,
    "1\n00:00:01,200 --> 00:00:04,800\nGood afternoon, let's start the lecture.\nДобрый день, начнём лекцию.\n\n" +
      "2\n01:01:01,000 --> 01:01:03,250\nAny questions?\n(spoken in English)\n",
  );
});

test("txt and json", () => {
  assert.match(render(t, "txt"), /\[00:00:01\] Good afternoon/);
  const j = JSON.parse(render(t, "json"));
  assert.equal(j.entries.length, 2);
  assert.deepEqual(j.entries[1], { start: 3661, end: 3663.25, lang: "en", ru: null, en: "Any questions?", engine: "whisper" });
});

test("every format renders", () => {
  for (const f of Object.keys(FORMATS)) assert.ok(render(t, f).length > 20, f);
});

test("dataUrl round-trips UTF-8", () => {
  const url = dataUrl("Привет, мир — hello", "text/plain");
  const b64 = url.split(",")[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), "Привет, мир — hello");
});

test("end-of-class word summary + Anki export", async () => {
  const { toAnki } = await import("../transcript.js");
  const words = [{ lemma: "дуб", word: "дубе", meaning: "oak", grammar: "noun · masculine · prepositional · singular",
    sentence: "У лукоморья дуб зелёный.", sentenceEn: "There is a green oak\tnear Lukomorye.", ts: T0 }];
  const md = render({ ...t, words }, "md");
  assert.match(md, /## Words saved this class \(1\)/);
  assert.match(md, /- \*\*дуб\*\* — oak _\(noun · masculine/);
  assert.match(render({ ...t, words }, "txt"), /Words saved this class:\n  дуб — oak/);
  assert.equal(JSON.parse(render({ ...t, words }, "json")).words[0].lemma, "дуб");
  const anki = toAnki(words).split("\n");
  assert.equal(anki[0], "#separator:tab");
  assert.equal(anki[3].split("\t").length, 6);           // tabs inside fields are cleaned
  assert.ok(anki[3].startsWith("дуб\toak\tnoun"));
});
