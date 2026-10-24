// Translation chain logic with fake engines (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { translateChain, resetCooldowns, parseAlign, looksEnglish, wordForms, RANKED } from "../translate.js";

const fakes = (calls) => ({
  "yandex-nmt": async (t) => { calls.push("yandex-nmt"); return "Y:" + t; },
  google: async () => { calls.push("google"); throw new Error("HTTP 429"); },
  yandex: async (t) => { calls.push("yandex"); return "L:" + t; },
});

test("owner's order for English, Google first otherwise, cooldown after a failure", async () => {
  resetCooldowns();
  const calls = [];
  assert.deepEqual(await translateChain("auto", "привет", "en", "ru", fakes(calls)), ["Y:привет", "yandex-nmt"]);
  assert.deepEqual(calls, ["yandex-nmt"]);
  calls.length = 0;
  assert.deepEqual(await translateChain("auto", "привет", "es", "ru", fakes(calls)), ["Y:привет", "yandex-nmt"]);
  assert.deepEqual(calls, ["google", "yandex-nmt"]); // google failed -> next
  calls.length = 0;
  await translateChain("auto", "ещё", "es", "ru", fakes(calls));
  assert.deepEqual(calls, ["yandex-nmt"]); // google is cooling down
  assert.deepEqual(RANKED, ["yandex-nmt", "google", "yandex"]);
});

test("empty text and same language", async () => {
  assert.deepEqual(await translateChain("auto", "  ", "en"), ["", "none"]);
  assert.deepEqual(await translateChain("auto", "hello", "en", "en"), ["hello", "none"]);
});

test("alignment, English check, word forms", () => {
  assert.deepEqual(parseAlign(["0:5-0:4,6:3-5:2,bad"]), [[0, 5, 0, 4], [6, 3, 5, 2]]);
  assert.deepEqual(parseAlign(undefined), []);
  assert.ok(looksEnglish("Any questions about the homework?"));
  assert.ok(!looksEnglish("Обсудим machine learning сегодня вечером"));
  assert.ok(!looksEnglish("ok"));
  assert.deepEqual(wordForms("У дуба зелёный"), [[0, 1, "у"], [2, 4, "дуба"], [7, 7, "зелёный"]]);
});
