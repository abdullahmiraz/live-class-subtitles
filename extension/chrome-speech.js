// Speech engine that needs no install: Chrome's built-in speech recognition (Web Speech API) listening to the
// captured tab/microphone track (Chrome 135+: recognition.start(track)). Online by default (Google's speech
// service, through Chrome); with "on this computer" Chrome's downloadable Russian pack runs offline.
// Emits the same "sub" messages as the companion server path, so the overlay and saving don't care which runs.
import { looksEnglish, translateChain, translateForLearning, wordForms } from "./translate.js";

const PARTIAL_TRANSLATE_EVERY = 1500; // ms between online translations of live text (don't spam the endpoints)
const FATAL = new Set(["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);

export class ChromeSpeech {
  /** @param {() => object} getSettings  @param {(msg: object) => void} send */
  constructor(getSettings, send) {
    this.settings = getSettings;
    this.send = send;
    this.sr = null;
    this.track = null;
    this.running = false;
    this.chain = Promise.resolve(); // finals are translated and sent in order
    this.segStart = 0;
    this.interim = "";
    this.partial = { src: "", en: "", align: [], lastTr: 0, busy: false, gen: 0 };
    this.restarts = [];
  }

  start(track) {
    this.track = track;
    this.running = true;
    this._listen();
  }

  stop() {
    this.running = false;
    try { this.sr && this.sr.abort(); } catch {}
    this.sr = null;
  }

  _listen() {
    if (!this.running || !this.track || this.track.readyState !== "live") return;
    const s = this.settings();
    const sr = new webkitSpeechRecognition();
    sr.lang = "ru-RU";
    sr.continuous = true;
    sr.interimResults = true;
    if (s.speech === "device") sr.processLocally = true; // Chrome's offline Russian pack (popup installs it)
    sr.onstart = () => this.send({ type: "conn", ok: true });
    sr.onresult = (e) => this._onResult(e);
    sr.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // silence: just keep listening
      console.warn("speech:", e.error, e.message);
      if (FATAL.has(e.error)) {
        this.running = false;
        this.send({ type: "sub", kind: "error", ru: "", en: s.speech === "device"
          ? "On-device Russian isn't ready: popup → Advanced → Speech recognition"
          : `Speech recognition unavailable (${e.error})` });
      } else this.send({ type: "conn", ok: false }); // "network": no internet / service hiccup
    };
    sr.onend = () => {
      // Chrome ends a session now and then (silence, network, time limit): start a new one, but not in a tight loop
      if (sr !== this.sr || !this.running) return;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 10000).concat(now);
      setTimeout(() => this._listen(), this.restarts.length > 5 ? 3000 : 100);
    };
    this.sr = sr;
    try {
      sr.start(this.track);
    } catch (e) {
      this.send({ type: "sub", kind: "error", ru: "", en: `Speech recognition failed: ${e.message}` });
    }
  }

  _onResult(e) {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript;
      if (e.results[i].isFinal) this._final(text);
      else interim += text;
    }
    interim = interim.trim();
    if (interim && !this.segStart) this.segStart = Date.now();
    this.interim = interim;
    if (interim) this._partial(interim);
  }

  /** Finish the sentence being spoken now (before saving) and wait until every final was sent. */
  async flush() {
    if (this.interim) {
      const text = this.interim;
      this.interim = "";
      try { this.sr && this.sr.abort(); } catch {} // drop Chrome's copy of it; onend starts a fresh session
      this._final(text);
    }
    await this.chain;
  }

  _partial(ru) {
    const p = this.partial;
    const s = this.settings();
    // the newest Russian with the last translation (its colors only if it still belongs to this text)
    this.send({ type: "sub", kind: "partial", ru, en: p.en, align: ru.startsWith(p.src) ? p.align : [] });
    if (p.busy || Date.now() - p.lastTr < PARTIAL_TRANSLATE_EVERY || looksEnglish(ru)) return;
    p.busy = true;
    p.lastTr = Date.now();
    const gen = p.gen;
    const tl = s.target || "en";
    const job = s.learn ? translateForLearning(s.engine, ru, tl) : translateChain(s.engine, ru, tl);
    job.then(([en, , align = []]) => {
      if (gen !== p.gen || !en) return; // the sentence ended meanwhile
      Object.assign(p, { src: ru, en, align });
      if (this.interim) this.send({ type: "sub", kind: "partial", ru: this.interim, en, align: this.interim.startsWith(ru) ? align : [] });
    }).catch(() => {}).finally(() => { p.busy = false; });
  }

  _final(raw) {
    const text = raw.trim();
    const start = this.segStart || Date.now();
    const end = Date.now();
    this.segStart = 0;
    this.interim = "";
    this.partial.gen++;
    Object.assign(this.partial, { src: "", en: "", align: [] });
    if (!/\p{L}/u.test(text)) return;
    const ru = text[0].toUpperCase() + text.slice(1); // Chrome's Russian has no capitals/punctuation at the start
    this.chain = this.chain.then(() => this._sendFinal(ru, start, end)).catch((e) => console.warn("final:", e));
  }

  async _sendFinal(ru, start, end) {
    const s = this.settings();
    const tl = s.target || "en";
    if (looksEnglish(ru)) { // spoken in English: keep what was said (translated if the subtitles aren't English)
      if (s.hideEn) return this.send({ type: "sub", kind: "partial", ru: "", en: "" });
      let en = ru, said = "", engine = "chrome";
      if (tl !== "en") {
        const [out, used] = await translateChain(s.engine, ru, tl, "en");
        if (out) [en, said, engine] = [out, ru, `chrome+${used}`];
      }
      return this.send({ type: "sub", kind: "final", ru: said, en, lang: "en", engine, align: [], start, end });
    }
    const [en, used, align] = s.learn ? await translateForLearning(s.engine, ru, tl) : [...(await translateChain(s.engine, ru, tl)), []];
    this.send({ type: "sub", kind: "final", ru, en: en || "…", lang: "ru", engine: used, align, words: s.learn ? wordForms(ru) : [], start, end });
  }
}
