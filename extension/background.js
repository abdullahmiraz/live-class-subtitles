// Service worker: owns capture state, creates the offscreen document, relays subtitles to the tab,
// and keeps the transcript being saved (chrome.storage.session, so it survives SW restarts and page reloads).
import { FORMATS, dataUrl, fileName, render } from "./transcript.js";
import { autoRuleFor, forget, normPattern, recordUse, setAuto, sortedSites } from "./sites.js";

const DEFAULTS = {
  server: "ws://127.0.0.1:8765", engine: "auto", showRu: true, hideEn: false, fontSize: 26,
  saveMode: "off", // off | manual | auto
  saveFormat: "md", // md | srt | txt | json
  saveTranscript: true, // what a recording keeps: the transcript (EN + RU)…
  saveAudio: false, //   …and/or the class audio
  audioFormat: "mp3", // mp3 (plays everywhere) | webm (Opus, smallest)
  learn: false, // learning mode: color-match Russian words with their translation
  bgOpacity: 0.88, // subtitle box background
  display: "panel", // panel (history box) | subtitles (YouTube-style captions over the video)
};
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) });

/** Message the offscreen document; never waits longer than `ms` (resolves to `fallback`). */
function toOffscreen(msg, ms = 10000, fallback = null) {
  return Promise.race([
    chrome.runtime.sendMessage({ target: "offscreen", ...msg }).catch(() => fallback),
    new Promise((res) => setTimeout(() => res(fallback), ms)),
  ]);
}

async function state() {
  const { capture } = await chrome.storage.session.get("capture");
  return capture || null; // {tabId}
}

// ---------- transcript saving ----------
// All transcript writes go through one promise chain so concurrent finals can't overwrite each other.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

async function getRec() {
  return (await chrome.storage.session.get("rec")).rec || null;
}

async function notifySaving(tabId) {
  const rec = await getRec();
  chrome.tabs.sendMessage(tabId, {
    type: "saving", on: !!rec, count: rec ? rec.entries.length : 0,
    transcript: !!rec?.wantTranscript, audio: !!rec?.wantAudio,
  }).catch(() => {});
}

const beginSaving = (tabId) => serial(async () => {
  if (await getRec()) return;
  const { saveTranscript, saveAudio, audioFormat } = await getSettings();
  if (!saveTranscript && !saveAudio) return; // nothing selected to keep
  const tab = await chrome.tabs.get(tabId);
  let site = "tab";
  try { site = new URL(tab.url).hostname || "tab"; } catch {}
  const rec = {
    tabId, site, url: tab.url, title: tab.title, startedAt: Date.now(), entries: [],
    wantTranscript: !!saveTranscript, wantAudio: !!saveAudio, audioFormat: audioFormat === "webm" ? "webm" : "mp3",
  };
  await chrome.storage.session.set({ rec });
  if (rec.wantAudio) await toOffscreen({ type: "rec-start", format: rec.audioFormat }, 3000);
  await notifySaving(tabId);
});

const addEntry = (e) => serial(async () => {
  const rec = await getRec();
  if (!rec) return;
  rec.entries.push(e);
  await chrome.storage.session.set({ rec });
  await notifySaving(rec.tabId);
});

/** Resolves when a download has finished (the offscreen blob: URL must live until then). */
function downloadDone(id, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let finished = false;
    const end = (ok) => { if (finished) return; finished = true; clearTimeout(t); chrome.downloads.onChanged.removeListener(on); resolve(ok); };
    const t = setTimeout(() => end(false), timeoutMs);
    function on(d) {
      if (d.id === id && d.state && d.state.current !== "in_progress") end(d.state.current === "complete");
    }
    chrome.downloads.onChanged.addListener(on);
    // it may already have finished before we subscribed (small files are instant)
    chrome.downloads.search({ id }).then(([it]) => { if (it && it.state !== "in_progress") end(it.state === "complete"); });
  });
}

/** Download a blob: URL made by the offscreen document, then let it free the memory. Returns the saved name. */
async function downloadBlob(url, filename) {
  const id = await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
  await downloadDone(id);
  toOffscreen({ type: "rec-free", url }, 2000);
  const [item] = await chrome.downloads.search({ id }); // Chrome may have renamed it ("… (1).mp3")
  return item && item.filename ? item.filename.split(/[\\/]/).pop() : filename.split("/").pop();
}

