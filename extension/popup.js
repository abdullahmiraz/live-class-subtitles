const DEFAULTS = {
  server: "ws://127.0.0.1:8765", engine: "auto", showRu: true, hideEn: false, fontSize: 26,
  saveMode: "off", saveFormat: "md", saveTranscript: true, saveAudio: false, learn: false, bgOpacity: 0.88,
};
const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage({ target: "background", ...m });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };

$("engine").value = settings.engine;
if (!$("engine").value) $("engine").value = settings.engine = "auto"; // e.g. removed "argos" option
$("fontSize").value = settings.fontSize;
$("showRu").checked = settings.showRu;
$("hideEn").checked = settings.hideEn;
$("saveMode").value = settings.saveMode;
$("saveFormat").value = settings.saveFormat;
$("saveTranscript").checked = settings.saveTranscript;
$("saveAudio").checked = settings.saveAudio;
$("learn").checked = settings.learn;
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
setInterval(refresh, 2000); // live sentence counter while the popup is open

$("toggle").onclick = async () => {
  const cur = await bg({ type: "status" });
  if (cur && cur.tabId === tab.id) await bg({ type: "stop" });
  else {
    // must be called from the popup (user gesture) to get a stream id for this tab
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await bg({ type: "start", tabId: tab.id, streamId });
  }
  refresh();
};

for (const id of ["engine", "fontSize", "showRu", "hideEn", "saveMode", "saveFormat", "saveTranscript", "saveAudio", "learn"]) {
  $(id).onchange = async () => {
    settings[id] = $(id).type === "checkbox" ? $(id).checked : $(id).type === "number" ? Number($(id).value) : $(id).value;
    await chrome.storage.sync.set({ [id]: settings[id] });
    bg({ type: "settings", settings });
    refresh();
  };
}

// background opacity: live preview while dragging the slider
$("bgOpacity").oninput = () => {
  settings.bgOpacity = Number($("bgOpacity").value) / 100;
  $("bgOpacityVal").textContent = $("bgOpacity").value + "%";
  bg({ type: "settings", settings });
};
$("bgOpacity").onchange = () => chrome.storage.sync.set({ bgOpacity: settings.bgOpacity });

// is the local server running?
try {
  const ws = new WebSocket(settings.server + "/ping");
  ws.onopen = () => { $("srv").textContent = "running"; $("srv").className = "ok"; ws.close(); };
  ws.onerror = () => { $("srv").textContent = "not running — start it with start.sh"; $("srv").className = "bad"; };
} catch {}

refresh();
