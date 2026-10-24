// Run: node --test extension/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normHost, normPattern, hostMatches, autoRuleFor, recordUse, setAuto, forget, sortedSites, MAX_SITES } from "../sites.js";

test("normalize hosts and patterns", () => {
  assert.equal(normHost("https://www.Meet.Google.com/abc-def"), "meet.google.com");
  assert.equal(normHost("lms.example.ru:8443"), "lms.example.ru");
  assert.equal(normPattern("*.Zoom.us/"), "*.zoom.us");
  assert.equal(normPattern("  https://www.youtube.com/watch?v=x "), "youtube.com");
});

test("exact and wildcard matching", () => {
  assert.ok(hostMatches("meet.google.com", "meet.google.com"));
  assert.ok(hostMatches("www.youtube.com", "youtube.com"));
  assert.ok(hostMatches("us02web.zoom.us", "*.zoom.us"));
  assert.ok(hostMatches("zoom.us", "*.zoom.us"));
  assert.ok(!hostMatches("evilzoom.us", "*.zoom.us"));
  assert.ok(!hostMatches("google.com", "meet.google.com"));
  assert.ok(!hostMatches("", "x.com"));
});

test("auto rule lookup only uses auto sites", () => {
  const sites = { "meet.google.com": { auto: true }, "youtube.com": { auto: false }, "*.zoom.us": { auto: true } };
  assert.equal(autoRuleFor("meet.google.com", sites), "meet.google.com");
  assert.equal(autoRuleFor("us04web.zoom.us", sites), "*.zoom.us");
  assert.equal(autoRuleFor("youtube.com", sites), null);
});

test("recordUse counts, keeps auto flag, caps size", () => {
  let s = setAuto({}, "meet.google.com", true);
  s = recordUse(s, "https://www.meet.google.com/x", 1000);
  s = recordUse(s, "meet.google.com", 2000);
  assert.deepEqual(s["meet.google.com"], { used: 2, last: 2000, auto: true });
  for (let i = 0; i < MAX_SITES + 20; i++) s = recordUse(s, `site${i}.com`, 3000 + i);
  assert.equal(Object.keys(s).length, MAX_SITES);
  assert.ok(s["meet.google.com"], "auto sites are never evicted");
  assert.ok(!s["site0.com"], "oldest non-auto sites are evicted first");
});

test("forget and sort", () => {
  let s = recordUse(recordUse({}, "a.com", 1), "b.com", 2);
  s = setAuto(s, "a.com", true);
  assert.deepEqual(sortedSites(s).map(([k]) => k), ["a.com", "b.com"]); // auto first
  s = forget(s, "A.com");
  assert.deepEqual(Object.keys(s), ["b.com"]);
});
