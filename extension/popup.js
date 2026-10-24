import { dataUrl, toAnki } from "./transcript.js";
import { originsFor } from "./sites.js";
import { ALIGNED, TARGETS, langName } from "./langs.js";
const DEFAULTS = {
  server: "ws://127.0.0.1:8765", engine: "auto", target: "en", showRu: true, hideEn: false, fontSize: 26,
  saveMode: "off", saveFormat: "md", saveTranscript: true, saveAudio: false, audioFormat: "mp3", learn: false, bgOpacity: 0.88, display: "panel",
  finalOnly: false, capStyle: "band", capColor: "#ffffff", audioSource: "tab", micId: "",
  readAloud: false, ruFirst: false, hoverCard: true, newOnly: false,
};
const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage({ target: "background", ...m });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
bg({ type: "popup-open", tabId: tab.id }); // brings back the subtitles if this captured page was reloaded
const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };

// ---------- Basic / Advanced tabs (last used tab is remembered) ----------
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + name));
  chrome.storage.local.set({ popupTab: name });
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
chrome.storage.local.get("popupTab").then((r) => r.popupTab && showTab(r.popupTab));
$("shortcuts").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });

// ⓘ icons: one shared tooltip, kept inside the popup
const tip = $("tip");
function showTip(el) {
  tip.textContent = el.dataset.tip;
  const r = el.getBoundingClientRect(), w = Math.min(230, document.body.clientWidth - 8);
  tip.style.maxWidth = w + "px";
  tip.classList.add("on");
  const t = tip.getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(r.left - 20, document.documentElement.clientWidth - t.width - 4)) + "px";
  tip.style.top = (r.bottom + 6 + t.height < innerHeight ? r.bottom + 6 : Math.max(4, r.top - t.height - 6)) + "px";
}
document.querySelectorAll(".i").forEach((el) => {
  el.onmouseenter = el.onfocus = () => showTip(el);
  el.onmouseleave = el.onblur = () => tip.classList.remove("on");
  el.onclick = (e) => e.preventDefault(); // inside a <label>: don't toggle the checkbox
});

$("target").replaceChildren(...Object.entries(TARGETS).map(([code, name]) => new Option(name, code)));
$("target").value = settings.target;
if (!$("target").value) $("target").value = settings.target = "en";
$("engine").value = settings.engine;
if (!$("engine").value) $("engine").value = settings.engine = "auto"; // e.g. removed "argos" option
$("fontSize").value = settings.fontSize;
$("showRu").checked = settings.showRu;
$("hideEn").checked = settings.hideEn;
$("saveMode").value = settings.saveMode;
$("saveFormat").value = settings.saveFormat;
$("saveTranscript").checked = settings.saveTranscript;
$("saveAudio").checked = settings.saveAudio;
$("audioFormat").value = settings.audioFormat;
$("learn").checked = settings.learn;
$("display").value = settings.display;
for (const id of ["capStyle", "capColor", "audioSource"]) $(id).value = settings[id];
for (const id of ["finalOnly", "readAloud", "ruFirst", "hoverCard", "newOnly"]) $(id).checked = !!settings[id];
// word colors need Yandex word matching, which only some languages get
const learnHint = () => {
  $("learnHint").textContent = settings.learn && !ALIGNED.has(settings.target)
    ? `Word colors aren't available for ${langName(settings.target)}; word cards still work.` : "";
};
learnHint();
$("bgOpacity").value = Math.round(settings.bgOpacity * 100);
$("bgOpacityVal").textContent = $("bgOpacity").value + "%";

async function refresh() {
  const cur = await bg({ type: "status" });
  const on = cur && cur.tabId === tab.id;
  $("toggle").textContent = on ? "Stop" : cur ? "Move to this tab" : "Start on this tab";
  $("toggle").classList.toggle("on", on);
  await refreshSave(on);
}

async function refreshSave(capturingHere) {
  const s = await bg({ type: "save-status" });
  const btn = $("saveBtn");
  btn.style.display = settings.saveMode === "manual" ? "" : "none";
  const nothing = !settings.saveTranscript && !settings.saveAudio;
  btn.disabled = (!capturingHere || nothing) && !s.active;
  btn.textContent = s.active ? "Stop & save" : "Start recording";
  btn.classList.toggle("on", s.active);
  $("saveFormat").disabled = !settings.saveTranscript;
  $("audioFormat").disabled = !settings.saveAudio;
  const what = [s.transcript && `${s.count} sentence${s.count === 1 ? "" : "s"}`, s.audio && "audio"].filter(Boolean).join(" + ");
  if (s.active) $("saveInfo").textContent = `⏺ Recording… ${what}`;
  else if (settings.saveMode !== "off" && nothing) $("saveInfo").textContent = "Tick Transcript and/or Audio.";
  else if (settings.saveMode === "auto") $("saveInfo").textContent = "Every session is saved automatically when subtitles stop.";
  else if (settings.saveMode === "manual") $("saveInfo").textContent = capturingHere ? "" : "Start subtitles first.";
  else $("saveInfo").textContent = "";
}

