// Service worker: owns capture state, creates the offscreen document, relays subtitles to the tab,
// and keeps the transcript being saved (chrome.storage.session, so it survives SW restarts and page reloads).
import { FORMATS, dataUrl, fileName, render } from "./transcript.js";

const DEFAULTS = {
  server: "ws://127.0.0.1:8765", engine: "auto", showRu: true, hideEn: false, fontSize: 26,
  saveMode: "off", // off | manual | auto
  saveFormat: "md", // md | srt | txt | json
  saveTranscript: true, // what a recording keeps: the transcript (EN + RU)…
  saveAudio: false, //   …and/or the class audio (.webm)
  learn: false, // learning mode: color-match Russian words with their translation
  bgOpacity: 0.88, // subtitle box background
};
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) });

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
  const { saveTranscript, saveAudio } = await getSettings();
  if (!saveTranscript && !saveAudio) return; // nothing selected to keep
  const tab = await chrome.tabs.get(tabId);
  let site = "tab";
  try { site = new URL(tab.url).hostname || "tab"; } catch {}
  const rec = {
    tabId, site, url: tab.url, title: tab.title, startedAt: Date.now(), entries: [],
    wantTranscript: !!saveTranscript, wantAudio: !!saveAudio,
  };
  await chrome.storage.session.set({ rec });
  if (rec.wantAudio) await chrome.runtime.sendMessage({ target: "offscreen", type: "rec-start" }).catch(() => {});
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
    const t = setTimeout(() => { chrome.downloads.onChanged.removeListener(on); resolve(false); }, timeoutMs);
    function on(d) {
      if (d.id !== id || !d.state || d.state.current === "in_progress") return;
      clearTimeout(t);
      chrome.downloads.onChanged.removeListener(on);
      resolve(d.state.current === "complete");
    }
    chrome.downloads.onChanged.addListener(on);
  });
}

const finishSaving = () => serial(async () => {
  const rec = await getRec();
  if (!rec) return null;
  await chrome.storage.session.remove("rec");
  await notifySaving(rec.tabId);
  rec.endedAt = Date.now();
  const files = [];

  if (rec.wantAudio) {
    const audio = await chrome.runtime.sendMessage({ target: "offscreen", type: "rec-stop" }).catch(() => null);
    if (audio && audio.url) {
      const filename = fileName(rec, "md").replace(/\.md$/, ".webm");
      const id = await chrome.downloads.download({ url: audio.url, filename, conflictAction: "uniquify", saveAs: false });
      await downloadDone(id);
      chrome.runtime.sendMessage({ target: "offscreen", type: "rec-free", url: audio.url }).catch(() => {});
      const [item] = await chrome.downloads.search({ id }); // Chrome may have renamed it ("… (1).webm")
      const saved = item && item.filename ? item.filename.split(/[\\/]/).pop() : filename.split("/").pop();
      rec.audioFile = saved;
      files.push("ru-en-subtitles/" + saved);
    }
  }

  if (rec.wantTranscript && rec.entries.length) {
    const { saveFormat } = await getSettings();
    const format = FORMATS[saveFormat] ? saveFormat : "md";
    const filename = fileName(rec, format);
    await chrome.downloads.download({
      url: dataUrl(render(rec, format), FORMATS[format].mime),
      filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    files.push(filename);
  }

  if (!files.length) return { saved: false, reason: "nothing was said" };
  chrome.tabs.sendMessage(rec.tabId, { type: "saved", files, count: rec.entries.length }).catch(() => {});
  return { saved: true, files, count: rec.entries.length };
});

// ---------- page script ----------
// Tabs opened before the extension was (re)loaded don't have content.js yet: inject it on demand.
async function ensureContent(tabId) {
  try {
    if (await chrome.tabs.sendMessage(tabId, { type: "ping" })) return;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (e) {
    console.warn("cannot show subtitles on this page:", e.message); // e.g. chrome:// or the Web Store
  }
}

async function showOverlay(tabId) {
  await ensureContent(tabId);
  const { conn } = await chrome.storage.session.get("conn");
  chrome.tabs.sendMessage(tabId, { type: "overlay-show", settings: await getSettings(), conn: !!conn }).catch(() => {});
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
  const cur = await state();
  if (cur) await stop();
  const settings = await getSettings();
  if (!streamId) streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await chrome.storage.session.set({ capture: { tabId }, conn: false });
  await chrome.runtime.sendMessage({ target: "offscreen", type: "start", streamId, tabId, settings });
  await showOverlay(tabId);
  chrome.action.setBadgeText({ text: "ON", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
  if (settings.saveMode === "auto") await beginSaving(tabId);
}

async function stop() {
  const cur = await state();
  await finishSaving(); // first: the audio recorder lives in the offscreen document
  await chrome.storage.session.remove("capture");
  try { await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }); } catch {}
  try { await chrome.offscreen.closeDocument(); } catch {}
  if (cur) {
    chrome.tabs.sendMessage(cur.tabId, { type: "overlay-hide" }).catch(() => {});
    chrome.action.setBadgeText({ text: "", tabId: cur.tabId });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "background") return;
  (async () => {
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
      case "save-stop": return reply(await finishSaving());
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
          chrome.runtime.sendMessage({ target: "offscreen", type: "settings", settings: msg.settings }).catch(() => {});
        }
        break;
      }
      case "ended": await stop(); break;
    }
    reply(true);
  })();
  return true;
});

// Keyboard shortcut: toggle on the active tab (a command counts as a user gesture for tabCapture).
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "toggle-capture") return;
  const cur = await state();
  if (cur && cur.tabId === tab.id) await stop();
  else await start(tab.id);
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
