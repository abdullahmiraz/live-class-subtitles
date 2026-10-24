// Setup page: copy the install command and show whether the companion server is reachable.
const $ = (id) => document.getElementById(id);
const { server = "ws://127.0.0.1:8765" } = await chrome.storage.sync.get("server");

$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("cmd").textContent);
  $("copy").textContent = "Copied ✓";
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
};

const cmd = (await chrome.commands.getAll()).find((c) => c.name === "toggle-capture");
if (cmd && cmd.shortcut) $("key").textContent = cmd.shortcut;

function check() {
  const ws = new WebSocket(server + "/ping");
  ws.onopen = () => { $("status").textContent = "✓ running, you're all set"; $("status").className = "ok"; ws.close(); };
  ws.onerror = () => {
    $("status").textContent = "not running yet (this updates by itself)";
    $("status").className = "bad";
    setTimeout(check, 3000);
  };
}
check();
