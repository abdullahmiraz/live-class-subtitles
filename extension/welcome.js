// Welcome page: show the companion install steps for this computer's OS, copy buttons, live companion status.
const $ = (id) => document.getElementById(id);
const { server = "ws://127.0.0.1:8765" } = await chrome.storage.sync.get("server");

const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "").toLowerCase();
const os = /win/.test(platform) ? "windows" : /mac/.test(platform) ? "mac" : /cros|chrome os/.test(platform) ? "cros" : "linux";
const show = (which) => document.querySelectorAll(".os").forEach((el) => el.classList.toggle("on", which === "all" || el.dataset.os === which));
show(os);
$("otherOs").onclick = () => { show("all"); $("otherOs").remove(); };

document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
  await navigator.clipboard.writeText($(b.dataset.copy).textContent);
  b.textContent = "Copied ✓";
  setTimeout(() => (b.textContent = "Copy"), 1500);
}));

const cmd = (await chrome.commands.getAll()).find((c) => c.name === "toggle-capture");
if (cmd && cmd.shortcut) $("key").textContent = cmd.shortcut;

function check() {
  const ws = new WebSocket(server + "/ping");
  ws.onopen = () => { $("status").textContent = "✓ running"; $("status").className = "ok"; ws.close(); };
  ws.onerror = () => {
    $("status").textContent = "not installed / not running (optional; this updates by itself)";
    $("status").className = "hint";
    setTimeout(check, 4000);
  };
}
check();
