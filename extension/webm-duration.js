// Chrome's MediaRecorder writes WebM without a Duration, so players show no length and seeking is poor.
// addWebmDuration() inserts a Duration element into the Segment > Info element of the first chunk.
// Pure function (no browser APIs); unit-tested in extension/tests.

const ID_EBML = 0x1a45dfa3, ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_TIMESCALE = 0x2ad7b1, ID_DURATION = 0x4489;

function readVint(b, pos, keepMarker) {
  const first = b[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error("bad EBML vint");
  let val = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    val = val * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { len, val, unknown: allOnes };
}

function readElement(b, pos) {
  const id = readVint(b, pos, true);
  const size = readVint(b, pos + id.len, false);
  const dataStart = pos + id.len + size.len;
  return { id: id.val, start: pos, dataStart, size: size.unknown ? null : size.val, end: size.unknown ? null : dataStart + size.val };
}

function readUint(b, start, end) {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + b[i];
  return v;
}

/**
 * @param {Uint8Array} bytes   beginning of the WebM file (must contain the Info element; the first 10 s chunk does)
 * @param {number} durationMs  recording length
 * @returns {Uint8Array} patched copy, or the input unchanged if it already has a Duration / can't be parsed
 */
export function addWebmDuration(bytes, durationMs) {
  try {
    const head = readElement(bytes, 0);
    if (head.id !== ID_EBML) return bytes;
    const seg = readElement(bytes, head.end);
    if (seg.id !== ID_SEGMENT) return bytes;
    let pos = seg.dataStart;
    while (pos < bytes.length) {
      const el = readElement(bytes, pos);
      if (el.end === null) return bytes; // unknown-size child before Info: give up safely
      if (el.id === ID_INFO) {
        let timescale = 1_000_000, p = el.dataStart;
        while (p < el.end) {
          const c = readElement(bytes, p);
          if (c.id === ID_DURATION) return bytes; // already there
          if (c.id === ID_TIMESCALE) timescale = readUint(bytes, c.dataStart, c.end);
          p = c.end;
        }
        // Duration = float64, in TimecodeScale units (default 1 ms)
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (durationMs * 1_000_000) / timescale);
        const payloadLen = el.end - el.dataStart + dur.length;
        const info = new Uint8Array(4 + 8 + payloadLen);
        info.set([0x15, 0x49, 0xa9, 0x66]);
        // size as an 8-byte vint: 0x01 marker + 7 bytes value
        let v = payloadLen;
        for (let i = 11; i >= 5; i--) { info[i] = v % 256; v = Math.floor(v / 256); }
        info[4] = 0x01;
        info.set(bytes.subarray(el.dataStart, el.end), 12);
        info.set(dur, 12 + (el.end - el.dataStart));
        const out = new Uint8Array(bytes.length - (el.end - el.start) + info.length);
        out.set(bytes.subarray(0, el.start), 0);
        out.set(info, el.start);
        out.set(bytes.subarray(el.end), el.start + info.length);
        return out;
      }
      pos = el.end;
    }
  } catch {}
  return bytes;
}