$("saveBtn").onclick = async () => {
  const s = await bg({ type: "save-status" });
  if (s.active) {
    const r = await bg({ type: "save-stop" });
    await refresh();
    $("saveInfo").textContent = r && r.saved ? `Saved → ${r.files.map((f) => f.split("/").pop()).join(", ")}` : "Nothing to save yet.";
  } else {
    await bg({ type: "save-start" });
    refresh();
  }
};
$("openFolder").onclick = () => chrome.downloads.showDefaultFolder();

// ---------- sites: remembered + auto-start ----------
let here = { host: "", pattern: "" };
/** Auto-start needs access to that one site (to notice it playing sound). Chrome shows its prompt only
 * during a click, so permissions.request() must be the first thing the click handler does. */
async function setAutoSite(pattern, on) {
  const asked = on ? chrome.permissions.request({ origins: originsFor(pattern) }).catch(() => false) : null;
  await bg({ type: "site-auto", pattern, auto: on });
  if (asked && !(await asked)) await bg({ type: "site-auto", pattern, auto: false }); // access declined
  refreshSites();
}
async function refreshSites() {
  const { sites, missing = [], shortcut } = await bg({ type: "sites-get" });
  if (shortcut) $("shortcut").textContent = shortcut;
  const list = $("siteList");
  list.replaceChildren();
  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : "never used");
  for (const [pattern, s] of sites) {
    const row = document.createElement("div");
    row.className = "site";
    row.innerHTML = `<input type="checkbox" title="Auto-start on this site" /><span class="n"></span><span class="u"></span><button class="x" title="Forget this site">✕</button>`;
    const cb = row.querySelector("input");
    cb.checked = !!s.auto;
    cb.onchange = () => setAutoSite(pattern, cb.checked);
    row.querySelector(".n").textContent = (s.auto ? "★ " : "") + pattern;
    row.querySelector(".u").textContent = s.used ? `${s.used}× · ${fmtDate(s.last)}` : "";
    if (missing.includes(pattern)) { // auto-start is on but Chrome access was never given (or was removed)
      const a = document.createElement("a");
      a.textContent = "allow";
      a.title = "Auto-start needs access to this site to notice it playing sound";
      a.onclick = () => setAutoSite(pattern, true);
      row.querySelector(".u").replaceWith(a);
    }
    row.querySelector(".x").onclick = async () => { await bg({ type: "site-forget", pattern }); refreshSites(); };
    list.append(row);
  }
  if (!sites.length) list.innerHTML = '<div class="hint" style="margin:2px 0">No sites yet: start subtitles somewhere and it appears here.</div>';
  const mine = sites.find(([p]) => p === here.pattern);
  $("autoHere").checked = !!(mine && mine[1].auto);
}
// The popup was opened by clicking the icon, so Chrome lets it read this tab's address (activeTab);
// that works even on tabs opened before the extension was (re)loaded. Ask the page as a fallback.
(tab.url && /^https?:/.test(tab.url)
  ? Promise.resolve({ host: new URL(tab.url).hostname, pattern: new URL(tab.url).hostname.replace(/^www\./, "") })
  : bg({ type: "page-host", tabId: tab.id })
).then((r) => {
  here = r || here;
  $("curHost").textContent = here.host || "this site";
  $("autoHere").disabled = !here.host; // e.g. chrome:// pages
  refreshSites();
});
$("autoHere").onchange = () => here.pattern && setAutoSite(here.pattern, $("autoHere").checked);
$("addBtn").onclick = () => {
  const v = $("addPattern").value.trim();
  if (!v) return;
  $("addPattern").value = "";
  setAutoSite(v, true);
};
// ---------- Advanced: microphone setup, Test ----------
$("micSetup").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
function offline(text) { // the companion isn't reachable: point to the setup page
  $("testOut").innerHTML = "";
  const a = Object.assign(document.createElement("a"), { textContent: "how to set it up" });
  a.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  $("testOut").append(text + " · ", a);
}
$("testBtn").onclick = () => {
  $("testOut").textContent = "testing…";
  const ws = new WebSocket(settings.server + "/selftest");
  const t = setTimeout(() => { offline("✗ local server not answering"); ws.close(); }, 15000);
  ws.onmessage = (e) => {
    clearTimeout(t);
    const d = JSON.parse(e.data);
    const speech = String(d.speech || "");
    const lines = [`✓ local server · speech recognition ${speech.startsWith("ok") ? "✓" + (speech.includes("loads") ? " (loads on Start)" : "") : "✗ " + speech}`];
    const NAMES = { "yandex-nmt": "Yandex classic", google: "Google", yandex: "Yandex LLM" };
    for (const [name, r] of Object.entries(d.translators || {}))
      lines.push(`${r.ok ? "✓" : "✗"} ${NAMES[name] || name} ${r.ok ? r.ms + " ms" : "— " + (r.error || "failed")}`);
    $("testOut").textContent = lines.join("\n");
  };
  ws.onerror = () => { clearTimeout(t); offline("✗ local server not running"); };
};

