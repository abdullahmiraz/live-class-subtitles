// One-time microphone permission for the extension (offscreen documents can't show the permission prompt).
const $ = (id) => document.getElementById(id);
let stream, ctx, raf;

async function listDevices() {
  const { micId = "" } = await chrome.storage.sync.get("micId");
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  $("dev").replaceChildren(...devs.map((d) => new Option(d.label || "Microphone", d.deviceId, false, d.deviceId === micId)));
  $("dev").disabled = !devs.length;
}

async function monitor(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(raf);
  stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  ctx = ctx || new AudioContext();
  const an = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    $("level").value = Math.min(1, Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length) * 6);
    raf = requestAnimationFrame(tick);
  };
  tick();
}

$("allow").onclick = async () => {
  try {
    await monitor("");
    $("state").textContent = "✓ allowed";
    $("state").className = "ok";
    await listDevices();
    await chrome.storage.sync.set({ audioSource: "mic" });
  } catch (e) {
    $("state").textContent = "blocked: " + e.message;
    $("state").className = "bad";
  }
};
$("dev").onchange = async () => {
  await chrome.storage.sync.set({ micId: $("dev").value });
  monitor($("dev").value);
};
// already allowed earlier? show the list straight away
navigator.permissions.query({ name: "microphone" }).then((p) => {
  if (p.state === "granted") $("allow").click();
});
