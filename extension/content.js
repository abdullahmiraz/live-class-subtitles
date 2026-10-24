// Subtitle overlay (shadow DOM, so page CSS can't break it).
//
// Layout, top → bottom (newest at the bottom, like Meet/Teams captions and chat):
//   header   drag handle · status · A− A+ · compact/expand · hide
//   history  finished sentences, scrollable; latest one highlighted, older ones fade
//            auto-follows the newest line unless you scrolled up → "↓ N new" button
//   live     the sentence being spoken right now (rough, italic, pulsing LIVE tag)
//   grip     resize from the bottom-right corner (min 320 × 120 px)
(() => {
  // One live instance per page. After the extension is reloaded, the old script is orphaned
  // (chrome.runtime.id becomes undefined) but its box stays on screen: clean that up.
  const prev = window.__ruenSubs;
  if (prev && prev.alive()) return;
  document.querySelectorAll("#ruen-live-subs").forEach((el) => el.remove());
  window.__ruenSubs = { alive: () => !!(chrome.runtime && chrome.runtime.id) };
  const watchdog = setInterval(() => {
    if (chrome.runtime && chrome.runtime.id) return;
    clearInterval(watchdog);
    host && host.remove(); // extension reloaded/removed: never leave a frozen box behind
  }, 2000);

  const MIN_W = 320, MIN_H = 120, MAX_HISTORY = 300;
  let host, root, box, histEl, liveEn, liveRu, liveWrap, statusEl, newBtn;
  let settings = { showRu: true, fontSize: 22, bgOpacity: 0.88 };
  let ui = { compact: false, w: null, h: null, left: null, top: null }; // per-site, chrome.storage.local
  let live = false, saving = null, savedTimer, hideTimer, unseen = 0, stick = true, startedAt = null;
  const KEY = "ui:" + location.host;

  const CSS = `
    :host { all: initial; }
    .box { position: relative; display: flex; flex-direction: column; box-sizing: border-box;
      width: 100%; height: 100%; min-width: ${MIN_W}px;
      font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #fff; line-height: 1.32;
      background: rgba(14, 16, 20, var(--bg-a, .88)); border: 1px solid rgba(255,255,255,.08); border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0, calc(var(--bg-a, .88) * .5)); backdrop-filter: var(--blur, blur(6px)); overflow: hidden;
      transition: opacity .25s ease, transform .25s ease, background-color .2s; }
    .box.enter { opacity: 0; transform: translateY(10px) scale(.985); }
    .head { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 12px; cursor: move;
      font-size: 12px; color: #bbb; background: rgba(255,255,255,.05); user-select: none; flex: none; text-shadow: 0 1px 2px #000; }
    .st { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn { all: unset; cursor: pointer; padding: 2px 7px; border-radius: 6px; color: #ddd; font-size: 12px; line-height: 18px; }
    .btn { transition: background .15s, color .15s; }
    .btn:hover { background: rgba(255,255,255,.14); color: #fff; }
    .hist { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 12px 2px; scroll-behavior: smooth; overscroll-behavior: contain;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }
    .hist > :first-child { margin-top: auto; } /* anchor to the bottom; still scrolls normally */
    .empty { color: #888; font-size: .7em; padding: 10px 0; text-align: center; }
    .item { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; padding: 6px 0 6px 10px;
      border-bottom: 1px solid rgba(255,255,255,.06); opacity: .58; border-left: 3px solid transparent; margin-left: -10px;
      transition: opacity .7s ease, border-color .5s ease; animation: rise .32s cubic-bezier(.2,.7,.3,1); }
    .item.latest { opacity: 1; border-left-color: #4c8dff; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    .item:hover { opacity: .95; }
    .t { font-size: .55em; color: #8a93a6; padding-top: .45em; font-variant-numeric: tabular-nums; }
    .en { font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,.95), 0 0 2px #000; user-select: text; }
    .ru { font-size: .68em; color: #c3cad6; margin-top: 2px; user-select: text; text-shadow: 0 1px 2px #000; }
    .ru.said-en { font-style: italic; color: #9fb4d8; }
    .live { flex: none; padding: 6px 12px 9px; border-top: 1px dashed rgba(255,255,255,.18); background: rgba(76,141,255,.06); }
    .live .tag { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; letter-spacing: .08em;
      color: #ff6b6b; margin-bottom: 2px; }
    .live .dot { width: 7px; height: 7px; border-radius: 50%; background: #ff4d4d; animation: pulse 1.2s infinite; }
    .live .en { font-style: italic; font-weight: 500; opacity: .8; min-height: 1.32em; transition: color .3s, opacity .3s; }
    .live .ru { opacity: .75; min-height: 1.1em; }
    .live .dot, .live .tag { transition: background .3s, color .3s; }
    .live.idle .en { color: #777; font-weight: 400; }
    .live.idle .dot { animation: none; background: #666; }
    .live.idle .tag { color: #888; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
    .newbtn { position: absolute; left: 50%; transform: translateX(-50%); bottom: 72px; display: none;
      cursor: pointer; background: #4c8dff; color: #fff; font: 600 12px system-ui, sans-serif;
      padding: 4px 12px; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,.4); border: 0; animation: rise .25s ease-out; }
    .pill { display: none; cursor: pointer; border: 0; border-radius: 16px; padding: 6px 12px; font: 700 12px system-ui, sans-serif;
      color: #fff; background: rgba(14,16,20,.85); box-shadow: 0 4px 16px rgba(0,0,0,.4); animation: rise .25s ease-out; }
    .pill .d { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #ff4d4d; margin-right: 6px; }
    /* learning mode: matching colors for a Russian word and its English translation */
    .w { color: var(--c); border-radius: 3px; transition: background .15s, box-shadow .15s; }
    .ru .w { text-decoration: underline 1px; text-decoration-color: color-mix(in srgb, var(--c) 55%, transparent); text-underline-offset: 3px; }
    .w.hl { background: color-mix(in srgb, var(--c) 28%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 28%, transparent); }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
    .grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%, rgba(255,255,255,.35) 60%, transparent 60%,
        transparent 70%, rgba(255,255,255,.35) 70%, rgba(255,255,255,.35) 80%, transparent 80%); }
    /* compact: only the latest finished sentence + live line, like a classic caption bar */
    .box.compact .hist { flex: none; overflow: hidden; }
    .box.compact .item:not(.latest) { display: none; }
    .box.compact .t { display: none; }
    .box.compact .item { grid-template-columns: 1fr; border-bottom: 0; }
    .box.compact .grip { display: none; }
    .hide-ru .ru { display: none; }
  `;

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "ruen-live-subs";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="box">
        <div class="head" title="Drag to move">
          <span class="st">connecting…</span>
          <button class="btn" data-a="smaller" title="Smaller text">A−</button>
          <button class="btn" data-a="bigger" title="Bigger text">A+</button>
          <button class="btn" data-a="compact" title="Compact / show history">▾</button>
          <button class="btn" data-a="hide" title="Hide (subtitles keep running; reopen from the extension)">✕</button>
        </div>
        <div class="hist"><div class="empty">Newest sentences appear at the bottom ↓</div></div>
        <div class="live idle"><div class="tag"><span class="dot"></span>LIVE</div><div class="en">listening…</div><div class="ru"></div></div>
        <button class="newbtn">↓ new</button>
        <div class="grip" title="Drag to resize"></div>
      </div>
      <button class="pill" title="Show subtitles"><span class="d"></span>CC</button>`;
    box = root.querySelector(".box");
    histEl = root.querySelector(".hist");
    liveWrap = root.querySelector(".live");
    liveEn = liveWrap.querySelector(".en");
    liveRu = liveWrap.querySelector(".ru");
    statusEl = root.querySelector(".st");
    newBtn = root.querySelector(".newbtn");
    root.querySelector(".pill").onclick = () => setHidden(false);
    // hover a word -> highlight its translation in the same sentence
    histEl.addEventListener("mouseover", (e) => {
      const w = e.target.closest(".w");
      histEl.querySelectorAll(".w.hl").forEach((x) => x.classList.remove("hl"));
      if (w) w.closest(".item").querySelectorAll(`.w[data-k="${w.dataset.k}"]`).forEach((x) => x.classList.add("hl"));
    });
    histEl.addEventListener("mouseleave", () => histEl.querySelectorAll(".w.hl").forEach((x) => x.classList.remove("hl")));

    root.querySelectorAll(".btn").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); action(b.dataset.a); }));
    newBtn.onclick = () => { stick = true; scrollToEnd(); };
    histEl.addEventListener("scroll", () => {
      const atEnd = histEl.scrollHeight - histEl.scrollTop - histEl.clientHeight < 24;
      stick = atEnd;
      if (atEnd) { unseen = 0; newBtn.style.display = "none"; }
    });
    dragMove(root.querySelector(".head"));
    dragResize(root.querySelector(".grip"));
    chrome.storage.local.get(KEY).then((r) => { ui = { ...ui, ...(r[KEY] || {}) }; layout(); });
    layout();
    apply();
    mount();
    showStatus();
    box.classList.add("enter");
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove("enter")));
  }

  // ✕ shrinks the box to a small "CC" pill (subtitles keep running); click the pill to bring it back
  function setHidden(hidden) {
    const pill = root.querySelector(".pill");
    if (hidden) {
      box.classList.add("enter");
      setTimeout(() => { box.style.display = "none"; pill.style.display = "block"; host.style.height = "auto"; host.style.width = "auto"; }, 220);
    } else {
      pill.style.display = "none";
      box.style.display = "";
      layout();
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove("enter")));
    }
    ui.hidden = hidden;
  }

  // ---------- geometry ----------
  function layout() {
    if (!host || box.style.display === "none") return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(ui.w || Math.min(760, vw * 0.7), vw - 16));
    box.classList.toggle("compact", !!ui.compact);
    const cb = root.querySelector('[data-a="compact"]');
    cb.textContent = ui.compact ? "▴" : "▾";
    cb.title = ui.compact ? "Show history" : "Compact (latest line only)";
    host.style.width = w + "px";
    host.style.height = ui.compact ? "auto" : Math.max(MIN_H, Math.min(ui.h || 260, vh - 16)) + "px";
    const hgt = host.getBoundingClientRect().height || 200;
    const left = ui.left ?? (vw - w) / 2;
    const top = ui.top ?? vh - hgt - vh * 0.06;
    // always keep the whole box on screen (e.g. a position remembered from a bigger window)
    host.style.left = Math.max(0, Math.min(left, vw - w)) + "px";
    host.style.top = Math.max(0, Math.min(top, vh - hgt)) + "px";
    if (stick) scrollToEnd(true);
  }
  const saveUi = () => chrome.storage.local.set({ [KEY]: ui });
  window.addEventListener("resize", () => host && layout());

  function dragMove(handle) {
    let sx, sy, ox, oy;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".btn")) return;
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (sx === undefined) return;
      ui.left = ox + e.clientX - sx; ui.top = oy + e.clientY - sy;
      host.style.left = ui.left + "px"; host.style.top = ui.top + "px";
    });
    handle.addEventListener("pointerup", () => { if (sx !== undefined) { sx = undefined; saveUi(); } });
  }

  function dragResize(grip) {
    let sx, sy, ow, oh;
    grip.addEventListener("pointerdown", (e) => {
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ow = r.width; oh = r.height;
      grip.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    grip.addEventListener("pointermove", (e) => {
      if (sx === undefined) return;
      ui.w = Math.max(MIN_W, ow + e.clientX - sx);
      ui.h = Math.max(MIN_H, oh + e.clientY - sy);
      host.style.width = ui.w + "px"; host.style.height = ui.h + "px";
    });
    grip.addEventListener("pointerup", () => { if (sx !== undefined) { sx = undefined; saveUi(); if (stick) scrollToEnd(true); } });
  }

  // keep the box visible in fullscreen video
  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", () => host && (mount(), layout()));

  // ---------- controls ----------
  function action(a) {
    if (a === "hide") setHidden(true);
    else if (a === "compact") { ui.compact = !ui.compact; saveUi(); layout(); }
    else if (a === "bigger" || a === "smaller") {
      settings.fontSize = Math.max(12, Math.min(48, settings.fontSize + (a === "bigger" ? 2 : -2)));
      chrome.storage.sync.set({ fontSize: settings.fontSize });
      apply();
    }
  }

  function apply() {
    if (!box) return;
    box.style.fontSize = settings.fontSize + "px";
    const a = Math.max(0.15, Math.min(1, settings.bgOpacity ?? 0.88));
    box.style.setProperty("--bg-a", a);
    box.style.setProperty("--blur", a >= 0.75 ? "blur(6px)" : "none"); // see-through means really see-through
    box.classList.toggle("hide-ru", !settings.showRu);
    if (stick) scrollToEnd(true);
  }

  function showStatus() {
    if (!statusEl) return;
    statusEl.textContent = (live ? "● live" : "server offline — run start.sh") + (saving !== null ? `  ·  ⏺ saving (${saving})` : "");
    statusEl.style.color = live ? "#8fe58f" : "#ff8f8f";
  }

  function scrollToEnd(instant) {
    if (!histEl) return;
    if (instant) { histEl.style.scrollBehavior = "auto"; histEl.scrollTop = histEl.scrollHeight; histEl.style.scrollBehavior = ""; }
    else histEl.scrollTop = histEl.scrollHeight;
    unseen = 0;
    if (newBtn) newBtn.style.display = "none";
  }

  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  function addFinal(m) {
    const empty = histEl.querySelector(".empty");
    if (empty) empty.remove();
    histEl.querySelectorAll(".item.latest").forEach((el) => el.classList.remove("latest"));
    const spokenAt = m.start || Date.now(); // when it was said (audio clock), not when it arrived
    startedAt = startedAt || spokenAt;
    const it = document.createElement("div");
    it.className = "item latest";
    it.innerHTML = `<div class="t"></div><div><div class="en"></div><div class="ru"></div></div>`;
    it.querySelector(".t").textContent = fmt(spokenAt - startedAt);
    const ru = it.querySelector(".ru");
    if (m.lang === "en") { it.querySelector(".en").textContent = m.en; ru.textContent = "spoken in English"; ru.classList.add("said-en"); }
    else colorize(it.querySelector(".en"), ru, m);
    histEl.appendChild(it);
    while (histEl.children.length > MAX_HISTORY) histEl.firstElementChild.remove();
    setLive("", "");
    if (stick || ui.compact) scrollToEnd();
    else { unseen++; newBtn.textContent = `↓ ${unseen} new`; newBtn.style.display = "block"; }
  }

  // ---------- learning mode: same color for a Russian word and its translation ----------
  const PALETTE = ["#ffd166", "#7bdff2", "#f4978e", "#b8f2a6", "#cdb4db", "#ffb4a2", "#90caf9", "#f6bd60", "#a0e7c3", "#f7a8d8"];
  const STOP_EN = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "of", "to", "in", "on", "at", "it", "and", "or", "there", "that", "this", "by", "for", "with", "as"]);

  /** m.align = [[ruStart, ruLen, enStart, enLen], ...] (character offsets from Yandex). */
  function colorize(enEl, ruEl, m) {
    const pairs = [];
    const takenRu = [], takenEn = [];
    const free = (taken, a, b) => taken.every(([x, y]) => b <= x || a >= y);
    for (const [rs, rl, es, el] of m.align || []) {
      if (rl >= m.ru.length * 0.6 || el >= m.en.length * 0.6) continue; // whole-sentence span
      const ruW = m.ru.substr(rs, rl), enW = m.en.substr(es, el);
      if (ruW.trim().length <= 2 && rl <= 2) continue; // tiny function words (в, на, и…)
      if (STOP_EN.has(enW.trim().toLowerCase())) continue;
      if (!free(takenRu, rs, rs + rl) || !free(takenEn, es, es + el)) continue;
      takenRu.push([rs, rs + rl]); takenEn.push([es, es + el]);
      pairs.push({ rs, rl, es, el, k: pairs.length });
    }
    paint(ruEl, m.ru, pairs.map((p) => [p.rs, p.rl, p.k]));
    paint(enEl, m.en, pairs.map((p) => [p.es, p.el, p.k]));
  }

  function paint(el, text, ranges) {
    el.textContent = "";
    ranges.sort((a, b) => a[0] - b[0]);
    let i = 0;
    for (const [s, len, k] of ranges) {
      if (s > i) el.append(text.slice(i, s));
      const span = document.createElement("span");
      span.className = "w";
      span.dataset.k = k;
      span.style.setProperty("--c", PALETTE[k % PALETTE.length]);
      span.textContent = text.substr(s, len);
      el.append(span);
      i = s + len;
    }
    if (i < text.length) el.append(text.slice(i));
  }

  function setLive(en, ru, align) {
    liveWrap.classList.toggle("idle", !en && !ru);
    if (en && ru && align && align.length) colorize(liveEn, liveRu, { en, ru, align });
    else {
      liveEn.textContent = en || (ru ? "…" : "listening…");
      liveRu.textContent = ru || "";
    }
  }

  // ---------- messages from the extension ----------
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m.type === "ping") return reply(true); // background checks the script is present
    if (m.type === "overlay-show") {
      if (typeof m.conn === "boolean") live = m.conn;
      clearTimeout(hideTimer); // restarted right after a save
      settings = { ...settings, ...m.settings };
      build();
      host.style.display = "";
      apply();
    } else if (m.type === "overlay-hide") {
      const remove = () => {
        if (box) box.classList.add("enter");
        const h = host;
        setTimeout(() => h && h.remove(), 250);
        host = statusEl = histEl = null;
        live = false; saving = null; startedAt = null; stick = true; unseen = 0;
      };
      // just saved a file? keep the box up a moment so the "saved" notice is readable
      if (statusEl && statusEl.textContent.startsWith("✔")) { setLive("", ""); hideTimer = setTimeout(remove, 5000); }
      else remove();
    } else if (m.type === "overlay-settings") {
      settings = { ...settings, ...m.settings };
      apply();
    } else if (m.type === "conn") {
      build(); live = m.ok; showStatus();
    } else if (m.type === "saving") {
      saving = m.on ? m.count : null;
      if (host) showStatus();
    } else if (m.type === "saved") {
      build();
      statusEl.textContent = `✔ saved ${m.count} sentences → Downloads/${m.filename}`;
      statusEl.style.color = "#8fe58f";
      clearTimeout(savedTimer);
      savedTimer = setTimeout(showStatus, 6000);
    } else if (m.type === "sub") {
      build();
      if (!live && m.kind !== "error") { live = true; showStatus(); } // text is arriving, so we're connected
      if (m.kind === "final") addFinal(m);
      else if (m.kind === "partial") setLive(m.en, m.ru, m.align);
      else if (m.kind === "error") { statusEl.textContent = m.en; statusEl.style.color = "#ff8f8f"; }
    }
  });
})();
