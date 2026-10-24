// Service worker: owns capture state, creates the offscreen document, relays subtitles to the tab.
const DEFAULTS = { server: "ws://127.0.0.1:8765", engine: "auto", showRu: true, hideEn: false, fontSize: 26, lines: 2 };

async function state() {
  const { capture } = await chrome.storage.session.get("capture");
  return capture || null; // {tabId}
}

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
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };
  if (!streamId) streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await chrome.storage.session.set({ capture: { tabId } });
  await chrome.runtime.sendMessage({ target: "offscreen", type: "start", streamId, tabId, settings });
  chrome.tabs.sendMessage(tabId, { type: "overlay-show", settings }).catch(() => {});
  chrome.action.setBadgeText({ text: "ON", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

async function stop() {
  const cur = await state();
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
    if (msg.type === "start") await start(msg.tabId, msg.streamId);
    else if (msg.type === "stop") await stop();
    else if (msg.type === "status") return reply(await state());
    else if (msg.type === "sub" || msg.type === "conn") {
      // from offscreen -> forward to the captured tab's overlay
      const cur = await state();
      if (cur) chrome.tabs.sendMessage(cur.tabId, msg).catch(() => {});
    } else if (msg.type === "settings") {
      const cur = await state();
      if (cur) {
        chrome.tabs.sendMessage(cur.tabId, { type: "overlay-settings", settings: msg.settings }).catch(() => {});
        chrome.runtime.sendMessage({ target: "offscreen", type: "settings", settings: msg.settings }).catch(() => {});
      }
    } else if (msg.type === "ended") {
      await stop();
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

// Page reloaded/navigated inside the captured tab: show the overlay again.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const cur = await state();
  if (!cur || cur.tabId !== tabId || info.status !== "complete") return;
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };
  chrome.tabs.sendMessage(tabId, { type: "overlay-show", settings }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const cur = await state();
  if (cur && cur.tabId === tabId) await stop();
});
