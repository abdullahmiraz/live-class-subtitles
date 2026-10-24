// Subtitle overlay: a draggable box in a shadow root, so page CSS can't break it.
(() => {
  if (window.__ruenSubs) return;
  window.__ruenSubs = true;

  let host, root, box, linesEl, partialEl, statusEl, settings = { showRu: true, fontSize: 26, lines: 2 };
  const finals = [];

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "ruen-live-subs";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:8%;transform:translateX(-50%);";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .box{font-family:system-ui,"Segoe UI",Roboto,sans-serif;max-width:min(92vw,1100px);min-width:280px;
             background:rgba(10,10,12,.78);color:#fff;border-radius:10px;padding:8px 14px 10px;cursor:move;
             box-shadow:0 4px 24px rgba(0,0,0,.35);user-select:none;line-height:1.3;backdrop-filter:blur(4px)}
        .en{font-weight:600;text-shadow:0 1px 2px #000}
        .ru{opacity:.62;font-size:.6em;margin-top:2px}
        .line{margin:2px 0}
        .old{opacity:.55}
        .partial .en{opacity:.8;font-style:italic;font-weight:500}
        .status{font-size:11px;opacity:.6;display:flex;justify-content:space-between;gap:10px;margin-bottom:2px}
        .x{cursor:pointer;opacity:.7}
        .x:hover{opacity:1}
      </style>
      <div class="box">
        <div class="status"><span class="st">connecting…</span><span class="x" title="Hide (subtitles keep running)">✕</span></div>
        <div class="lines"></div>
        <div class="line partial"><div class="en"></div><div class="ru"></div></div>
      </div>`;
    box = root.querySelector(".box");
    linesEl = root.querySelector(".lines");
    partialEl = root.querySelector(".partial");
    statusEl = root.querySelector(".st");
    root.querySelector(".x").onclick = () => (host.style.display = "none");
    drag();
    apply();
    mount();
  }

  // keep the box visible in fullscreen video
  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", () => host && mount());

  function drag() {
    let sx, sy, ox, oy;
    box.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("x")) return;
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener("pointermove", (e) => {
      if (sx === undefined) return;
      host.style.transform = "none";
      host.style.bottom = "auto";
      host.style.left = ox + e.clientX - sx + "px";
      host.style.top = oy + e.clientY - sy + "px";
    });
    box.addEventListener("pointerup", () => {
      sx = undefined;
      chrome.storage.local.set({ ["pos:" + location.host]: { left: host.style.left, top: host.style.top } });
    });
    chrome.storage.local.get("pos:" + location.host).then((r) => {
      const p = r["pos:" + location.host];
      if (p && p.left) Object.assign(host.style, { transform: "none", bottom: "auto", left: p.left, top: p.top });
    });
  }

  function apply() {
    if (!box) return;
    box.style.fontSize = settings.fontSize + "px";
    root.querySelectorAll(".ru").forEach((el) => (el.style.display = settings.showRu ? "" : "none"));
  }

  function line(en, ru, cls = "") {
    const d = document.createElement("div");
    d.className = "line " + cls;
    d.innerHTML = `<div class="en"></div><div class="ru"></div>`;
    d.querySelector(".en").textContent = en;
    d.querySelector(".ru").textContent = ru;
    if (!settings.showRu) d.querySelector(".ru").style.display = "none";
    return d;
  }

  function render() {
    linesEl.replaceChildren(...finals.map((f, i) => line(f.en, f.ru, i < finals.length - 1 ? "old" : "")));
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "overlay-show") {
      settings = { ...settings, ...m.settings };
      build();
      host.style.display = "";
      apply();
    } else if (m.type === "overlay-hide") {
      host && host.remove();
      host = null;
      finals.length = 0;
    } else if (m.type === "overlay-settings") {
      settings = { ...settings, ...m.settings };
      while (finals.length > settings.lines) finals.shift();
      apply();
      render();
    } else if (m.type === "conn") {
      build();
      statusEl.textContent = m.ok ? "● live" : "server offline — run start.sh";
      statusEl.style.color = m.ok ? "#7f7" : "#f88";
    } else if (m.type === "sub") {
      build();
      if (m.kind === "final") {
        finals.push({ en: m.en, ru: m.lang === "en" ? "(spoken in English)" : m.ru });
        while (finals.length > settings.lines) finals.shift();
        render();
        partialEl.querySelector(".en").textContent = "";
        partialEl.querySelector(".ru").textContent = "";
      } else if (m.kind === "partial") {
        partialEl.querySelector(".en").textContent = m.en;
        partialEl.querySelector(".ru").textContent = m.ru;
      } else if (m.kind === "error") {
        statusEl.textContent = m.en;
        statusEl.style.color = "#f88";
      }
    }
  });
})();
