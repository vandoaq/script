// ==UserScript==
// @name         OLM Helper
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Hack Đáp Án OLM edit by Đòn Hư Lém
// @author       Đòn Hư Lém
// @match        https://olm.vn/chu-de/*
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://github.com/vandoaq/script/raw/refs/heads/main/OLMHelper.user.js
// @downloadURL  https://github.com/vandoaq/script/raw/refs/heads/main/OLMHelper.user.js
// @icon         https://play-lh.googleusercontent.com/PMA5MRr5DUJBUbDgdUn6arbGXteDjRBIZVO3P3z9154Kud2slXPjy-iiPwwKfvZhc4o=w240-h480-rw
// ==/UserScript==

(function () {
  "use strict";

  // ==== Robust window bridge for mobile ====
  const UW = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;

  const TARGET_URL_KEYWORD = "get-question-of-ids";
  const LS_SIZE = "olm_size";
  const LS_POS = "olm_pos";
  const LS_DARK = "olm_dark";
  const LS_PIN  = "olm_pin"; // 'right' | 'left' | 'free'
  const HIGHLIGHT_CLASS = "olm-hl";

  // ===== Utilities =====
  const ready = (fn) => {
    if (document.readyState === "complete" || document.readyState === "interactive") fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  };
  const ensureHead = (node) => {
    if (document.head) document.head.appendChild(node);
    else ready(() => (document.head || document.documentElement).appendChild(node));
  };
  const ensureBody = (node) => {
    if (document.body) document.body.appendChild(node);
    else ready(() => document.body.appendChild(node));
  };
  const debounce = (fn, ms) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  function decodeBase64Utf8(base64) {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) { console.error("Lỗi giải mã Base64:", e); return "Lỗi giải mã nội dung!"; }
  }

  function mildLatexFix(html) {
    return html
      .replace(/\$\$([^$]+)\$(?!\$)/g, "$$$$${1}$$")
      .replace(/\$(?!\$)([^$]+)\$\$/g, "$$${1}$$");
  }

  function highlightInElement(el, keyword) {
    el.querySelectorAll("." + HIGHLIGHT_CLASS).forEach(n => {
      const p = n.parentNode; while (n.firstChild) p.insertBefore(n.firstChild, n); p.removeChild(n); p.normalize?.();
    });
    if (!keyword) return;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let node;
    while ((node = walk.nextNode())) {
      const t = node.nodeValue; if (!t || !t.trim()) continue;
      let m, last = 0, pieces = [];
      while ((m = regex.exec(t))) {
        pieces.push(document.createTextNode(t.slice(last, m.index)));
        const mark = document.createElement("mark"); mark.className = HIGHLIGHT_CLASS;
        mark.textContent = t.slice(m.index, m.index + m[0].length);
        pieces.push(mark); last = m.index + m[0].length;
      }
      if (pieces.length) {
        pieces.push(document.createTextNode(t.slice(last)));
        const frag = document.createDocumentFragment(); pieces.forEach(p => frag.appendChild(p));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  // ===== MathJax v3 loader (safe for mobile) =====
  function ensureMathJax() {
    if (UW.MathJax) return;
    const cfg = document.createElement("script");
    cfg.type = "text/javascript";
    cfg.text = `
      window.MathJax = {
        tex: {
          inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
          displayMath: [['$$','$$'], ['\\\\[','\\\\]']],
          processEscapes: true, processEnvironments: true
        },
        options: { skipHtmlTags: ['noscript','style','textarea','pre','code'], ignoreHtmlClass: 'no-mathjax', renderActions: { addMenu: [] } },
        startup: { typeset: false }
      };
    `;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    ensureHead(cfg);
    ensureHead(s);
  }
  ensureMathJax();

  // ===== UI =====
  class AnswerDisplay {
    constructor() {
      this.isVisible = true;
      this.dragState = { dragging: false, startX: 0, startY: 0, initX: 0, initY: 0 };
      this.resizeState = null;

      // size default thân thiện mobile
      const defaultH = Math.max(340, Math.round(window.innerHeight * 0.66));
      this.size = { w: Math.min(520, Math.max(340, Math.round(window.innerWidth * 0.9))), h: defaultH };
      this.pos = null;
      this.pinSide = localStorage.getItem(LS_PIN) || "right";
      this.dark = (() => {
        const saved = localStorage.getItem(LS_DARK);
        if (saved !== null) return saved === "1";
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
      })();

      try { const saved = JSON.parse(localStorage.getItem(LS_SIZE) || "null"); if (saved?.w && saved?.h) this.size = saved; } catch {}
      try { const p = JSON.parse(localStorage.getItem(LS_POS) || "null"); if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) this.pos = p; } catch {}

      this.filterDebounced = debounce(this.filterQuestions.bind(this), 140);

      // binds
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onPointerDownDrag = this.onPointerDownDrag.bind(this);
      this.onPointerMoveDrag = this.onPointerMoveDrag.bind(this);
      this.onPointerUpDrag = this.onPointerUpDrag.bind(this);
      this.onPointerDownResize = this.onPointerDownResize.bind(this);
      this.onPointerMoveResize = this.onPointerMoveResize.bind(this);
      this.onPointerUpResize = this.onPointerUpResize.bind(this);
    }

    init() {
      this.injectCSS();
      this.createUI();
      this.addEventListeners();
      if (this.dark) this.container.classList.add("olm-dark");
      this.applyPinOrPos();
      this.positionToggleBtn();
    }

    injectCSS() {
      const css = `
        :root{
          --panel-w: 520px;
          --panel-h: 70vh;
          --glass-border: rgba(255,255,255,0.6);
          --accent: #6c63ff;
          --accent-2: #00c2ff;
          --muted: #6b7280;
          --success: #10b981;
          --bg-glass: linear-gradient(135deg, rgba(255,255,255,0.62), rgba(245,248,255,0.5));
          --bg-top: linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.28));
          --bg-sub: rgba(255,255,255,0.4);
          --shadow: 0 10px 30px rgba(17,24,39,0.25);
          --text-main: #0f172a;
          --text-sub: #334155;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        }
        #olm-answers-container{
          position: fixed;
          top: max(12px, env(safe-area-inset-top));
          width: var(--panel-w); height: var(--panel-h);
          z-index: 2147483647; display:flex; flex-direction:column;
          border-radius: 14px; overflow: hidden;
          -webkit-backdrop-filter: blur(10px) saturate(120%);
          backdrop-filter: blur(10px) saturate(120%);
          background: var(--bg-glass);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow);
          transition: transform .18s ease, opacity .18s ease, left .12s, right .12s;
          color: var(--text-main); user-select: none; min-width: 320px;
          max-width: calc(100vw - 24px);
          max-height: calc(100vh - 24px);
        }
        #olm-answers-container.hidden{ opacity:.0; transform: translateY(-6px) scale(.98); pointer-events:none; }

        #olm-answers-container.olm-dark{
          --glass-border: rgba(255,255,255,0.12);
          --bg-glass: linear-gradient(135deg, rgba(24,26,33,0.65), rgba(24,28,37,0.52));
          --bg-top: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.04));
          --bg-sub: rgba(255,255,255,0.08);
          --shadow: 0 10px 30px rgba(0,0,0,0.55);
          --text-main: #e5e7eb; --text-sub: #cbd5e1;
        }

        .olm-topbar{ display:flex; align-items:center; gap:10px; padding:10px 12px; background: var(--bg-top); border-bottom: 1px solid rgba(0,0,0,0.06); touch-action: none; }
        #olm-answers-container.olm-dark .olm-topbar{ border-bottom-color: rgba(255,255,255,0.06); }
        .olm-brand{ display:flex; align-items:center; gap:10px; }
        .olm-logo{ width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:700; background: linear-gradient(135deg,var(--accent),var(--accent-2)); color:#fff; }
        .olm-title{ font-size:14px; font-weight:700; line-height:1; }
        .olm-sub{ font-size:11px; color: var(--muted); }
        .olm-controls{ margin-left:auto; display:flex; gap:6px; align-items:center; }
        .olm-btn{ background: transparent; border: 1px solid rgba(11,17,26,0.08); padding:6px 8px; border-radius:8px; font-size:12px; }
        #olm-answers-container.olm-dark .olm-btn{ border-color: rgba(255,255,255,0.12); color: var(--text-main); }

        .search-wrap{ display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid rgba(0,0,0,0.06); background: var(--bg-sub); }
        #olm-answers-container.olm-dark .search-wrap{ border-bottom-color: rgba(255,255,255,0.06); }
        .search-input{ flex:1; padding:8px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.06); outline:none; background: rgba(255,255,255,0.85); font-size:13px; }
        #olm-answers-container.olm-dark .search-input{ background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); color: var(--text-main); }
        .meta{ font-size:12px; color: var(--muted); min-width:74px; text-align:right; }

        #olm-answers-content{ padding:10px; overflow-y:auto; -webkit-overflow-scrolling: touch; flex:1; display:flex; flex-direction:column; gap:10px; }
        .qa-block{ display:flex; flex-direction:column; gap:8px; padding:12px; border-radius:10px; background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(248,250,255,0.8)); border:1px solid rgba(15,23,42,0.05); }
        #olm-answers-container.olm-dark .qa-block{ background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.04)); border-color: rgba(255,255,255,0.08); }

        .qa-top{ display:flex; align-items:flex-start; gap:10px; }
        .question-content{ font-weight:700; color:var(--text-main); font-size:14px; flex:1; }
        .q-index{ margin-right:6px; color: var(--text-sub); }
        .qa-actions{ display:flex; gap:6px; align-items:center; margin-left:auto; flex-wrap: wrap; }
        .pill{ font-size:11px; padding:3px 7px; border-radius:999px; color:#fff; background:#64748b; }
        .pill.ok{ background: var(--success); }
        .pill.sol{ background: #3b82f6; }
        .content-container{ padding-left:6px; color:#0b3c49; font-size:13px; }
        #olm-answers-container.olm-dark .content-container{ color: var(--text-main); }
        .content-container[data-type="answer"]{ font-weight:600; }
        .content-container[data-type="answer"] .correct-answer{ color: var(--success) !important; }
        .footer-bar{ padding:8px 10px; display:flex; align-items:center; gap:8px; border-top:1px solid rgba(0,0,0,0.06); background: var(--bg-sub); }
        #olm-answers-container.olm-dark .footer-bar{ border-top-color: rgba(255,255,255,0.08); }
        #export-btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(11,17,26,0.08); cursor:pointer; font-weight:700; background:linear-gradient(90deg,var(--accent),var(--accent-2)); color:#fff; }
        #count-badge{ font-weight:700; color:var(--muted); margin-left:auto; font-size:13px; }
        .copy-btn,.copy-q,.toggle-one{ border:none; border-radius:8px; padding:6px 8px; font-size:12px; }
        .copy-btn{ background: var(--success); color:#fff; }
        .copy-q{ background:#94a3b8; color:#fff; }
        .toggle-one{ background: transparent; border:1px dashed rgba(11,17,26,0.2); color: var(--text-main); }
        #olm-answers-container.olm-dark .toggle-one{ border-color: rgba(255,255,255,0.2); }
        .not-found{ color: var(--muted); font-style: italic; }

        .resize-handle{
          position:absolute; right:8px; bottom:8px; width:18px; height:18px; cursor: nwse-resize;
          border-right:2px solid rgba(0,0,0,0.25); border-bottom:2px solid rgba(0,0,0,0.25); opacity:.7; touch-action: none;
        }
        #olm-answers-container.olm-dark .resize-handle{ border-right-color: rgba(255,255,255,0.35); border-bottom-color: rgba(255,255,255,0.35); }
        #olm-answers-container.resizing{ user-select:none; }

        mark.${HIGHLIGHT_CLASS}{ background: rgba(250, 204, 21, 0.35); padding: 0 2px; border-radius: 3px; }

        @media (max-width: 520px){
          #olm-answers-container{ left: 12px !important; right: 12px !important; width: auto !important; height: 66vh !important; }
          .olm-controls .olm-btn{ padding:5px 6px; font-size:11px; }
          .question-content{ font-size:13px; }
        }

        /* Floating toggle */
        #olm-toggle-btn{
          position: fixed; top: max(12px, env(safe-area-inset-top)); right: 12px;
          width: 40px; height: 40px; border-radius: 999px; display:none; align-items:center; justify-content:center;
          z-index: 2147483647; border: 1px solid var(--glass-border);
          -webkit-backdrop-filter: blur(10px) saturate(120%); backdrop-filter: blur(10px) saturate(120%);
          background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(240,245,255,0.8));
          box-shadow: var(--shadow); cursor: pointer; user-select: none; font-weight:800; font-size:12px; color:#111827;
          touch-action: manipulation;
        }
        #olm-answers-container.olm-dark ~ #olm-toggle-btn{
          border-color: rgba(255,255,255,0.12);
          background: linear-gradient(135deg, rgba(40,44,52,0.9), rgba(40,44,52,0.8)); color:#e5e7eb;
        }
        #olm-toggle-btn.show{ display:flex; }
        #olm-toggle-btn:active{ transform: scale(.98); }
      `;
      const style = document.createElement("style");
      style.textContent = css;
      ensureHead(style);
    }

    createUI() {
      this.container = document.createElement("div");
      this.container.id = "olm-answers-container";
      this.container.style.width = this.size.w + "px";
      this.container.style.height = this.size.h + "px";

      // Topbar (drag handle by pointer events)
      const topbar = document.createElement("div");
      topbar.className = "olm-topbar";
      topbar.addEventListener("pointerdown", this.onPointerDownDrag);

      const brand = document.createElement("div");
      brand.className = "olm-brand";
      const logo = document.createElement("div"); logo.className = "olm-logo"; logo.textContent = "OLM";
      const titleWrap = document.createElement("div");
      const title = document.createElement("div"); title.className = "olm-title"; title.textContent = "OLM Helper";
      const sub = document.createElement("div"); sub.className = "olm-sub"; sub.textContent = "Edit by Đòn Hư Lém";
      titleWrap.appendChild(title); titleWrap.appendChild(sub);
      brand.appendChild(logo); brand.appendChild(titleWrap);

      const controls = document.createElement("div"); controls.className = "olm-controls";

      const pinBtn = document.createElement("button");
      pinBtn.className = "olm-btn"; pinBtn.title = "Ghim trái/phải (Alt G)";
      pinBtn.textContent = this.pinSide === "right" ? "R" : this.pinSide === "left" ? "R" : "L/R";
      pinBtn.addEventListener("click", () => this.togglePinSide());

      const darkBtn = document.createElement("button");
      darkBtn.className = "olm-btn"; darkBtn.title = "Dark mode (Alt D)";
      darkBtn.textContent = this.dark ? "D/L" : "D/L";
      darkBtn.addEventListener("click", () => this.toggleDarkMode());

      const collapseBtn = document.createElement("button");
      collapseBtn.className = "olm-btn"; collapseBtn.title = "Ẩn/Hiện (Shift phải)";
      collapseBtn.textContent = "Hide";
      collapseBtn.addEventListener("click", () => this.toggleVisibility());

      const exportBtnTop = document.createElement("button");
      exportBtnTop.id = "export-btn"; exportBtnTop.textContent = "Xuất TXT";
      exportBtnTop.addEventListener("click", () => this.exportToTxt());

      controls.append(pinBtn, darkBtn, collapseBtn, exportBtnTop);
      topbar.append(brand, controls);

      // Search
      const searchWrap = document.createElement("div"); searchWrap.className = "search-wrap";
      const searchInput = document.createElement("input");
      searchInput.className = "search-input";
      searchInput.placeholder = "Tìm theo từ khóa (Alt F để focus)";
      searchInput.addEventListener("input", (e) => this.filterDebounced(e.target.value));
      const meta = document.createElement("div"); meta.className = "meta"; meta.id = "meta-info"; meta.textContent = "0 câu";
      searchWrap.append(searchInput, meta);

      // Content
      this.contentArea = document.createElement("div"); this.contentArea.id = "olm-answers-content";

      // Footer
      const footer = document.createElement("div"); footer.className = "footer-bar";
      const hint = document.createElement("div"); hint.style.fontSize = "12px"; hint.style.color = "var(--muted)";
      hint.textContent = "Shift phải: ẩn/hiện • Alt F: tìm • Alt A: copy đáp án hiển thị";
      const countBadge = document.createElement("div"); countBadge.id = "count-badge"; countBadge.textContent = "0 câu";
      footer.append(hint, countBadge);

      // Resize handle by pointer
      const handle = document.createElement("div");
      handle.className = "resize-handle"; handle.title = "Kéo để đổi kích thước";
      handle.addEventListener("pointerdown", this.onPointerDownResize);
      this.resizeHandle = handle;

      this.container.append(topbar, searchWrap, this.contentArea, footer, handle);
      ensureBody(this.container);

      this.topbar = topbar;
      this.searchInput = searchInput;
      this.countBadge = countBadge;
      this.metaInfo = meta;
      this.pinBtn = pinBtn;
      this.darkBtn = darkBtn;

      // Toggle floating button
      const tbtn = document.createElement("div");
      tbtn.id = "olm-toggle-btn"; tbtn.title = "Hiện OLM Helper"; tbtn.textContent = "OLM";
      tbtn.addEventListener("click", () => { this.isVisible = true; this.container.classList.remove("hidden"); this.hideToggleBtn(); });
      // Double-tap to hide quickly on mobile
      let lastTap = 0;
      tbtn.addEventListener("touchend", () => {
        const now = Date.now();
        if (now - lastTap < 350) this.toggleVisibility();
        lastTap = now;
      }, { passive: true });
      ensureBody(tbtn);
      this.toggleBtn = tbtn;
    }

    addEventListeners() {
      // Keyboard shortcuts (PC). Mobile sẽ bỏ qua nếu không có phím.
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("resize", () => this.positionToggleBtn());
      window.addEventListener("scroll", () => this.positionToggleBtn(), { passive: true });
    }

    // Pointer drag (mouse + touch + pen)
    onPointerDownDrag(e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // Khi kéo, chuyển sang free
      this.pinSide = "free";
      localStorage.setItem(LS_PIN, this.pinSide);
      const rect = this.container.getBoundingClientRect();
      this.container.style.right = "auto";
      this.container.style.left = `${rect.left}px`;
      this.container.style.top  = `${rect.top}px`;
      this.container.style.width  = rect.width + "px";
      this.container.style.height = rect.height + "px";

      this.dragState = { dragging: true, startX: e.clientX, startY: e.clientY, initX: rect.left, initY: rect.top };
      this.container.style.transition = "none";
      window.addEventListener("pointermove", this.onPointerMoveDrag);
      window.addEventListener("pointerup", this.onPointerUpDrag);
    }
    onPointerMoveDrag(e) {
      if (!this.dragState.dragging) return;
      e.preventDefault();
      const dx = e.clientX - this.dragState.startX;
      const dy = e.clientY - this.dragState.startY;
      let left = this.dragState.initX + dx;
      let top  = this.dragState.initY + dy;
      // chặn ra ngoài màn
      const rect = this.container.getBoundingClientRect();
      const maxL = window.innerWidth - rect.width - 6;
      const maxT = window.innerHeight - rect.height - 6;
      left = Math.max(6, Math.min(maxL, left));
      top  = Math.max(6, Math.min(maxT,  top));
      this.container.style.left = `${left}px`;
      this.container.style.top  = `${top}px`;
      this.positionToggleBtn();
    }
    onPointerUpDrag() {
      this.dragState.dragging = false;
      window.removeEventListener("pointermove", this.onPointerMoveDrag);
      window.removeEventListener("pointerup", this.onPointerUpDrag);
      this.container.style.transition = "";
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      try { localStorage.setItem(LS_POS, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })); } catch {}
      this.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      this.positionToggleBtn();
    }

    // Pointer resize
    onPointerDownResize(e){
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      this.container.classList.add('resizing');
      const r = this.container.getBoundingClientRect();
      this.resizeState = { startX: e.clientX, startY: e.clientY, startW: r.width, startH: r.height };
      window.addEventListener('pointermove', this.onPointerMoveResize);
      window.addEventListener('pointerup', this.onPointerUpResize);
    }
    onPointerMoveResize(e){
      if (!this.resizeState) return;
      const minW = 320, minH = 240;
      const maxW = Math.min(window.innerWidth - 16, 1200);
      const maxH = Math.min(window.innerHeight - 16, 1000);
      let newW = this.resizeState.startW + (e.clientX - this.resizeState.startX);
      let newH = this.resizeState.startH + (e.clientY - this.resizeState.startY);
      newW = Math.max(minW, Math.min(maxW, newW));
      newH = Math.max(minH, Math.min(maxH, newH));
      this.container.style.width = newW + 'px';
      this.container.style.height = newH + 'px';
      this.positionToggleBtn();
    }
    onPointerUpResize(){
      if (!this.resizeState) return;
      this.container.classList.remove('resizing');
      window.removeEventListener('pointermove', this.onPointerMoveResize);
      window.removeEventListener('pointerup', this.onPointerUpResize);
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      this.resizeState = null;
      this.positionToggleBtn();
    }

    exportToTxt() {
      let fullText = `Đáp án OLM by Đòn Hư Lém - ${new Date().toLocaleString("vi-VN")}\n\n`;
      const blocks = [...this.contentArea.querySelectorAll(".qa-block")].filter(b => b.style.display !== "none");
      blocks.forEach((block, index) => {
        const q = block.querySelector(".question-content");
        const content = block.querySelector(".content-container");
        if (!q || !content) return;
        const textQ = q.textContent.trim().replace(/\s\s+/g, " ");
        const textA = content.textContent.trim().replace(/\s\s+/g, " ");
        fullText += `Câu ${index + 1}: ${textQ}\n--> ${textA}\n\n`;
      });
      const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `dap-an-olm-${Date.now()}.txt`;
      ensureBody(link); link.click(); link.remove();
    }

    copyAllVisibleAnswers() {
      const blocks = [...this.contentArea.querySelectorAll(".qa-block")].filter(b => b.style.display !== "none");
      if (!blocks.length) return;
      let out = "";
      blocks.forEach((b, i) => {
        const q = b.querySelector(".question-content")?.innerText ?? "";
        const a = b.querySelector(".content-container")?.innerText ?? "";
        out += `Câu ${i + 1}: ${q}\n--> ${a}\n\n`;
      });
      const doCopy = (txt) => navigator.clipboard?.writeText(txt).catch(() => {
        const ta = document.createElement("textarea"); ta.value = txt; ensureBody(ta); ta.select(); document.execCommand("copy"); ta.remove();
      });
      doCopy(out);
    }

    onKeyDown(event) {
      if (event.code === "ShiftRight") this.toggleVisibility();
      if (event.altKey && !event.shiftKey && !event.ctrlKey) {
        const k = event.key.toLowerCase();
        if (k === "f") { event.preventDefault(); this.searchInput.focus(); this.searchInput.select(); }
        else if (k === "a") { event.preventDefault(); this.copyAllVisibleAnswers(); }
        else if (k === "d") { event.preventDefault(); this.toggleDarkMode(); }
        else if (k === "g") { event.preventDefault(); this.togglePinSide(); }
      }
    }

    toggleVisibility() {
      this.isVisible = !this.isVisible;
      this.container.classList.toggle("hidden", !this.isVisible);
      if (this.isVisible) this.hideToggleBtn(); else this.showToggleBtn();
    }

    toggleDarkMode() {
      this.dark = !this.dark;
      this.container.classList.toggle("olm-dark", this.dark);
      this.darkBtn.textContent = this.dark ? "Dark: On" : "Dark: Off";
      try { localStorage.setItem(LS_DARK, this.dark ? "1" : "0"); } catch {}
    }

    togglePinSide() {
      if (this.pinSide === "right") this.pinSide = "left";
      else if (this.pinSide === "left") this.pinSide = "free";
      else this.pinSide = "right";
      localStorage.setItem(LS_PIN, this.pinSide);
      this.pinBtn.textContent = this.pinSide === "right" ? "Ghim phải" : this.pinSide === "left" ? "Ghim trái" : "Thả tự do";
      this.applyPinOrPos();
    }

    applyPinOrPos() {
      const c = this.container; c.style.left = ""; c.style.right = ""; c.style.top = "";
      if (this.pos && this.pinSide === "free") {
        c.style.left = this.pos.left + "px";
        c.style.top = this.pos.top + "px";
      } else if (this.pinSide === "left") {
        c.style.left = "12px"; c.style.right = "auto"; c.style.top = "12px";
      } else {
        c.style.right = "12px"; c.style.left = "auto"; c.style.top = "12px";
      }
      this.positionToggleBtn();
    }

    positionToggleBtn() {
      if (!this.toggleBtn) return;
      let topPx = 12;
      try {
        const rect = this.container.getBoundingClientRect();
        if (rect && Number.isFinite(rect.top)) {
          topPx = Math.max(12, Math.min(window.innerHeight - 52, rect.top));
        }
      } catch {}
      this.toggleBtn.style.top = topPx + "px";
      if (this.pinSide === "left") { this.toggleBtn.style.left = "12px"; this.toggleBtn.style.right = "auto"; }
      else if (this.pinSide === "right") { this.toggleBtn.style.right = "12px"; this.toggleBtn.style.left = "auto"; }
      else {
        try {
          const rect = this.container.getBoundingClientRect();
          const stickRight = rect.left > window.innerWidth / 2;
          if (stickRight) { this.toggleBtn.style.right = "12px"; this.toggleBtn.style.left = "auto"; }
          else { this.toggleBtn.style.left = "12px"; this.toggleBtn.style.right = "auto"; }
        } catch { this.toggleBtn.style.right = "12px"; this.toggleBtn.style.left = "auto"; }
      }
    }
    showToggleBtn(){ this.toggleBtn?.classList.add("show"); this.positionToggleBtn(); }
    hideToggleBtn(){ this.toggleBtn?.classList.remove("show"); }

    // ==== render ====
    renderContentWithMath(element) {
      const tryRender = () => {
        try {
          if (UW.MathJax?.typesetPromise) UW.MathJax.typesetPromise([element]).catch(() => {});
          else if (UW.MathJax?.Hub) UW.MathJax.Hub.Queue(["Typeset", UW.MathJax.Hub, element]);
        } catch (e) { console.error("Math render error:", e); }
      };
      setTimeout(tryRender, 50);
      setTimeout(tryRender, 250);
      setTimeout(tryRender, 600);
    }

    getAnswersAsDOM(question) {
      const listElement = document.createElement("ul");
      if (question.json_content) {
        try {
          const jsonData = JSON.parse(question.json_content);
          const correctNodes = [];
          const collect = (node) => {
            if (!node || typeof node !== "object") return;
            if (node.type === "olm-list-item" && node.correct === true) correctNodes.push(node);
            if (Array.isArray(node.children)) node.children.forEach(collect);
          };
          collect(jsonData.root);
          const extractText = (node) => {
            if (!node) return "";
            let out = ""; if (typeof node.text === "string") out += node.text;
            if (Array.isArray(node.children)) for (const ch of node.children) out += extractText(ch);
            return out;
          };
          if (correctNodes.length > 0) {
            correctNodes.forEach((n) => {
              const li = document.createElement("li"); li.className = "correct-answer";
              li.innerHTML = extractText(n).trim(); listElement.appendChild(li);
            });
            return listElement;
          }
        } catch (e) { console.error("Lỗi phân tích JSON:", e); }
      }
      // HTML cũ
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = decodeBase64Utf8(question.content || "");
      const correctAnswers = tempDiv.querySelectorAll(".correctAnswer");
      if (correctAnswers.length > 0) {
        correctAnswers.forEach((ans) => {
          const li = document.createElement("li"); li.className = "correct-answer";
          while (ans.firstChild) li.appendChild(ans.firstChild.cloneNode(true));
          listElement.appendChild(li);
        });
        return listElement;
      }
      const fillInInput = tempDiv.querySelector("input[data-accept]");
      if (fillInInput) {
        fillInInput.getAttribute("data-accept").split("|").forEach((a) => {
          const li = document.createElement("li"); li.className = "correct-answer"; li.textContent = a.trim();
          listElement.appendChild(li);
        });
        return listElement;
      }
      return null;
    }

    getSolutionAsDOM(decodedContent) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = decodedContent;
      const solutionNode = tempDiv.querySelector(".loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in");
      return solutionNode ? solutionNode.cloneNode(true) : null;
    }

    renderData(data) {
      if (!Array.isArray(data)) return;
      const responseContainer = document.createElement("div");
      const timestamp = new Date().toLocaleTimeString();
      responseContainer.innerHTML = `<p style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.06);padding:6px;border-radius:6px;"><b>Time:</b> ${timestamp}</p>`;

      data.forEach((question) => {
        let decodedContent = decodeBase64Utf8(question.content || "");
        decodedContent = mildLatexFix(decodedContent);

        const answersElement = this.getAnswersAsDOM(question);
        const solutionElement = this.getSolutionAsDOM(decodedContent);

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = decodedContent;
        tempDiv.querySelectorAll("ol.quiz-list, ul.quiz-list, .interaction, .form-group, .loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in").forEach(el => el.remove());

        const questionDiv = document.createElement("div"); questionDiv.className = "qa-block";

        const qaTop = document.createElement("div"); qaTop.className = "qa-top";
        const questionDisplayContainer = document.createElement("div"); questionDisplayContainer.className = "question-content";

        const indexSpan = document.createElement("span"); indexSpan.className = "q-index"; indexSpan.textContent = "Câu ?. ";
        questionDisplayContainer.appendChild(indexSpan);
        while (tempDiv.firstChild) questionDisplayContainer.appendChild(tempDiv.firstChild);
        if (!questionDisplayContainer.hasChildNodes() && question.title) questionDisplayContainer.innerHTML = `<span class="q-index">Câu ?. </span>${question.title}`;

        const actions = document.createElement("div"); actions.className = "qa-actions";
        const pill = document.createElement("div"); pill.className = "pill"; pill.textContent = answersElement ? "Đ" : solutionElement ? "L" : "?";
        if (answersElement) pill.classList.add("ok"); else if (solutionElement) pill.classList.add("sol");

        const toggleOne = document.createElement("button"); toggleOne.className = "toggle-one"; toggleOne.textContent = "Thu gọn";
        toggleOne.addEventListener("click", () => {
          contentContainer.style.display = contentContainer.style.display === "none" ? "" : "none";
          toggleOne.textContent = contentContainer.style.display === "none" ? "Mở rộng" : "Thu gọn";
          if (contentContainer.style.display !== "none") this.renderContentWithMath(contentContainer);
        });

        const copyAns = document.createElement("button"); copyAns.className = "copy-btn"; copyAns.textContent = "Copy đáp án"; copyAns.title = "Copy đáp án / lời giải";
        copyAns.addEventListener("click", () => {
          const txt = (contentContainer ? contentContainer.innerText : "").trim(); if (!txt) return;
          const doCopy = () => navigator.clipboard?.writeText(txt).then(() => { copyAns.textContent = "Copied"; setTimeout(() => (copyAns.textContent = "Copy đáp án"), 900); })
          .catch(() => { const ta = document.createElement("textarea"); ta.value = txt; ensureBody(ta); ta.select(); try { document.execCommand("copy"); copyAns.textContent = "Copied"; } catch(e) {} ta.remove(); setTimeout(() => (copyAns.textContent = "Copy đáp án"), 900); });
          doCopy();
        });

        const copyQ = document.createElement("button"); copyQ.className = "copy-q"; copyQ.textContent = "Copy câu hỏi";
        copyQ.addEventListener("click", () => {
          const txt = (questionDisplayContainer?.innerText || "").trim(); if (!txt) return;
          navigator.clipboard?.writeText(txt).catch(() => { const ta = document.createElement("textarea"); ta.value = txt; ensureBody(ta); ta.select(); document.execCommand("copy"); ta.remove(); });
        });

        actions.append(pill, toggleOne, copyQ, copyAns);
        qaTop.append(questionDisplayContainer, actions);

        const contentContainer = document.createElement("div"); contentContainer.className = "content-container";
        if (answersElement) { contentContainer.dataset.type = "answer"; contentContainer.appendChild(answersElement); }
        else if (solutionElement) { contentContainer.dataset.type = "solution"; contentContainer.appendChild(solutionElement); }
        else { contentContainer.dataset.type = "not-found"; const nf = document.createElement("div"); nf.className = "not-found"; nf.textContent = "Không tìm thấy đáp án hay lời giải."; contentContainer.appendChild(nf); }

        questionDiv.append(qaTop, contentContainer);
        responseContainer.appendChild(questionDiv);
      });

      this.contentArea.prepend(responseContainer);
      this.renumber(); this.updateCounts(); this.renderContentWithMath(this.contentArea);
      const kw = this.searchInput?.value?.trim(); if (kw) highlightInElement(this.contentArea, kw);
    }

    renumber() {
      const blocks = this.contentArea.querySelectorAll(".qa-block");
      let idx = 1;
      blocks.forEach((b) => {
        if (b.style.display === "none") return;
        const sp = b.querySelector(".q-index"); if (sp) sp.textContent = `Câu ${idx}. `;
        idx++;
      });
    }
    updateCounts() {
      const cnt = this.contentArea.querySelectorAll(".qa-block").length;
      const shown = [...this.contentArea.querySelectorAll(".qa-block")].filter(b => b.style.display !== "none").length;
      this.countBadge.textContent = `${shown} / ${cnt} hiển thị`;
      this.metaInfo.textContent = `${cnt} câu`;
    }
    filterQuestions(keyword) {
      const q = (keyword || "").trim().toLowerCase();
      const blocks = this.contentArea.querySelectorAll(".qa-block");
      let shown = 0;
      blocks.forEach((b) => {
        highlightInElement(b, "");
        const text = b.innerText.toLowerCase();
        const match = !q || text.includes(q);
        b.style.display = match ? "" : "none";
        if (match) { shown++; if (q) highlightInElement(b, q); }
      });
      this.countBadge.textContent = `${shown} / ${blocks.length} hiển thị`;
      this.renumber(); this.renderContentWithMath(this.contentArea);
    }
  }

  const answerUI = new AnswerDisplay();
  answerUI.init();

  // ===== Network hooks (robust for mobile) =====
  const originalFetch = UW.fetch.bind(UW);
  UW.fetch = function (...args) {
    const requestUrl = args[0] instanceof Request ? args[0].url : args[0];
    const p = originalFetch(...args);
    try {
      if (typeof requestUrl === "string" && requestUrl.includes(TARGET_URL_KEYWORD)) {
        p.then((response) => {
          if (response && response.ok) {
            response.clone().json().then((data) => answerUI.renderData(data)).catch((err) => console.error(err));
          }
        }).catch(() => {});
      }
    } catch (e) { console.error(e); }
    return p;
  };

  const origOpen = UW.XMLHttpRequest.prototype.open;
  const origSend = UW.XMLHttpRequest.prototype.send;
  UW.XMLHttpRequest.prototype.open = function (...args) {
    this._olm_url = args[1] || ""; return origOpen.apply(this, args);
  };
  UW.XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if ((this._olm_url || this.responseURL || "").includes(TARGET_URL_KEYWORD) && this.status === 200) {
          try { const data = JSON.parse(this.responseText); answerUI.renderData(data); } catch (e) { console.error(e); }
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };
})();
