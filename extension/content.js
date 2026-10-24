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
  document.querySelectorAll("#ruen-live-subs, #ruen-live-captions").forEach((el) => el.remove());
  window.__ruenSubs = { alive: () => !!(chrome.runtime && chrome.runtime.id) };
  const watchdog = setInterval(() => {
    if (chrome.runtime && chrome.runtime.id) return;
    clearInterval(watchdog);
    host && host.remove(); // extension reloaded/removed: never leave a frozen box behind
    capHost && capHost.remove();
    clearInterval(capTimer);
  }, 2000);

  const MIN_W = 320, MIN_H = 120, MAX_HISTORY = 300;
  let host, root, box, histEl, liveEn, liveRu, liveWrap, statusEl, newBtn;
  let settings = { showRu: true, fontSize: 22, bgOpacity: 0.88, display: "panel" };
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
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;overflow:visible;inset:auto;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="box">
        <div class="head" title="Drag to move">
          <span class="st">connecting…</span>
          <button class="btn" data-a="smaller" title="Smaller text">A−</button>
          <button class="btn" data-a="bigger" title="Bigger text">A+</button>
          <button class="btn" data-a="subs" title="Subtitle mode (like YouTube captions)">CC</button>
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
    if (isSubs()) box.style.display = "none"; // subtitle mode: never flash the panel
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
      if (capHost) capHost.style.display = "none";
      if (isSubs()) { box.style.display = "none"; pill.style.display = "block"; host.style.height = host.style.width = "auto"; ui.hidden = true; return; }
      box.classList.add("enter");
      setTimeout(() => { box.style.display = "none"; pill.style.display = "block"; host.style.height = "auto"; host.style.width = "auto"; }, 220);
    } else {
      pill.style.display = "none";
      ui.hidden = false;
      if (isSubs()) { apply(); return; }
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

  // Keep our elements visible in fullscreen. A fullscreen <div> can host them; a fullscreen <video> or
  // <iframe> can't (replaced elements don't render children), so then we use the browser's top layer.
  function fsParent() {
    const fs = document.fullscreenElement;
    return fs && !/^(VIDEO|IFRAME)$/.test(fs.tagName) ? fs : document.documentElement;
  }
  function attach(el) {
    if (!el) return;
    const parent = fsParent();
    if (el.parentNode !== parent) parent.appendChild(el);
    const videoFs = document.fullscreenElement && parent === document.documentElement;
    try {
      if (videoFs) {
        el.popover = "manual"; // only while a <video>/<iframe> is fullscreen: popovers render above it
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } else if (el.hasAttribute("popover")) {
        if (el.matches(":popover-open")) el.hidePopover();
        el.removeAttribute("popover"); // a closed popover is display:none, so drop it outside fullscreen
      }
    } catch {}
  }
  function mount() { attach(host); }
  document.addEventListener("fullscreenchange", () => { if (host) { mount(); layout(); } if (capHost) { attach(capHost); placeCaptions(); } });

  // ---------- controls ----------
  function action(a) {
    if (a === "subs" || a === "panel") {
      settings.display = a === "subs" ? "subtitles" : "panel";
      chrome.storage.sync.set({ display: settings.display });
      apply();
      return;
    }
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
    if (isSubs() && !ui.hidden) {
      box.style.display = "none";
      host.style.width = host.style.height = "0px"; // panel keeps collecting history, invisibly
      buildCaptions();
      capHost.style.display = "";
      renderCaptions();
    } else if (!isSubs()) {
      if (capHost) capHost.style.display = "none";
      if (!ui.hidden && box.style.display === "none") { box.style.display = ""; layout(); }
    }
    box.style.fontSize = settings.fontSize + "px";
    const a = Math.max(0.15, Math.min(1, settings.bgOpacity ?? 0.88));
    box.style.setProperty("--bg-a", a);
    box.style.setProperty("--blur", a >= 0.75 ? "blur(6px)" : "none"); // see-through means really see-through
    box.classList.toggle("hide-ru", !settings.showRu);
    if (stick) scrollToEnd(true);
  }

  function showStatus() {
    renderCapStatus();
    if (!statusEl) return;
    const rec = saving && [saving.audio && "audio", saving.transcript && `${saving.count} lines`].filter(Boolean).join(" + ");
    statusEl.textContent = (live ? "● live" : "server offline — run start.sh") + (saving ? `  ·  ⏺ recording ${rec}` : "");
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
    lastFinal = m; liveCue = null; playFinal(m);
    while (histEl.children.length > MAX_HISTORY) histEl.firstElementChild.remove();
    setLive("", "");
    if (stick || ui.compact) scrollToEnd();
    else { unseen++; newBtn.textContent = `↓ ${unseen} new`; newBtn.style.display = "block"; }
  }

  // ---------- subtitle mode: YouTube-style captions over the video ----------
  let capHost, capRoot, capEl, capTimer, lastFinal = null, liveCue = null, fadeTimer;
  const isSubs = () => settings.display === "subtitles";
  const CAP_CSS = `
    :host { all: initial; }
    .cap { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; cursor: grab;
      font-family: "YouTube Noto", Roboto, "Segoe UI", Arial, sans-serif; color: #fff; line-height: 1.42;
      transition: opacity .35s ease; user-select: none; }
    .cap.gone { opacity: 0; }
    .cue { max-width: 100%; animation: capin .22s ease-out; }
    .cue span.txt { background: rgba(8, 8, 8, var(--bg-a, .75)); padding: .06em .38em; border-radius: 3px;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .cue.prev { opacity: .78; }
    .stat { font: 12px/1.4 system-ui, sans-serif; color: #ddd; background: rgba(8,8,8,.7); padding: 2px 8px; border-radius: 10px;
      align-self: center; margin-bottom: 4px; pointer-events: auto; }
    .stat.bad { color: #ffb0b0; }
    .cue.now .txt { font-weight: 500; }
    .ru { font-size: .66em; color: #e8e2c0; }
    .w { color: var(--c); }
    .ru .w { text-decoration: underline 1px; text-underline-offset: 3px; }
    .bar { position: absolute; left: 50%; transform: translateX(-50%); top: 0; display: flex; gap: 2px; padding: 2px 4px;
      background: rgba(14,16,20,.9); border-radius: 8px; opacity: 0; transition: opacity .2s ease .5s; pointer-events: none; }
    .wrap:has(.cap:hover) .bar, .bar:hover { opacity: 1; pointer-events: auto; transition-delay: 0s; }
    .btn { all: unset; cursor: pointer; padding: 2px 7px; border-radius: 6px; color: #ddd; font: 12px/18px system-ui, sans-serif; }
    .btn:hover { background: rgba(255,255,255,.15); color: #fff; }
    .wrap { position: relative; padding-top: 30px; pointer-events: none; } /* room for the hover toolbar; clicks pass to the video */
    .cap { pointer-events: auto; }
    @keyframes capin { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `;

  function buildCaptions() {
    if (capHost) return;
    capHost = document.createElement("div");
    capHost.id = "ruen-live-captions";
    capHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;overflow:visible;inset:auto;";
    capRoot = capHost.attachShadow({ mode: "open" });
    capRoot.innerHTML = `<style>${CAP_CSS}</style><div class="wrap">
      <div class="bar">
        <button class="btn" data-a="panel" title="Back to the panel (history)">▤ panel</button>
        <button class="btn" data-a="smaller">A−</button><button class="btn" data-a="bigger">A+</button>
        <button class="btn" data-a="hide" title="Hide">✕</button>
      </div><div class="cap gone"></div><div class="statrow" style="display:flex;justify-content:center"></div></div>`;
    capEl = capRoot.querySelector(".cap");
    capRoot.querySelectorAll(".btn").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); action(b.dataset.a); }));
    // drag to move (offset from the automatic spot), double-click to reset
    let sx, sy, ox, oy;
    capEl.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; ox = ui.capDx || 0; oy = ui.capDy || 0; capEl.setPointerCapture(e.pointerId); });
    capEl.addEventListener("pointermove", (e) => { if (sx === undefined) return; ui.capDx = ox + e.clientX - sx; ui.capDy = oy + e.clientY - sy; placeCaptions(); });
    capEl.addEventListener("pointerup", () => { if (sx !== undefined) { sx = undefined; saveUi(); } });
    capEl.addEventListener("dblclick", () => { ui.capDx = ui.capDy = 0; saveUi(); placeCaptions(); });
    attach(capHost);
    capTimer = setInterval(() => isSubs() && placeCaptions(), 500); // follow the video (theater mode, scrolling, resize)
  }

  /** The video being watched: the largest visible <video>, else the whole window. */
  function videoRect() {
    let best = null, area = 0;
    const visibleArea = (r) => Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect(), a = visibleArea(r);
      if (a > area && r.width > 200 && r.height > 120) { best = r; area = a; }
    }
    // players inside an <iframe> (Zoom web, embedded players): use a big iframe if there's no big video
    if (area < innerWidth * innerHeight * 0.12) {
      for (const f of document.querySelectorAll("iframe")) {
        const r = f.getBoundingClientRect(), a = visibleArea(r);
        if (a > area && a > innerWidth * innerHeight * 0.2) { best = r; area = a; }
      }
    }
    if (!best) return { left: 0, top: 0, width: innerWidth, height: innerHeight, bottom: innerHeight };
    const top = Math.max(best.top, 0), bottom = Math.min(best.bottom, innerHeight);
    return { left: best.left, top, width: best.width, height: bottom - top, bottom };
  }

  function placeCaptions() {
    if (!capHost) return;
    if (capHost.parentNode !== fsParent()) attach(capHost);
    const v = videoRect();
    const w = Math.min(v.width * 0.9, 1100);
    capHost.style.width = w + "px";
    const h = capHost.getBoundingClientRect().height;
    const left = v.left + (v.width - w) / 2 + (ui.capDx || 0);
    const top = v.bottom - h - Math.max(v.height * 0.07, 12) + (ui.capDy || 0);
    capHost.style.left = Math.max(0, Math.min(left, innerWidth - w)) + "px";
    capHost.style.top = Math.max(0, Math.min(top, innerHeight - h)) + "px";
  }

  function cueEl(c, cls, showRu) {
    const d = document.createElement("div");
    d.className = "cue " + cls;
    d.innerHTML = `<span class="txt"><span class="en"></span>${showRu ? `<br><span class="ru"></span>` : ""}</span>`;
    const en = d.querySelector(".en"), ru = d.querySelector(".ru") || document.createElement("span");
    if (c.lang === "en") { en.textContent = c.en; ru.textContent = "(spoken in English)"; }
    else if (c.align && c.align.length && c.ru) colorize(en, ru, c); // learning mode: colored English words
    else { en.textContent = c.en; ru.textContent = c.ru || ""; }
    return d;
  }

  // ---- 2-line captions, like real subtitles ----
  // How many characters fit on two caption lines at the current size (YouTube/Netflix: ~42 per line).
  function maxChars() {
    const w = capHost ? capHost.getBoundingClientRect().width || 800 : 800;
    const px = Math.round(settings.fontSize * 1.15);
    return 2 * Math.max(18, Math.min(48, Math.floor((w * 0.92) / (px * 0.52))));
  }

  /** Split a long sentence into ≤2-line pieces, breaking after punctuation when possible. */
  function chunks(text, max) {
    const words = text.split(/\s+/).filter(Boolean), out = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (next.length > max && cur) { out.push(cur); cur = w; continue; }
      cur = next;
      if (/[,;:.!?—]$/.test(w) && cur.length > max * 0.55) { out.push(cur); cur = ""; } // natural break
    }
    if (cur) out.push(cur);
    return out;
  }

  /** A piece of `m` (en substring starting at `from`) with its word-alignment shifted to match. */
  function piece(m, text, from) {
    const align = (m.align || []).filter(([, , es, el]) => es >= from && es + el <= from + text.length)
      .map(([rs, rl, es, el]) => [rs, rl, es - from, el]);
    return { ...m, en: text, align };
  }

  let finalQueue = [], finalTimer = null;
  function playFinal(m) {
    clearTimeout(finalTimer);
    const max = maxChars();
    let from = 0;
    finalQueue = chunks(m.en, max).map((t) => { const i = m.en.indexOf(t, from); from = i + t.length; return piece(m, t, Math.max(i, 0)); });
    nextFinalChunk();
  }
  function nextFinalChunk() {
    shownFinal = finalQueue.shift() || null;
    renderCaptions();
    if (finalQueue.length) {
      // reading time: ~65 ms per character, 1.5–5 s per piece
      finalTimer = setTimeout(nextFinalChunk, Math.max(1500, Math.min(5000, shownFinal.en.length * 65)));
    } else finalTimer = null;
  }
  let shownFinal = null;

  /** Live text: only the newest words that fit on two lines. */
  function liveTail(c) {
    const max = maxChars();
    if (c.en.length <= max) return c;
    let cut = c.en.length - (max - 1);
    const sp = c.en.indexOf(" ", cut);
    if (sp > 0 && sp < c.en.length - 8) cut = sp + 1;
    const p = piece(c, c.en.slice(cut), cut);
    return { ...p, en: "…" + p.en, align: p.align.map(([rs, rl, es, el]) => [rs, rl, es + 1, el]) };
  }

  function renderCaptions() {
    if (!capEl || !isSubs()) return;
    capRoot.host.style.fontSize = Math.round(settings.fontSize * 1.15) + "px";
    capEl.style.setProperty("--bg-a", Math.max(0.15, Math.min(1, settings.bgOpacity ?? 0.88)) * 0.85);
    // translation only: a finished sentence is played piece by piece; otherwise the live sentence
    const live = liveCue && liveCue.en && liveCue.en !== "…" ? liveTail(liveCue) : null;
    const cur = finalTimer ? shownFinal : live || shownFinal;
    const cues = cur ? [cueEl(cur, "now", false)] : [];
    capEl.replaceChildren(...cues);
    capEl.classList.toggle("gone", !cues.length);
    renderCapStatus();
    placeCaptions();
    // like YouTube: captions disappear when nobody has spoken for a while
    clearTimeout(fadeTimer);
    if (!liveCue && cues.length) fadeTimer = setTimeout(() => capEl.classList.add("gone"), 7000);
  }

  /** Subtitle mode has no panel header, so show connection problems (and recording) as a small line. */
  function renderCapStatus() {
    if (!capRoot) return;
    const row = capRoot.querySelector(".statrow");
    const msg = !live ? "server offline — run start.sh" : saving ? "⏺ recording" : !lastFinal && !liveCue ? "● listening…" : "";
    row.replaceChildren();
    if (msg) {
      const d = document.createElement("span");
      d.className = "stat" + (!live ? " bad" : "");
      d.textContent = msg;
      row.append(d);
    }
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
    liveCue = en || ru ? { en: en || "…", ru, align } : null;
    renderCaptions();
    liveWrap.classList.toggle("idle", !en && !ru);
    if (en && ru && align && align.length) colorize(liveEn, liveRu, { en, ru, align });
    else {
      liveEn.textContent = en || (ru ? "…" : "listening…");
      liveRu.textContent = ru || "";
    }
  }

  // ---------- auto-start prompt (Chrome needs one click/key to allow capturing a tab) ----------
  let promptHost, promptTimer;
  function hidePrompt() {
    clearTimeout(promptTimer);
    if (!promptHost) return;
    const el = promptHost;
    promptHost = null;
    el.shadowRoot.querySelector(".toast").classList.add("out");
    setTimeout(() => el.remove(), 250);
  }
  function showPrompt(m) {
    if (host && host.isConnected && box && box.style.display !== "none") return; // already running here
    hidePrompt();
    promptHost = document.createElement("div");
    promptHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);";
    const r = promptHost.attachShadow({ mode: "open" });
    const key = m.shortcut || "";
    r.innerHTML = `<style>
      .toast { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; border-radius: 12px;
        font: 14px/1.35 system-ui, "Segoe UI", Roboto, sans-serif; color: #fff; background: rgba(14,16,20,.94);
        box-shadow: 0 8px 30px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.1);
        animation: in .3s cubic-bezier(.2,.7,.3,1); transition: opacity .25s, transform .25s; }
      .toast.out { opacity: 0; transform: translateY(8px); }
      @keyframes in { from { opacity: 0; transform: translateY(12px); } }
      kbd { font: 600 13px system-ui, sans-serif; background: #2b3140; border: 1px solid #454d60; border-bottom-width: 2px;
        border-radius: 6px; padding: 1px 7px; }
      .muted { color: #9aa3b5; font-size: 12px; }
      button { all: unset; cursor: pointer; font-size: 12px; color: #c6cddb; padding: 4px 8px; border-radius: 6px; }
      button:hover { background: rgba(255,255,255,.12); color: #fff; }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
    </style>
    <div class="toast">
      <span>🎧</span>
      <span><b>RU→EN subtitles</b> for <span class="h"></span>?<br>
        <span class="muted">${key ? `Press <kbd>${key.replace(/\+/g, "</kbd>+<kbd>")}</kbd> or click` : "Click"} the RU→EN icon${m.busy ? " (moves subtitles to this tab)" : ""}</span></span>
      <button class="later" title="Hide for 10 minutes">Not now</button>
      <button class="never" title="Turn off auto-start for this site">Don't ask here</button>
    </div>`;
    r.querySelector(".h").textContent = m.host;
    r.querySelector(".later").onclick = () => { chrome.runtime.sendMessage({ target: "background", type: "prompt-snooze" }); hidePrompt(); };
    r.querySelector(".never").onclick = () => { chrome.runtime.sendMessage({ target: "background", type: "prompt-never", pattern: m.rule }); hidePrompt(); };
    (document.fullscreenElement && !/^(VIDEO|IFRAME)$/.test(document.fullscreenElement.tagName) ? document.fullscreenElement : document.documentElement).appendChild(promptHost);
    promptTimer = setTimeout(hidePrompt, 25000); // don't nag: it goes away by itself
  }

  // ---------- messages from the extension ----------
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m.type === "ping") return reply({ host: location.hostname }); // background: script present + which site
    if (m.type === "autostart-prompt") return showPrompt(m);
    if (m.type === "overlay-show") {
      hidePrompt(); // subtitles started (e.g. via the shortcut the prompt suggested)
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
        if (capHost) { capHost.remove(); capHost = null; clearInterval(capTimer); }
        lastFinal = liveCue = shownFinal = null; finalQueue = []; clearTimeout(finalTimer); finalTimer = null;
        live = false; saving = null; startedAt = null; stick = true; unseen = 0; ui.hidden = false;
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
      saving = m.on ? { count: m.count, transcript: m.transcript, audio: m.audio } : null;
      if (host) showStatus();
    } else if (m.type === "saved") {
      build();
      statusEl.textContent = `✔ saved → Downloads/${m.files.map((f) => f.split("/").pop()).join(" + ")}`;
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
