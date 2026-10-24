// Run: node --test extension/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { addWebmDuration } from "../webm-duration.js";

// minimal WebM: EBML header, Segment (unknown size), Info { TimecodeScale = 1 ms }, start of a Cluster
const sample = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77,             // EBML { DocType-ish payload }
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // Segment, unknown size
  0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, // Info { TimecodeScale 1e6 } (7 bytes)
  0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // Cluster (unknown size)
]);

function findDuration(b) {
  for (let i = 0; i < b.length - 11; i++)
    if (b[i] === 0x44 && b[i + 1] === 0x89 && b[i + 2] === 0x88) return new DataView(b.buffer, b.byteOffset + i + 3, 8).getFloat64(0);
  return null;
}

test("inserts Duration (ms at 1 ms timescale) and keeps the rest", () => {
  const out = addWebmDuration(sample, 3_725_500);
  assert.equal(findDuration(out), 3_725_500);
  // everything after Info (the Cluster) is unchanged
  assert.deepEqual([...out.slice(-12)], [...sample.slice(-12)]);
  assert.equal(out.length, sample.length + 11 /* Duration */ + 7 /* 8-byte size vint instead of 1 */);
});

test("idempotent: a file that has a Duration is left alone", () => {
  const once = addWebmDuration(sample, 1000);
  assert.equal(addWebmDuration(once, 5000), once);
});

test("garbage in -> unchanged", () => {
  const junk = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.equal(addWebmDuration(junk, 1000), junk);
});
