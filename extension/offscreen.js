// Offscreen document: captures the tab, keeps it audible, streams 16 kHz PCM to the local server.
let media, playCtx, capCtx, ws, settings, tabId, reconnectTimer, wsOpenedAt = 0, stopped = true;

const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m }).catch(() => {});

function connect() {
  clearTimeout(reconnectTimer);
  const url = `${settings.server}/tab?engine=${encodeURIComponent(settings.engine)}&hide_en=${settings.hideEn ? 1 : 0}&learn=${settings.learn ? 1 : 0}`;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    wsOpenedAt = Date.now(); // server start/end = seconds of audio since this moment
    send({ type: "conn", ok: true });
  };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "partial") send({ type: "sub", kind: "partial", ru: d.ru, en: d.en });
    else if (d.type === "final")
      send({
        type: "sub", kind: "final", ru: d.ru, en: d.en, lang: d.lang, engine: d.engine, align: d.align,
        start: wsOpenedAt + d.start * 1000, end: wsOpenedAt + d.end * 1000,
      });
  };
  ws.onclose = () => {
    if (stopped) return;
    send({ type: "conn", ok: false });
    reconnectTimer = setTimeout(connect, 2000); // server not running yet / restarted
  };
}

async function start(streamId) {
  stopped = false;
  media = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  });
  // 1) capturing mutes the tab, so play it back to the speakers
  playCtx = new AudioContext();
  playCtx.createMediaStreamSource(media).connect(playCtx.destination);
  // 2) separate 16 kHz context for recognition (Chrome does the resampling)
  capCtx = new AudioContext({ sampleRate: 16000 });
  await capCtx.audioWorklet.addModule("pcm-worklet.js");
  const node = new AudioWorkletNode(capCtx, "pcm-worklet");
  capCtx.createMediaStreamSource(media).connect(node);
  node.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  media.getAudioTracks()[0].onended = () => send({ type: "ended" });
  connect();
}

function stop() {
  stopped = true;
  clearTimeout(reconnectTimer);
  try { ws && ws.close(); } catch {}
  media && media.getTracks().forEach((t) => t.stop());
  playCtx && playCtx.close();
  capCtx && capCtx.close();
  media = playCtx = capCtx = ws = null;
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start") {
    settings = msg.settings;
    tabId = msg.tabId;
    start(msg.streamId).catch((e) => send({ type: "sub", kind: "error", ru: "", en: `Capture failed: ${e.message}` }));
  } else if (msg.type === "stop") stop();
  else if (msg.type === "settings") {
    const engineChanged = settings && (msg.settings.engine !== settings.engine || msg.settings.hideEn !== settings.hideEn || msg.settings.learn !== settings.learn);
    settings = { ...settings, ...msg.settings };
    if (engineChanged && ws) ws.close(); // reconnects with the new engine / English setting
  }
  reply(true);
});
