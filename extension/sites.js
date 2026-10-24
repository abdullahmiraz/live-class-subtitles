// Site memory + auto-start rules: pure functions (no chrome.* APIs), unit-tested in extension/tests.
//
// sites = { "<host or pattern>": { used: <times started>, last: <epoch ms>, auto: <bool> } }
// Patterns: exact host ("meet.google.com") or a wildcard for subdomains ("*.zoom.us" matches
// "us02web.zoom.us" and "zoom.us"). A leading "www." is ignored on both sides.

export const MAX_SITES = 100;

export function normHost(h) {
  return String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/^www\./, "");
}

/** Clean user input into a stored pattern: "https://www.Zoom.us/j/1" -> "zoom.us", "*.Zoom.us" -> "*.zoom.us". */
export function normPattern(p) {
  p = String(p || "").trim().toLowerCase();
  if (p.startsWith("*.")) return "*." + normHost(p.slice(2));
  return normHost(p);
}

export function hostMatches(host, pattern) {
  host = normHost(host);
  pattern = normPattern(pattern);
  if (!host || !pattern) return false;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === pattern;
}

/** Is this host on the auto-start list? Returns the matching pattern or null. */
export function autoRuleFor(host, sites) {
  for (const [pattern, s] of Object.entries(sites || {})) if (s && s.auto && hostMatches(host, pattern)) return pattern;
  return null;
}

/** Remember that subtitles were started on `host` (keeps the 100 most recent). Returns a new object. */
export function recordUse(sites, host, now = Date.now()) {
  host = normHost(host);
  const out = { ...(sites || {}) };
  if (!host) return out;
  const cur = out[host] || { used: 0, last: 0, auto: false };
  out[host] = { ...cur, used: (cur.used || 0) + 1, last: now };
  const keys = Object.keys(out);
  if (keys.length > MAX_SITES) {
    // forget the least recently used non-auto sites first
    keys.filter((k) => !out[k].auto).sort((a, b) => out[a].last - out[b].last)
      .slice(0, keys.length - MAX_SITES).forEach((k) => delete out[k]);
  }
  return out;
}

export function setAuto(sites, pattern, auto) {
  pattern = normPattern(pattern);
  const out = { ...(sites || {}) };
  if (!pattern) return out;
  out[pattern] = { used: 0, last: 0, ...(out[pattern] || {}), auto: !!auto };
  return out;
}

export function forget(sites, pattern) {
  const out = { ...(sites || {}) };
  delete out[normPattern(pattern)];
  return out;
}

/** For the popup: auto sites first, then most recently used. */
export function sortedSites(sites) {
  return Object.entries(sites || {}).sort(([, a], [, b]) => (b.auto - a.auto) || (b.last - a.last));
}
