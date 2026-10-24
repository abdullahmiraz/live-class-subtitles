// Offscreen document: captures the tab (or a microphone), keeps it audible, runs the speech engine, and
// (optional) records the audio (MP3 or WebM) while a class is being recorded.
// Speech engines (settings.speech): "chrome" (default) / "device" = Chrome's built-in recognition, nothing to
// install (chrome-speech.js); "companion" = 16 kHz PCM over a WebSocket to the local GigaAM server.
import { addWebmDuration } from "./webm-duration.js";
import { ChromeSpeech } from "./chrome-speech.js";
let media, playCtx, playGain, capCtx, ws, settings, tabId, reconnectTimer, wsOpenedAt = 0, stopped = true;
let recorder = null, recChunks = [], recWanted = false, recStartedAt = 0, recFormat = "mp3";
let mp3 = null; // { ctx, node, enc } while recording MP3
let recStarting = false; // guards the async MP3 setup against a second start (race → doubled audio)
let flushWaiter = null; // resolves when the server says every pending sentence was sent ("done")
let speech = null; // ChromeSpeech while the built-in engine runs
const useCompanion = () => settings.speech === "companion";

const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m }).catch(() => {});

function connect() {
  clearTimeout(reconnectTimer);
  const url = `${settings.server}/tab?engine=${encodeURIComponent(settings.engine)}&target=${encodeURIComponent(settings.target || "en")}&hide_en=${settings.hideEn ? 1 : 0}&learn=${settings.learn ? 1 : 0}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.binaryType = "arraybuffer";
  sock.onopen = () => {
    sock.openedAt = wsOpenedAt = Date.now(); // server start/end = seconds of audio since this moment
    send({ type: "conn", ok: true });
  };
  sock.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "partial") send({ type: "sub", kind: "partial", ru: d.ru, en: d.en, align: d.align });
    else if (d.type === "final")
      send({
        type: "sub", kind: "final", ru: d.ru, en: d.en, lang: d.lang, engine: d.engine, align: d.align, words: d.words,
        start: sock.openedAt + d.start * 1000, end: sock.openedAt + d.end * 1000,
      });
    else if (d.type === "done" && flushWaiter) flushWaiter();
  };
  sock.onclose = () => {
    if (flushWaiter) flushWaiter();
    if (stopped || sock.intentional) return; // intentional = settings change, reconnected already
    send({ type: "conn", ok: false });
    reconnectTimer = setTimeout(connect, 2000); // server not running yet / restarted
  };
}

/** Ask the server to finish the sentence in progress and wait until its final arrived (max 8 s). */
function flush() {
  if (speech) return speech.flush().then(() => true);
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t = setTimeout(() => { flushWaiter = null; resolve(false); }, 8000);
    flushWaiter = () => { clearTimeout(t); flushWaiter = null; resolve(true); };
    ws.send("flush");
  });
}

async function start(streamId) {
  stopped = false;
  if (settings.audioSource === "mic") {
    // in-person class / desktop app: listen to a microphone instead of the tab (not played back: no echo)
    media = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: settings.micId ? { exact: settings.micId } : undefined, echoCancellation: true, noiseSuppression: true },
    });
  } else {
    media = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    });
    // 1) capturing mutes the tab, so play it back to the speakers (through a gain node for "duck while reading aloud")
    playCtx = new AudioContext();
    playGain = playCtx.createGain();
    playCtx.createMediaStreamSource(media).connect(playGain).connect(playCtx.destination);
  }
  media.getAudioTracks()[0].onended = () => send({ type: "ended" });
  await startEngine();
  if (recWanted) startRecording(recFormat); // "record" was asked for before capture was ready
}

async function startEngine() {
  if (!useCompanion()) {
    speech = new ChromeSpeech(() => settings, send);
    speech.start(media.getAudioTracks()[0]);
    return;
  }
  // companion: a separate 16 kHz context for recognition (Chrome does the resampling)
  capCtx = new AudioContext({ sampleRate: 16000 });
  await capCtx.audioWorklet.addModule("pcm-worklet.js");
  const node = new AudioWorkletNode(capCtx, "pcm-worklet");
  capCtx.createMediaStreamSource(media).connect(node);
  node.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  connect();
}

/** Switch engines while running (settings change): finish the current sentence first. */
async function restartEngine() {
  await flush();
  if (speech) { speech.stop(); speech = null; }
  clearTimeout(reconnectTimer);
  if (ws) { ws.intentional = true; try { ws.close(); } catch {} ws = null; }
  if (capCtx) { capCtx.close(); capCtx = null; }
  await startEngine();
}

// ---------- audio recording ----------
let lameLoaded;
const loadLame = () => (lameLoaded ||= new Promise((resolve, reject) => {
  const el = Object.assign(document.createElement("script"), { src: "vendor/lame.min.js", onload: resolve, onerror: reject });
  document.head.append(el);
}));

async function startRecording(format = "mp3") {
  recWanted = true;
  recFormat = format;
  if (!media || recorder || mp3 || recStarting) return;
  recChunks = [];
  recStartedAt = Date.now();
  if (format === "mp3") {
    recStarting = true;
    // MP3 plays on any device. Chrome can't encode it, so LAME (vendor/lame.min.js) does,
    // from a 24 kHz mono copy of the tab audio: ~22 MB/hour, plenty for voice, light on CPU.
    try { await loadLame(); } catch (e) { recStarting = false; throw e; } // 150 KB, loaded only for MP3
    const ctx = new AudioContext({ sampleRate: 24000 });
    await ctx.audioWorklet.addModule("pcm-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-worklet");
    ctx.createMediaStreamSource(media).connect(node);
    const enc = new lamejs.Mp3Encoder(1, ctx.sampleRate, 48);
    node.port.onmessage = (e) => {
      const out = enc.encodeBuffer(new Int16Array(e.data));
      if (out.length) recChunks.push(out);
    };
    mp3 = { ctx, node, enc };
    recStarting = false;
    if (!recWanted) stopRecording(); // stop was requested while we were still setting up
    return;
  }
  // the full-quality tab stream (not the 16 kHz recognition copy); Opus 32 kb/s ≈ 15 MB per hour
  recorder = new MediaRecorder(media, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
  recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
  recorder.start(10000); // a chunk every 10 s
}

async function webmResult() {
  const chunks = recChunks;
  recChunks = [];
  if (!chunks.length) return null;
  // Chrome leaves out the length: patch it into the header so players can show it and seek
  const first = addWebmDuration(new Uint8Array(await chunks[0].arrayBuffer()), Date.now() - recStartedAt);
  const blob = new Blob([first, ...chunks.slice(1)], { type: "audio/webm" });
  return { url: URL.createObjectURL(blob), bytes: blob.size, ext: "webm" };
}

/** Stops the recorder; resolves to {url, bytes, ext} (a blob: URL the background downloads) or null. Never hangs. */
function stopRecording() {
  recWanted = false;
  if (mp3) {
    const { ctx, node, enc } = mp3;
    mp3 = null;
    node.port.onmessage = null;
    ctx.close();
    recChunks.push(enc.flush());
    const blob = new Blob(recChunks, { type: "audio/mpeg" });
    recChunks = [];
    return Promise.resolve(blob.size > 1000 ? { url: URL.createObjectURL(blob), bytes: blob.size, ext: "mp3" } : null);
  }
  const r = recorder;
  recorder = null;
  if (!r) return Promise.resolve(null);
  // the recorder stops by itself when the tab's track ends (tab closed): its "stop" already fired
  if (r.state === "inactive") return webmResult();
  return new Promise((resolve) => {
    r.addEventListener("stop", () => webmResult().then(resolve, () => resolve(null)), { once: true });
    try { r.stop(); } catch { webmResult().then(resolve, () => resolve(null)); }
  });
}

function stop() {
  stopped = true;
  if (speech) { speech.stop(); speech = null; }
  if (recorder) { recorder.ondataavailable = null; try { recorder.stop(); } catch {} recorder = null; } // background saves first; safety net
  if (mp3) { mp3.ctx.close(); mp3 = null; }
  clearTimeout(reconnectTimer);
  try { ws && ws.close(); } catch {}
  media && media.getTracks().forEach((t) => t.stop());
  playCtx && playCtx.close();
  capCtx && capCtx.close();
  media = playCtx = playGain = capCtx = ws = null;
}

// Every message gets a reply, even on errors, so the background never waits forever.
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target !== "offscreen") return;
  const done = (p) => { Promise.resolve(p).then(reply, () => reply(null)); return true; };
  try {
    switch (msg.type) {
      case "start":
        settings = msg.settings;
        tabId = msg.tabId;
        start(msg.streamId).catch((e) => send({ type: "sub", kind: "error", ru: "",
          en: settings.audioSource === "mic" && /Permission|NotAllowed|NotFound/i.test(e.name + e.message)
            ? "Microphone not available: popup → Advanced → set up microphone"
            : `Capture failed: ${e.message}` }));
        break;
      case "stop": stop(); break;
      case "flush": return done(flush());
      case "rec-start": startRecording(msg.format); break;
      case "rec-stop": return done(stopRecording());
      case "make-blob": // big transcripts: a blob: URL works where a data: URL would hit Chrome's URL size limit
        return done({ url: URL.createObjectURL(new Blob([msg.text], { type: msg.mime + ";charset=utf-8" })) });
      case "rec-free": URL.revokeObjectURL(msg.url); break;
      case "duck": // read-aloud is speaking: lower the class audio a little, then restore it smoothly
        if (playGain) playGain.gain.setTargetAtTime(msg.on ? 0.35 : 1, playCtx.currentTime, 0.15);
        break;
      case "settings": {
        const changed = (k) => k in msg.settings && msg.settings[k] !== settings[k];
        const switchEngine = settings && changed("speech");
        const reconnect = settings && (changed("engine") || changed("target") || changed("hideEn") || changed("learn"));
        settings = { ...settings, ...msg.settings };
        if (switchEngine && media && !stopped) restartEngine(); // the built-in engine reads settings live
        else if (reconnect && ws && !stopped) {
          // finish the current sentence on the old connection, then switch right away (no "offline" flash)
          const old = ws;
          old.intentional = true;
          if (old.readyState === WebSocket.OPEN) old.send("flush");
          setTimeout(() => { try { old.close(); } catch {} }, 4000);
          connect();
        }
        break;
      }
    }
  } catch (e) {
    console.warn(e);
    reply(null);
    return;
  }
  reply(true);
});