const finishSaving = () => serial(async () => {
  const rec = await getRec();
  if (!rec) return null;
  await chrome.storage.session.remove("rec");
  await notifySaving(rec.tabId);
  rec.endedAt = Date.now();
  const files = [];

  if (rec.wantAudio) {
    const audio = await toOffscreen({ type: "rec-stop" }, 15000);
    if (audio && audio.url) {
      const filename = fileName(rec, "md").replace(/\.md$/, "." + (audio.ext || rec.audioFormat || "mp3"));
      const saved = await downloadBlob(audio.url, filename);
      rec.audioFile = saved;
      files.push("ru-en-subtitles/" + saved);
    }
  }

  if (rec.wantTranscript && rec.entries.length) {
    const { saveFormat } = await getSettings();
    const format = FORMATS[saveFormat] ? saveFormat : "md";
    const filename = fileName(rec, format);
    const text = render(rec, format);
    // long classes: a blob: URL from the offscreen document (data: URLs hit Chrome's ~2 MB URL limit)
    const blob = await toOffscreen({ type: "make-blob", text, mime: FORMATS[format].mime }, 5000);
    if (blob && blob.url) files.push("ru-en-subtitles/" + (await downloadBlob(blob.url, filename)));
    else {
      await chrome.downloads.download({ url: dataUrl(text, FORMATS[format].mime), filename, conflictAction: "uniquify", saveAs: false });
      files.push(filename);
    }
  }

  if (!files.length) return { saved: false, reason: "nothing was said" };
  chrome.tabs.sendMessage(rec.tabId, { type: "saved", files, count: rec.entries.length }).catch(() => {});
  return { saved: true, files, count: rec.entries.length };
});

// ---------- page script ----------
// Tabs opened before the extension was (re)loaded don't have content.js yet: inject it on demand.
async function ensureContent(tabId) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: "ping" }).then((r) => (r && r.host) || "").catch(() => null);
  let host = await ask();
  if (host !== null) return host;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    host = await ask();
  } catch (e) {
    console.warn("cannot show subtitles on this page:", e.message); // e.g. chrome:// or the Web Store
  }
  return host || "";
}

// ---------- remembered sites + auto-start ----------
const getSites = async () => (await chrome.storage.local.get("sites")).sites || {};
const saveSites = (sites) => chrome.storage.local.set({ sites });
const snoozed = new Map(); // tabId -> until (ms): "Not now" on the auto-start prompt

async function shortcutText() {
  const c = (await chrome.commands.getAll()).find((x) => x.name === "toggle-capture");
  return (c && c.shortcut) || "";
}

// Chrome only lets an extension capture a tab after the user invokes it (icon click or shortcut),
// so "auto-start" = when a listed site starts playing sound, offer one-key start on the page.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.audible !== true) return;
  if ((snoozed.get(tabId) || 0) > Date.now()) return;
  const cur = await state();
  if (cur && cur.tabId === tabId) return; // already running here
  const sites = await getSites();
  if (!Object.values(sites).some((s) => s.auto)) return; // nothing on the auto-start list: stay out of the way
  const host = await ensureContent(tabId); // also works for tabs opened before the extension was reloaded
  if (!host) return;
  const rule = autoRuleFor(host, sites);
  if (!rule) return;
  snoozed.set(tabId, Date.now() + 60_000); // at most one prompt per minute per tab
  chrome.tabs.sendMessage(tabId, { type: "autostart-prompt", host, rule, shortcut: await shortcutText(), busy: !!cur }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => snoozed.delete(tabId));

async function showOverlay(tabId) {
  const host = await ensureContent(tabId);
  const { conn } = await chrome.storage.session.get("conn");
  chrome.tabs.sendMessage(tabId, { type: "overlay-show", settings: await getSettings(), conn: !!conn }).catch(() => {});
  return host;
}

// ---------- capture ----------
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture tab audio for live subtitles",
  });
}

