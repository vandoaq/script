// ==UserScript==
// @name         OLM Helper
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Hack Đáp Án OLM by Đòn Hư Lém
// @author       Đòn Hư Lém
// @match        https://olm.vn/chu-de/*
// @grant        unsafeWindow
// @run-at       document-start
// @icon         https://play-lh.googleusercontent.com/PMA5MRr5DUJBUbDgdUn6arbGXteDjRBIZVO3P3z9154Kud2slXPjy-iiPwwKfvZhc4o=w240-h480-rw
// ==/UserScript==

(function () {
  "use strict";

  const TARGET_URL_KEYWORD = "get-question-of-ids";
  const LS_SIZE = "olm_size";
  const LS_POS = "olm_pos";
  const LS_DARK = "olm_dark";
  const LS_PIN = "olm_pin"; // 'right' | 'left' | 'free'
  const HIGHLIGHT_CLASS = "olm-hl";

  // ---------- Math engine: MathJax v3 ----------
  function ensureMathJax() {
    if (unsafeWindow.MathJax) return;
    const cfg = document.createElement("script");
    cfg.type = "text/javascript";
    cfg.text = `
      window.MathJax = {
        tex: {
          inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
          displayMath: [['$$','$$'], ['\\\\[','\\\\]']],
          processEscapes: true,
          processEnvironments: true
        },
        options: {
          skipHtmlTags: ['noscript','style','textarea','pre','code'],
          ignoreHtmlClass: 'no-mathjax',
          renderActions: { addMenu: [] }
        },
        startup: { typeset: false }
      };
    `;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    document.head.appendChild(cfg);
    document.head.appendChild(s);
  }
  ensureMathJax();

  // ---------- Helpers ----------
  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function decodeBase64Utf8(base64) {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      console.error("Lỗi giải mã Base64:", e);
      return "Lỗi giải mã nội dung!";
    }
  }

  // vá cặp $/$$ bị lệch nhẹ
  function mildLatexFix(html) {
    return html
      .replace(/\$\$([^$]+)\$(?!\$)/g, "$$$$${1}$$")
      .replace(/\$(?!\$)([^$]+)\$\$/g, "$$${1}$$");
  }

  // Highlight giữ DOM
  function highlightInElement(el, keyword) {
    el.querySelectorAll("." + HIGHLIGHT_CLASS).forEach(n => {
      const parent = n.parentNode;
      while (n.firstChild) parent.insertBefore(n.firstChild, n);
      parent.removeChild(n);
      parent.normalize?.();
    });
    if (!keyword) return;

    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let node;
    while ((node = walk.nextNode())) {
      const t = node.nodeValue;
      if (!t || !t.trim()) continue;
      let m, last = 0, pieces = [];
      while ((m = regex.exec(t))) {
        pieces.push(document.createTextNode(t.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        mark.textContent = t.slice(m.index, m.index + m[0].length);
        pieces.push(mark);
        last = m.index + m[0].length;
      }
      if (pieces.length) {
        pieces.push(document.createTextNode(t.slice(last)));
        const frag = document.createDocumentFragment();
        pieces.forEach(p => frag.appendChild(p));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  // ---------- UI ----------
  class AnswerDisplay {
    constructor() {
      this.isVisible = true;
      this.dragState = { isDragging: false, startX: 0, startY: 0, initialX: 0, initialY: 0 };
      this.size = { w: 520, h: Math.round(window.innerHeight * 0.7) };
      this.pos = null; // {left, top} khi free
      this.pinSide = localStorage.getItem(LS_PIN) || "right";
      this.dark = (() => {
        const saved = localStorage.getItem(LS_DARK);
        if (saved !== null) return saved === "1";
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
      })();

      try {
        const saved = JSON.parse(localStorage.getItem(LS_SIZE) || "null");
        if (saved && saved.w && saved.h) this.size = saved;
      } catch {}
      try {
        const savedPos = JSON.parse(localStorage.getItem(LS_POS) || "null");
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) this.pos = savedPos;
      } catch {}

      // binds
      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseMove = this.onMouseMove.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.exportToTxt = this.exportToTxt.bind(this);
      this.filterQuestions = this.filterQuestions.bind(this);
      this.filterDebounced = debounce(this.filterQuestions, 140);
      this.renumber = this.renumber.bind(this);
      this.renderContentWithMath = this.renderContentWithMath.bind(this);
      this.toggleDarkMode = this.toggleDarkMode.bind(this);
      this.togglePinSide = this.togglePinSide.bind(this);
      this.copyAllVisibleAnswers = this.copyAllVisibleAnswers.bind(this);
      this.onResizeDown = this.onResizeDown.bind(this);
      this.onResizeMove = this.onResizeMove.bind(this);
      this.onResizeUp = this.onResizeUp.bind(this);

      // new
      this.toggleVisibility = this.toggleVisibility.bind(this);
      this.showToggleBtn = this.showToggleBtn.bind(this);
      this.hideToggleBtn = this.hideToggleBtn.bind(this);
      this.positionToggleBtn = this.positionToggleBtn.bind(this);
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
      const styles = `
        :root{
          --panel-w: 520px;
          --panel-h: 70vh;
          --glass-border: rgba(255,255,255,0.6);
          --accent: #6c63ff;
          --accent-2: #00c2ff;
          --muted: #6b7280;
          --success: #10b981;
          --danger: #ef4444;
          --bg-glass: linear-gradient(135deg, rgba(255,255,255,0.62), rgba(245,248,255,0.5));
          --bg-top: linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.28));
          --bg-sub: rgba(255,255,255,0.4);
          --shadow: 0 10px 30px rgba(17,24,39,0.25);
          --text-main: #0f172a;
          --text-sub: #334155;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        }
        #olm-answers-container {
          position: fixed; top: 18px;
          width: var(--panel-w); height: var(--panel-h);
          z-index: 2147483647; display: flex; flex-direction: column;
          border-radius: 14px; overflow: hidden;
          backdrop-filter: blur(10px) saturate(120%);
          background: var(--bg-glass);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow);
          transition: transform 180ms ease, opacity 180ms ease, left 120ms, right 120ms;
          color: var(--text-main); user-select: none; min-width: 340px;
          max-width: calc(100vw - 36px); max-height: calc(100vh - 36px);
        }
        #olm-answers-container.hidden { opacity: 0; transform: translateY(-6px) scale(0.98); pointer-events: none; }

        /* dark */
        #olm-answers-container.olm-dark{
          --glass-border: rgba(255,255,255,0.12);
          --bg-glass: linear-gradient(135deg, rgba(24,26,33,0.65), rgba(24,28,37,0.52));
          --bg-top: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.04));
          --bg-sub: rgba(255,255,255,0.08);
          --shadow: 0 10px 30px rgba(0,0,0,0.55);
          --text-main: #e5e7eb;
          --text-sub: #cbd5e1;
        }

        .olm-topbar { display:flex; align-items:center; gap:10px; padding:12px 14px;
          background: var(--bg-top);
          border-bottom: 1px solid rgba(0,0,0,0.06); cursor: grab; }
        #olm-answers-container.olm-dark .olm-topbar{ border-bottom-color: rgba(255,255,255,0.06); }

        .olm-brand { display:flex; align-items:center; gap:10px; }
        .olm-logo { width:36px; height:36px; border-radius:10px; display:flex;
          align-items:center; justify-content:center; font-weight:700;
          background: linear-gradient(135deg,var(--accent),var(--accent-2)); color:white; }
        .olm-title { font-size:14px; font-weight:700; line-height:1; }
        .olm-sub { font-size:11px; color:var(--muted); }
        .olm-controls { margin-left:auto; display:flex; gap:8px; align-items:center; }
        .olm-btn { background: transparent; border: 1px solid rgba(11,17,26,0.08); padding:6px 8px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:12px; }
        #olm-answers-container.olm-dark .olm-btn{ border-color: rgba(255,255,255,0.12); color:var(--text-main); }
        .olm-btn:focus{ outline: 2px solid rgba(99,102,241,0.3); }

        .search-wrap { display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid rgba(0,0,0,0.06);
          background: var(--bg-sub); }
        #olm-answers-container.olm-dark .search-wrap{ border-bottom-color: rgba(255,255,255,0.06); }
        .search-input { flex:1; padding:8px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.06); outline:none; background: rgba(255,255,255,0.8); font-size:13px; }
        #olm-answers-container.olm-dark .search-input{ background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); color: var(--text-main); }
        .meta { font-size:12px; color:var(--muted); min-width:80px; text-align:right; }

        #olm-answers-content { padding: 12px; overflow-y: auto; flex:1; display:flex; flex-direction:column; gap:10px; }
        .qa-block { display:flex; flex-direction:column; gap:8px; padding:12px; border-radius:10px;
          background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(248,250,255,0.8));
          border: 1px solid rgba(15,23,42,0.05); box-shadow: 0 2px 8px rgba(12,18,39,0.04); }
        #olm-answers-container.olm-dark .qa-block{
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.04));
          border-color: rgba(255,255,255,0.08);
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .qa-top { display:flex; align-items:flex-start; gap:10px; }
        .question-content { font-weight:700; color:var(--text-main); font-size:14px; flex:1; }
        .q-index { margin-right: 6px; color:var(--text-sub); }
        .qa-actions { display:flex; gap:6px; align-items:center; margin-left:auto; }

        .pill { font-size:11px; padding:3px 7px; border-radius:999px; color:white; background:#64748b; user-select:none; }
        .pill.ok { background: var(--success); }
        .pill.sol { background: #3b82f6; }

        .content-container { padding-left:6px; color:#0b3c49; font-size:13px; }
        #olm-answers-container.olm-dark .content-container{ color: var(--text-main); }
        .content-container ul { margin:6px 0; padding-left:18px; }
        .content-container li { margin:4px 0; }

        .content-container[data-type="answer"] { font-weight: 600; }
        .content-container[data-type="answer"] li,
        .content-container[data-type="answer"] p,
        .content-container[data-type="answer"] span,
        .content-container[data-type="answer"] .correct-answer { color: var(--success) !important; }

        .footer-bar { padding:10px 12px; display:flex; align-items:center; gap:8px; border-top:1px solid rgba(0,0,0,0.06);
          background: var(--bg-sub); }
        #olm-answers-container.olm-dark .footer-bar{ border-top-color: rgba(255,255,255,0.08); }
        #export-btn { padding:8px 12px; border-radius:10px; border:1px solid rgba(11,17,26,0.08); cursor:pointer; font-weight:700;
          background:linear-gradient(90deg,var(--accent),var(--accent-2)); color:white; box-shadow: 0 8px 24px rgba(108,99,255,0.15); }
        #olm-answers-container.olm-dark #export-btn{ border-color: rgba(255,255,255,0.12); }
        #count-badge { font-weight:700; color:var(--muted); margin-left:auto; font-size:13px; }

        .small-ghost { background:transparent; padding:6px; border-radius:8px; border:1px solid rgba(11,17,26,0.08); }
        .copy-btn { background: var(--success); color:white; border-radius:8px; padding:6px 8px; border:none; cursor:pointer; font-size:12px; }
        .copy-q { background: #94a3b8; color:white; border-radius:8px; padding:6px 8px; border:none; cursor:pointer; font-size:12px; }
        .toggle-one { background: transparent; border: 1px dashed rgba(11,17,26,0.2); color: var(--text-main); border-radius:8px; padding:5px 8px; cursor:pointer; font-size:12px; }
        #olm-answers-container.olm-dark .toggle-one{ border-color: rgba(255,255,255,0.2); }

        .not-found { color:var(--muted); font-style:italic; }

        .resize-handle{
          position:absolute; right:6px; bottom:6px;
          width:14px; height:14px; cursor: nwse-resize;
          border-right:2px solid rgba(0,0,0,0.25);
          border-bottom:2px solid rgba(0,0,0,0.25);
          opacity:.7;
        }
        #olm-answers-container.olm-dark .resize-handle{
          border-right-color: rgba(255,255,255,0.35);
          border-bottom-color: rgba(255,255,255,0.35);
        }
        #olm-answers-container.resizing{ user-select:none; pointer-events:auto; }

        mark.${HIGHLIGHT_CLASS}{
          background: rgba(250, 204, 21, 0.35);
          padding: 0 2px; border-radius: 3px;
        }

        @media (max-width: 520px) { #olm-answers-container { right:8px; left:8px; width: auto; height: 68vh; } }

        /* ===== Floating toggle button when panel hidden ===== */
        #olm-toggle-btn{
          position: fixed;
          top: 18px;
          right: 18px;
          width: 36px; height: 36px;
          border-radius: 999px;
          display: none; align-items: center; justify-content: center;
          z-index: 2147483647;
          border: 1px solid var(--glass-border);
          backdrop-filter: blur(10px) saturate(120%);
          background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(240,245,255,0.8));
          box-shadow: var(--shadow);
          cursor: pointer;
          user-select: none;
          font-weight: 800;
          font-size: 11px;
          color: #111827;
        }
        #olm-answers-container.olm-dark ~ #olm-toggle-btn{
          border-color: rgba(255,255,255,0.12);
          background: linear-gradient(135deg, rgba(40,44,52,0.9), rgba(40,44,52,0.8));
          color: #e5e7eb;
        }
        #olm-toggle-btn.show{ display:flex; }
        #olm-toggle-btn:active{ transform: scale(0.98); }
      `;
      const style = document.createElement("style");
      style.textContent = styles;
      document.head.appendChild(style);
    }

    createUI() {
      this.container = document.createElement("div");
      this.container.id = "olm-answers-container";
      this.container.style.width = this.size.w + "px";
      this.container.style.height = this.size.h + "px";

      // Topbar
      const topbar = document.createElement("div");
      topbar.className = "olm-topbar";
      topbar.dataset.dragHandle = "true";

      const brand = document.createElement("div");
      brand.className = "olm-brand";
      const logo = document.createElement("div");
      logo.className = "olm-logo";
      logo.textContent = "OLM";
      const titleWrap = document.createElement("div");
      const title = document.createElement("div");
      title.className = "olm-title";
      title.textContent = "OLM Helper";
      const sub = document.createElement("div");
      sub.className = "olm-sub";
      sub.textContent = "Edit by Đòn Hư Lém";
      titleWrap.appendChild(title);
      titleWrap.appendChild(sub);
      brand.appendChild(logo);
      brand.appendChild(titleWrap);

      const controls = document.createElement("div");
      controls.className = "olm-controls";

      const pinBtn = document.createElement("button");
      pinBtn.className = "olm-btn";
      pinBtn.title = "Ghim trái/phải (Alt G)";
      pinBtn.textContent = this.pinSide === "right" ? "Ghim phải" : this.pinSide === "left" ? "Ghim trái" : "Thả tự do";
      pinBtn.addEventListener("click", this.togglePinSide);

      const darkBtn = document.createElement("button");
      darkBtn.className = "olm-btn";
      darkBtn.title = "Dark mode (Alt D)";
      darkBtn.textContent = this.dark ? "Dark: On" : "Dark: Off";
      darkBtn.addEventListener("click", this.toggleDarkMode);

      const collapseBtn = document.createElement("button");
      collapseBtn.className = "olm-btn";
      collapseBtn.title = "Ẩn/Hiện (Shift phải)";
      collapseBtn.textContent = "Ẩn/Hiện";
      collapseBtn.addEventListener("click", () => this.toggleVisibility());

      const exportBtnTop = document.createElement("button");
      exportBtnTop.id = "export-btn";
      exportBtnTop.textContent = "Xuất TXT";
      exportBtnTop.addEventListener("click", this.exportToTxt);

      controls.appendChild(pinBtn);
      controls.appendChild(darkBtn);
      controls.appendChild(collapseBtn);
      controls.appendChild(exportBtnTop);

      topbar.appendChild(brand);
      topbar.appendChild(controls);

      // Search
      const searchWrap = document.createElement("div");
      searchWrap.className = "search-wrap";
      const searchInput = document.createElement("input");
      searchInput.className = "search-input";
      searchInput.placeholder = "Tìm theo từ khóa (Alt F để focus)";
      searchInput.addEventListener("input", (e) => this.filterDebounced(e.target.value));
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.id = "meta-info";
      meta.textContent = "0 câu";
      searchWrap.appendChild(searchInput);
      searchWrap.appendChild(meta);

      // Content
      this.contentArea = document.createElement("div");
      this.contentArea.id = "olm-answers-content";

      // Footer
      const footer = document.createElement("div");
      footer.className = "footer-bar";
      const hint = document.createElement("div");
      hint.style.fontSize = "12px";
      hint.style.color = "var(--muted)";
      hint.textContent = "Shift phải: ẩn/hiện • Alt F: tìm • Alt A: copy đáp án hiển thị";
      const countBadge = document.createElement("div");
      countBadge.id = "count-badge";
      countBadge.textContent = "0 câu";
      footer.appendChild(hint);
      footer.appendChild(countBadge);

      this.container.appendChild(topbar);
      this.container.appendChild(searchWrap);
      this.container.appendChild(this.contentArea);
      this.container.appendChild(footer);

      // Resize handle
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      handle.title = "Kéo để thay đổi kích thước";
      handle.addEventListener("mousedown", this.onResizeDown);
      this.container.appendChild(handle);
      this.resizeHandle = handle;

      const appendToBody = () => document.body.appendChild(this.container);
      if (document.body) appendToBody();
      else window.addEventListener("DOMContentLoaded", appendToBody);

      this.topbar = topbar;
      this.searchInput = searchInput;
      this.countBadge = countBadge;
      this.metaInfo = meta;
      this.pinBtn = pinBtn;
      this.darkBtn = darkBtn;

      // ===== Create floating toggle button =====
      const tbtn = document.createElement("div");
      tbtn.id = "olm-toggle-btn";
      tbtn.title = "Hiện OLM Helper";
      tbtn.textContent = "OLM";
      tbtn.addEventListener("click", () => {
        this.isVisible = true;
        this.container.classList.remove("hidden");
        this.hideToggleBtn();
      });
      const addToggle = () => document.body.appendChild(tbtn);
      if (document.body) addToggle(); else window.addEventListener("DOMContentLoaded", addToggle);
      this.toggleBtn = tbtn;
    }

    applyPinOrPos() {
      const c = this.container;
      c.style.left = "";
      c.style.right = "";
      c.style.top = "";

      if (this.pos && this.pinSide === "free") {
        c.style.left = this.pos.left + "px";
        c.style.top = this.pos.top + "px";
      } else if (this.pinSide === "left") {
        c.style.left = "18px";
        c.style.right = "auto";
        c.style.top = "18px";
      } else {
        c.style.right = "18px";
        c.style.left = "auto";
        c.style.top = "18px";
      }
      this.positionToggleBtn();
    }

    positionToggleBtn() {
      if (!this.toggleBtn) return;
      // default top alignment with container’s top; side follows pinSide
      let topPx = 18;
      try {
        const rect = this.container.getBoundingClientRect();
        if (rect && Number.isFinite(rect.top)) {
          topPx = Math.max(12, Math.min(window.innerHeight - 48, rect.top));
        }
      } catch {}
      this.toggleBtn.style.top = topPx + "px";

      if (this.pinSide === "left") {
        this.toggleBtn.style.left = "18px";
        this.toggleBtn.style.right = "auto";
      } else if (this.pinSide === "right") {
        this.toggleBtn.style.right = "18px";
        this.toggleBtn.style.left = "auto";
      } else {
        // free: stick to nearest side based on current panel x
        try {
          const rect = this.container.getBoundingClientRect();
          const stickRight = rect.left > window.innerWidth / 2;
          if (stickRight) {
            this.toggleBtn.style.right = "18px";
            this.toggleBtn.style.left = "auto";
          } else {
            this.toggleBtn.style.left = "18px";
            this.toggleBtn.style.right = "auto";
          }
        } catch {
          this.toggleBtn.style.right = "18px";
          this.toggleBtn.style.left = "auto";
        }
      }
    }

    showToggleBtn() { this.toggleBtn?.classList.add("show"); this.positionToggleBtn(); }
    hideToggleBtn() { this.toggleBtn?.classList.remove("show"); }

    addEventListeners() {
      setTimeout(() => {
        this.topbar.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("keydown", this.onKeyDown);
        document.getElementById("export-btn")?.addEventListener("click", this.exportToTxt);
        window.addEventListener("resize", this.positionToggleBtn);
        window.addEventListener("scroll", this.positionToggleBtn, { passive: true });
      }, 300);
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
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
      navigator.clipboard?.writeText(out).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = out; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      });
    }

    onMouseDown(event) {
      if (event.target.closest(".olm-controls")) return;
      this.dragState.isDragging = true;

      const rect = this.container.getBoundingClientRect();
      this.container.style.right = "auto";
      this.container.style.left = `${rect.left}px`;
      this.container.style.top = `${rect.top}px`;
      this.container.style.width = rect.width + "px";
      this.container.style.height = rect.height + "px";

      this.pinSide = "free";
      localStorage.setItem(LS_PIN, this.pinSide);

      this.dragState.initialX = rect.left;
      this.dragState.initialY = rect.top;
      this.dragState.startX = event.clientX;
      this.dragState.startY = event.clientY;
      window.addEventListener("mousemove", this.onMouseMove);
      window.addEventListener("mouseup", this.onMouseUp);
      this.container.style.transition = "none";
    }
    onMouseMove(event) {
      if (!this.dragState.isDragging) return;
      event.preventDefault();
      const dx = event.clientX - this.dragState.startX;
      const dy = event.clientY - this.dragState.startY;
      const left = this.dragState.initialX + dx;
      const top = this.dragState.initialY + dy;
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
      this.positionToggleBtn();
    }
    onMouseUp() {
      this.dragState.isDragging = false;
      window.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mouseup", this.onMouseUp);
      this.container.style.transition = "";
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      try { localStorage.setItem(LS_POS, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })); } catch {}
      this.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      this.positionToggleBtn();
    }

    onKeyDown(event) {
      if (event.code === "ShiftRight") this.toggleVisibility();
      if (event.altKey && !event.shiftKey && !event.ctrlKey) {
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          this.searchInput.focus();
          this.searchInput.select();
        } else if (event.key.toLowerCase() === "a") {
          event.preventDefault();
          this.copyAllVisibleAnswers();
        } else if (event.key.toLowerCase() === "d") {
          event.preventDefault();
          this.toggleDarkMode();
        } else if (event.key.toLowerCase() === "g") {
          event.preventDefault();
          this.togglePinSide();
        }
      }
    }

    toggleVisibility() {
      this.isVisible = !this.isVisible;
      this.container.classList.toggle("hidden", !this.isVisible);
      if (this.isVisible) this.hideToggleBtn();
      else this.showToggleBtn();
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

    // ---------- Answer extraction ----------
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
            let out = "";
            if (typeof node.text === "string") out += node.text;
            if (Array.isArray(node.children)) for (const ch of node.children) out += extractText(ch);
            return out;
          };

          if (correctNodes.length > 0) {
            correctNodes.forEach((n) => {
              const li = document.createElement("li");
              li.className = "correct-answer";
              li.innerHTML = extractText(n).trim();
              listElement.appendChild(li);
            });
            return listElement;
          }
        } catch (e) {
          console.error("Lỗi phân tích JSON:", e);
        }
      }

      // HTML cũ
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = decodeBase64Utf8(question.content || "");
      const correctAnswers = tempDiv.querySelectorAll(".correctAnswer");
      if (correctAnswers.length > 0) {
        correctAnswers.forEach((ans) => {
          const li = document.createElement("li");
          li.className = "correct-answer";
          while (ans.firstChild) li.appendChild(ans.firstChild.cloneNode(true));
          listElement.appendChild(li);
        });
        return listElement;
      }
      const fillInInput = tempDiv.querySelector("input[data-accept]");
      if (fillInInput) {
        fillInInput.getAttribute("data-accept").split("|").forEach((a) => {
          const li = document.createElement("li");
          li.className = "correct-answer";
          li.textContent = a.trim();
          listElement.appendChild(li);
        });
        return listElement;
      }
      return null;
    }

    getSolutionAsDOM(decodedContent) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = decodedContent;
      const solutionNode = tempDiv.querySelector(
        ".loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in"
      );
      return solutionNode ? solutionNode.cloneNode(true) : null;
    }

    renderContentWithMath(element) {
      const tryRender = () => {
        try {
          if (unsafeWindow.MathJax && unsafeWindow.MathJax.typesetPromise) {
            unsafeWindow.MathJax.typesetPromise([element]).catch(() => {});
          } else if (unsafeWindow.MathJax && unsafeWindow.MathJax.Hub) {
            unsafeWindow.MathJax.Hub.Queue(["Typeset", unsafeWindow.MathJax.Hub, element]);
          }
        } catch (e) {
          console.error("Math render error:", e);
        }
      };
      setTimeout(tryRender, 50);
      setTimeout(tryRender, 250);
      setTimeout(tryRender, 600);
    }

    // ---------- Render packet ----------
    renderData(data) {
      if (!Array.isArray(data)) return;
      const responseContainer = document.createElement("div");
      const timestamp = new Date().toLocaleTimeString();
      responseContainer.innerHTML = `<p style="font-family: monospace; font-size: 12px; background: rgba(0,0,0,0.06); padding: 6px; border-radius: 6px;"><b>Time:</b> ${timestamp}</p>`;

      data.forEach((question) => {
        let decodedContent = decodeBase64Utf8(question.content || "");
        decodedContent = mildLatexFix(decodedContent);

        const answersElement = this.getAnswersAsDOM(question);
        const solutionElement = this.getSolutionAsDOM(decodedContent);

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = decodedContent;
        tempDiv.querySelectorAll(
          "ol.quiz-list, ul.quiz-list, .interaction, .form-group, .loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in"
        ).forEach((el) => el.remove());

        const questionDiv = document.createElement("div");
        questionDiv.className = "qa-block";

        const qaTop = document.createElement("div");
        qaTop.className = "qa-top";

        const questionDisplayContainer = document.createElement("div");
        questionDisplayContainer.className = "question-content";

        const indexSpan = document.createElement("span");
        indexSpan.className = "q-index";
        indexSpan.textContent = "Câu ?. ";
        questionDisplayContainer.appendChild(indexSpan);

        while (tempDiv.firstChild) questionDisplayContainer.appendChild(tempDiv.firstChild);
        if (!questionDisplayContainer.hasChildNodes() && question.title)
          questionDisplayContainer.innerHTML = `<span class="q-index">Câu ?. </span>${question.title}`;

        const actions = document.createElement("div");
        actions.className = "qa-actions";

        const pill = document.createElement("div");
        pill.className = "pill";
        pill.textContent = answersElement ? "Đ" : solutionElement ? "L" : "?";
        if (answersElement) pill.classList.add("ok");
        else if (solutionElement) pill.classList.add("sol");

        const toggleOne = document.createElement("button");
        toggleOne.className = "toggle-one";
        toggleOne.textContent = "Thu gọn";
        toggleOne.addEventListener("click", () => {
          contentContainer.style.display = contentContainer.style.display === "none" ? "" : "none";
          toggleOne.textContent = contentContainer.style.display === "none" ? "Mở rộng" : "Thu gọn";
          if (contentContainer.style.display !== "none") this.renderContentWithMath(contentContainer);
        });

        const copyAns = document.createElement("button");
        copyAns.className = "copy-btn";
        copyAns.textContent = "Copy đáp án";
        copyAns.title = "Copy đáp án / lời giải";
        copyAns.addEventListener("click", () => {
          const txt = (contentContainer ? contentContainer.innerText : "").trim();
          if (!txt) return;
          navigator.clipboard?.writeText(txt).then(() => {
            copyAns.textContent = "Copied";
            setTimeout(() => (copyAns.textContent = "Copy đáp án"), 900);
          }).catch(() => {
            const ta = document.createElement("textarea");
            ta.value = txt; document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); copyAns.textContent = "Copied"; } catch(e) {}
            document.body.removeChild(ta);
            setTimeout(() => (copyAns.textContent = "Copy đáp án"), 900);
          });
        });

        const copyQ = document.createElement("button");
        copyQ.className = "copy-q";
        copyQ.textContent = "Copy câu hỏi";
        copyQ.addEventListener("click", () => {
          const txt = (questionDisplayContainer?.innerText || "").trim();
          if (!txt) return;
          navigator.clipboard?.writeText(txt).catch(() => {
            const ta = document.createElement("textarea");
            ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
          });
        });

        actions.appendChild(pill);
        actions.appendChild(toggleOne);
        actions.appendChild(copyQ);
        actions.appendChild(copyAns);

        qaTop.appendChild(questionDisplayContainer);
        qaTop.appendChild(actions);

        const contentContainer = document.createElement("div");
        contentContainer.className = "content-container";

        if (answersElement) {
          contentContainer.dataset.type = "answer";
          contentContainer.appendChild(answersElement);
        } else if (solutionElement) {
          contentContainer.dataset.type = "solution";
          contentContainer.appendChild(solutionElement);
        } else {
          contentContainer.dataset.type = "not-found";
          const nf = document.createElement("div");
          nf.className = "not-found";
          nf.textContent = "Không tìm thấy đáp án hay lời giải.";
          contentContainer.appendChild(nf);
        }

        questionDiv.appendChild(qaTop);
        questionDiv.appendChild(contentContainer);
        responseContainer.appendChild(questionDiv);
      });

      this.contentArea.prepend(responseContainer);
      this.renumber();
      this.updateCounts();
      this.renderContentWithMath(this.contentArea);

      const kw = this.searchInput?.value?.trim();
      if (kw) highlightInElement(this.contentArea, kw);
    }

    renumber() {
      const blocks = this.contentArea.querySelectorAll(".qa-block");
      let idx = 1;
      blocks.forEach((b) => {
        if (b.style.display === "none") return;
        const sp = b.querySelector(".q-index");
        if (sp) sp.textContent = `Câu ${idx}. `;
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
        highlightInElement(b, ""); // clear
        const text = b.innerText.toLowerCase();
        const match = !q || text.includes(q);
        b.style.display = match ? "" : "none";
        if (match) {
          shown++;
          if (q) highlightInElement(b, q);
        }
      });
      this.countBadge.textContent = `${shown} / ${blocks.length} hiển thị`;
      this.renumber();
      this.renderContentWithMath(this.contentArea);
    }

    onResizeDown(e){
      e.preventDefault();
      this.container.classList.add('resizing');
      this.resizeState = {
        startX: e.clientX,
        startY: e.clientY,
        startW: this.container.getBoundingClientRect().width,
        startH: this.container.getBoundingClientRect().height
      };
      window.addEventListener('mousemove', this.onResizeMove);
      window.addEventListener('mouseup', this.onResizeUp);
    }

    onResizeMove(e){
      if (!this.resizeState) return;
      const minW = 340, minH = 260;
      const maxW = Math.min(window.innerWidth - 24, 1200);
      const maxH = Math.min(window.innerHeight - 24, 1000);

      let newW = this.resizeState.startW + (e.clientX - this.resizeState.startX);
      let newH = this.resizeState.startH + (e.clientY - this.resizeState.startY);
      newW = Math.max(minW, Math.min(maxW, newW));
      newH = Math.max(minH, Math.min(maxH, newH));

      this.container.style.width = newW + 'px';
      this.container.style.height = newH + 'px';
      this.positionToggleBtn();
    }

    onResizeUp(){
      if (!this.resizeState) return;
      this.container.classList.remove('resizing');
      window.removeEventListener('mousemove', this.onResizeMove);
      window.removeEventListener('mouseup', this.onResizeUp);
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      this.resizeState = null;
      this.positionToggleBtn();
    }
  }

  const answerUI = new AnswerDisplay();
  answerUI.init();

  // ---------- Network hooks ----------
  const originalFetch = unsafeWindow.fetch;
  unsafeWindow.fetch = function (...args) {
    const requestUrl = args[0] instanceof Request ? args[0].url : args[0];
    const p = originalFetch.apply(this, args);
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

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (this.responseURL?.includes(TARGET_URL_KEYWORD) && this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            answerUI.renderData(data);
          } catch (e) { console.error(e); }
        }
      } catch (e) {}
    });
    return originalSend.apply(this, args);
  };
})();