// ---------- Extra: vocabulary ----------
async function refreshVocab() {
  const { vocab = [], known = [] } = await chrome.storage.local.get(["vocab", "known"]);
  $("vocabInfo").textContent = vocab.length
    ? `${vocab.length} saved word${vocab.length === 1 ? "" : "s"} · newest: ${vocab.slice(-3).map((v) => v.lemma).reverse().join(", ")}`
    : "No saved words yet: hover a Russian word → ★ Save.";
  $("ankiBtn").disabled = $("vocabClear").disabled = !vocab.length;
  $("knownInfo").innerHTML = known.length ? `${known.length} word${known.length === 1 ? "" : "s"} marked “I know it” · <a id="knownReset">reset</a>` : "";
  if (known.length) $("knownReset").onclick = async () => { if (confirm("Forget all “I know it” words?")) { await chrome.storage.local.set({ known: [] }); refreshVocab(); } };
}
$("ankiBtn").onclick = async () => {
  const { vocab = [] } = await chrome.storage.local.get("vocab");
  const url = dataUrl(toAnki(vocab), "text/plain"); // a blob: URL could die with the popup before the download starts
  await chrome.downloads.download({ url, filename: `live-class-subtitles/vocabulary_${new Date().toISOString().slice(0, 10)}.txt`, conflictAction: "uniquify" });
  $("vocabInfo").textContent += " · exported ✓ (Anki: File → Import)";
};
$("vocabClear").onclick = async () => {
  if (confirm("Delete all saved words?")) { await chrome.storage.local.set({ vocab: [] }); refreshVocab(); }
};
refreshVocab();

$("addPattern").onkeydown = (e) => e.key === "Enter" && $("addBtn").click();
setInterval(refresh, 2000); // live sentence counter while the popup is open

$("toggle").onclick = async () => {
  const cur = await bg({ type: "status" });
  if (cur && cur.tabId === tab.id) await bg({ type: "stop" });
  else {
    // must be called from the popup (user gesture) to get a stream id for this tab
    let res;
    try {
      // microphone mode needs no tab capture
      const streamId = settings.audioSource === "mic" ? null : await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      res = await bg({ type: "start", tabId: tab.id, streamId });
    } catch (e) {
      res = { error: e.message };
    }
    if (res && res.error) {
      $("srv").textContent = "can't capture this page (Chrome's own pages and the Web Store are blocked)";
      $("srv").className = "bad";
    }
  }
  refresh();
};

for (const id of ["target", "engine", "fontSize", "showRu", "hideEn", "saveMode", "saveFormat", "saveTranscript", "saveAudio", "audioFormat", "learn", "display",
  "capStyle", "capColor", "finalOnly", "audioSource", "readAloud", "ruFirst", "hoverCard", "newOnly"]) {
  $(id).onchange = async () => {
    let v = $(id).type === "checkbox" ? $(id).checked : $(id).value;
    if (id === "fontSize") v = $(id).value = Math.max(12, Math.min(48, Math.round(Number(v)) || 26)); // never 0 / empty
    settings[id] = v;
    await chrome.storage.sync.set({ [id]: v });
    bg({ type: "settings", settings: { [id]: v } }); // only what changed (the box may have changed others)
    learnHint();
    refresh();
  };
}

// background opacity: live preview while dragging the slider
$("bgOpacity").oninput = () => {
  settings.bgOpacity = Number($("bgOpacity").value) / 100;
  $("bgOpacityVal").textContent = $("bgOpacity").value + "%";
  bg({ type: "settings", settings: { bgOpacity: settings.bgOpacity } });
};
$("bgOpacity").onchange = () => chrome.storage.sync.set({ bgOpacity: settings.bgOpacity });

// is the local server running?
try {
  const ws = new WebSocket(settings.server + "/ping");
  ws.onopen = () => { $("srv").textContent = "running"; $("srv").className = "ok"; ws.close(); };
  ws.onerror = () => {
    $("srv").className = "bad";
    $("srv").innerHTML = 'not running · <a id="setupLink">set it up</a>';
    $("setupLink").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  };
} catch {}

refresh();
