const DEFAULTS = { server: "ws://127.0.0.1:8765", engine: "auto", showRu: true, hideEn: false, fontSize: 26, lines: 2 };
const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage({ target: "background", ...m });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };

$("engine").value = settings.engine;
if (!$("engine").value) $("engine").value = settings.engine = "auto"; // e.g. removed "argos" option
$("fontSize").value = settings.fontSize;
$("lines").value = settings.lines;
$("showRu").checked = settings.showRu;
$("hideEn").checked = settings.hideEn;

async function refresh() {
  const cur = await bg({ type: "status" });
  const on = cur && cur.tabId === tab.id;
  $("toggle").textContent = on ? "Stop" : cur ? "Move to this tab" : "Start on this tab";
  $("toggle").classList.toggle("on", on);
}

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

for (const id of ["engine", "fontSize", "lines", "showRu", "hideEn"]) {
  $(id).onchange = async () => {
    settings[id] = $(id).type === "checkbox" ? $(id).checked : id === "engine" ? $(id).value : Number($(id).value);
    await chrome.storage.sync.set({ [id]: settings[id] });
    bg({ type: "settings", settings });
  };
}

// is the local server running?
try {
  const ws = new WebSocket(settings.server + "/ping");
  ws.onopen = () => { $("srv").textContent = "running"; $("srv").className = "ok"; ws.close(); };
  ws.onerror = () => { $("srv").textContent = "not running — start it with start.sh"; $("srv").className = "bad"; };
} catch {}

refresh();