async function start(tabId, streamId) {
  // get the stream first: if this tab can't be captured (chrome:// pages…), the running session stays untouched
  if (!streamId) streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const cur = await state();
  if (cur) await stop();
  const settings = await getSettings();
  await ensureOffscreen();
  await chrome.storage.session.set({ capture: { tabId }, conn: false });
  await toOffscreen({ type: "start", streamId, tabId, settings }, 5000);
  const host = await showOverlay(tabId);
  if (host) saveSites(recordUse(await getSites(), host)); // remember sites where subtitles were used
  chrome.action.setBadgeText({ text: "ON", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
  if (settings.saveMode === "auto") await beginSaving(tabId);
}

/** Let the server finish the sentence being spoken, so it lands in the saved transcript. */
async function flushLastSentence() {
  if (!(await getRec())) return;
  await toOffscreen({ type: "flush" }, 9000);
  await new Promise((r) => setTimeout(r, 400)); // let the last "final" message reach addEntry
}

async function stop() {
  const cur = await state();
  await flushLastSentence();
  await finishSaving(); // before closing: the audio recorder lives in the offscreen document
  await chrome.storage.session.remove("capture");
  await toOffscreen({ type: "stop" }, 3000);
  try { await chrome.offscreen.closeDocument(); } catch {}
  if (cur) {
    chrome.tabs.sendMessage(cur.tabId, { type: "overlay-hide" }).catch(() => {});
    chrome.action.setBadgeText({ text: "", tabId: cur.tabId });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "background") return;
  (async () => {
   try {
    switch (msg.type) {
      case "start": await start(msg.tabId, msg.streamId); break;
      case "stop": await stop(); break;
      case "status": return reply(await state());
      case "save-status": {
        const rec = await getRec();
        return reply({ active: !!rec, count: rec ? rec.entries.length : 0, startedAt: rec?.startedAt, audio: !!rec?.wantAudio, transcript: !!rec?.wantTranscript });
      }
      case "save-start": {
        const cur = await state();
        if (cur) await beginSaving(cur.tabId);
        break;
      }
      case "save-stop": await flushLastSentence(); return reply(await finishSaving());
      case "sub":
      case "conn": {
        if (msg.type === "conn") await chrome.storage.session.set({ conn: msg.ok });
        // from offscreen -> forward to the captured tab's overlay
        const cur = await state();
        if (cur) chrome.tabs.sendMessage(cur.tabId, msg).catch(() => {});
        if (msg.type === "sub" && msg.kind === "final" && msg.en) {
          await addEntry({ start: msg.start, end: msg.end, lang: msg.lang || "ru", ru: msg.ru, en: msg.en, engine: msg.engine });
        }
        break;
      }
      case "settings": {
        const cur = await state();
        if (cur) {
          chrome.tabs.sendMessage(cur.tabId, { type: "overlay-settings", settings: msg.settings }).catch(() => {});
          toOffscreen({ type: "settings", settings: msg.settings }, 3000);
        }
        break;
      }
      case "ended": await stop(); break;
      case "sites-get": return reply({ sites: sortedSites(await getSites()), shortcut: await shortcutText() });
      case "site-auto": await saveSites(setAuto(await getSites(), msg.pattern, msg.auto)); break;
      case "site-forget": await saveSites(forget(await getSites(), msg.pattern)); break;
      case "page-host": { // popup fallback: which site is the active tab on? (injects the page script if missing)
        const host = await ensureContent(msg.tabId);
        return reply({ host: host || "", pattern: host ? normPattern(host) : "" });
      }
      case "prompt-snooze": if (sender.tab) snoozed.set(sender.tab.id, Date.now() + 10 * 60_000); break;
      case "prompt-never": // "Don't ask on this site"
        if (msg.pattern) await saveSites(setAuto(await getSites(), msg.pattern, false));
        break;
    }
    reply(true);
   } catch (e) {
    console.warn(msg.type, e);
    reply({ error: String(e && e.message || e) }); // e.g. "cannot capture this page"
   }
  })();
  return true;
});

// Keyboard shortcut: toggle on the active tab (a command counts as a user gesture for tabCapture).
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "toggle-capture") return;
  try {
    const cur = await state();
    if (cur && cur.tabId === tab.id) await stop();
    else await start(tab.id);
  } catch (e) {
    console.warn("shortcut:", e.message); // e.g. Chrome's own pages can't be captured
  }
});

// Page reloaded/navigated inside the captured tab: show the overlay (and saving indicator) again.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const cur = await state();
  if (!cur || cur.tabId !== tabId || info.status !== "complete") return;
  await showOverlay(tabId);
  notifySaving(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const cur = await state();
  if (cur && cur.tabId === tabId) await stop();
});
