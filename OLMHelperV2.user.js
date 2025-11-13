// ==UserScript==
// @name         OLM Helper V3
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Panel đáp án/solution hiển thị tốt trên PC & điện thoại.
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

  const TOGGLE_ICON_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTMdM9MEQ0ExL1PmInT3U5I8v63YXBEdoIT0Q&s";
  const BRAND_LINK_URL = "https://vandoaq.github.io";

  const UW = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
  const TARGET_URL_KEYWORD = "get-question-of-ids";
  const LS_SIZE = "olm_size";
  const LS_POS  = "olm_pos";
  const LS_DARK = "olm_dark";
  const LS_TOGGLE_POS = "olm_toggle_pos";
  const LS_STEALTH = "olm_stealth";
  const LS_AUTO_SEARCH = "olm_auto_search";
  const HIGHLIGHT_CLASS = "olm-hl";

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
  const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

  const COPY_UNLOCK_EVENTS = ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart", "mousedown", "mouseup", "keydown", "keyup", "beforecopy"];
  const COPY_ATTRS = ["oncopy", "oncut", "onpaste", "oncontextmenu", "onselectstart", "ondragstart", "onmousedown", "onmouseup", "onkeydown", "onkeyup", "onbeforecopy", "onbeforecut", "onbeforepaste", "style"];
  const STEALTH_EVENTS = ["visibilitychange", "webkitvisibilitychange", "pagehide", "freeze", "blur", "focusout"];
  let STEALTH_ACTIVE = false;

  function injectCopyUnlockCSS() {
    if (document.documentElement.querySelector("style[data-olm-copy-unlock]")) return;
    const css = document.createElement("style");
    css.dataset.olmCopyUnlock = "1";
    css.textContent = `
      html, body, body *:not(input):not(textarea):not([contenteditable="true"]) {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
        -webkit-touch-callout: default !important;
        touch-action: auto !important;
      }
      input, textarea, [contenteditable="true"] {
        -webkit-user-select: auto !important;
        -moz-user-select: auto !important;
        -ms-user-select: auto !important;
        user-select: auto !important;
      }
    `.trim();
    ensureHead(css);
  }

  function scrubNodeRestrictions(node) {
    if (!(node instanceof Element)) return;
    COPY_ATTRS.forEach((attr) => {
      if (attr === "style") return;
      if (node.hasAttribute(attr)) node.removeAttribute(attr);
      if (attr in node) {
        try { node[attr] = null; } catch {}
      }
    });
    const style = node.style;
    if (!style) return;
    style.removeProperty("user-select");
    style.removeProperty("-moz-user-select");
    style.removeProperty("-ms-user-select");
    style.removeProperty("-webkit-user-drag");
    style.removeProperty("-webkit-user-select");
    style.removeProperty("-webkit-touch-callout");
    style.removeProperty("touch-action");
  }

  function scrubTree(root) {
    if (!root) return;
    if (root instanceof Element) scrubNodeRestrictions(root);
    const scope = root.querySelectorAll ? root.querySelectorAll("*") : [];
    scope.forEach(scrubNodeRestrictions);
  }

  function installCopyUnlock() {
    const swallow = (evt) => {
      if (!evt) return;
      if (typeof evt.stopImmediatePropagation === "function") evt.stopImmediatePropagation();
      if (typeof evt.stopPropagation === "function") evt.stopPropagation();
      evt.cancelBubble = true;
    };
    COPY_UNLOCK_EVENTS.forEach((evtName) => {
      window.addEventListener(evtName, swallow, { capture: true });
      document.addEventListener(evtName, swallow, { capture: true });
    });

    scrubTree(document.documentElement);
    ready(() => scrubTree(document.body || document.documentElement));

    if (typeof MutationObserver === "function") {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            scrubNodeRestrictions(mutation.target);
          } else if (mutation.type === "childList") {
            mutation.addedNodes.forEach((node) => scrubTree(node));
          }
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: COPY_ATTRS
      });
    }
  }

  function disableNativeAlerts() {
    const targets = new Set([window]);
    if (UW && UW !== window) targets.add(UW);
    targets.forEach((target) => {
      if (!target || typeof target.alert !== "function") return;
      const original = target.alert;
      const silentAlert = function (...args) {
        console.debug("[OLMHelper] Alert suppressed:", args[0]);
      };
      try { silentAlert.toString = original.toString.bind(original); } catch {}
      try { Object.defineProperty(silentAlert, "name", { value: "alert" }); } catch {}
      target.alert = silentAlert;
    });
  }

  injectCopyUnlockCSS();
  installCopyUnlock();
  disableNativeAlerts();

  const stealthEventHandler = (evt) => {
    if (!STEALTH_ACTIVE) return;
    evt.stopImmediatePropagation?.();
    evt.stopPropagation?.();
    evt.preventDefault?.();
  };

  function setStealthActive(flag) {
    STEALTH_ACTIVE = !!flag;
  }

  function installStealthGuards() {
    if (installStealthGuards._done) return;
    installStealthGuards._done = true;
    try {
      STEALTH_EVENTS.forEach((evt) => {
        document.addEventListener(evt, stealthEventHandler, true);
        window.addEventListener(evt, stealthEventHandler, true);
      });
    } catch (e) {
      console.error("installStealthGuards error:", e);
    }
    patchVisibilityProps();
  }

  function patchVisibilityProps() {
    if (patchVisibilityProps._done) return;
    patchVisibilityProps._done = true;
    const docProto = Object.getPrototypeOf(document);
    const visDesc = docProto ? Object.getOwnPropertyDescriptor(docProto, "visibilityState") : null;
    const hiddenDesc = docProto ? Object.getOwnPropertyDescriptor(docProto, "hidden") : null;
    const getVis = visDesc?.get ? visDesc.get.bind(document) : null;
    const getHidden = hiddenDesc?.get ? hiddenDesc.get.bind(document) : null;

    try {
      if (visDesc && visDesc.configurable !== false) {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          enumerable: visDesc.enumerable,
          get() {
            if (STEALTH_ACTIVE) return "visible";
            return getVis ? getVis() : (visDesc.value ?? "visible");
          }
        });
      }
    } catch (e) {
      console.warn("Failed to override document.visibilityState:", e);
    }

    try {
      if (hiddenDesc && hiddenDesc.configurable !== false) {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          enumerable: hiddenDesc.enumerable,
          get() {
            if (STEALTH_ACTIVE) return false;
            return getHidden ? getHidden() : !!hiddenDesc.value;
          }
        });
      }
    } catch (e) {
      console.warn("Failed to override document.hidden:", e);
    }
  }

  installStealthGuards();

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

  // --- Helper: remove leading '#' from text nodes inside an element ---
  function stripLeadingHashesFromElement(rootEl) {
    try {
      // Walk through text nodes only and strip ^\s*#\s*
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        node.nodeValue = node.nodeValue.replace(/^\s*#\s*/g, '');
      }
    } catch (e) {
      console.error("stripLeadingHashesFromElement error:", e);
    }
  }

  // --- Helper: remove known noisy meta lines like "p.shuffle=0" ---
  function removeNoiseMetaLines(rootEl) {
    try {
      if (!rootEl) return;
      // Accept variants: spaces, optional dot, with trailing semicolon/comma/period
      // Examples: "p.shuffle=0", "p . shuffle = 0;", "P Shuffle = 0" etc.
      const re = /^\s*p\s*\.?\s*shuffle\s*=\s*0\s*[;:,\.]*\s*$/i;

      const toRemove = new Set();

      // 1) Remove elements whose entire text matches the noise line
      const candidates = rootEl.querySelectorAll('p,div,span,li,em,strong,b,i,u');
      candidates.forEach(el => {
        const txt = (el.textContent || '').trim();
        if (txt && re.test(txt)) toRemove.add(el);
      });

      // 2) Also scan stray text nodes (e.g., inside containers with <br>)
      const textWalker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
      let tnode;
      while ((tnode = textWalker.nextNode())) {
        const txt = (tnode.nodeValue || '').trim();
        if (!txt) continue;
        if (re.test(txt)) {
          const parent = tnode.parentNode;
          // If parent only contains this text (plus whitespace), remove parent; otherwise remove the text node
          if (parent && parent.childNodes.length === 1) toRemove.add(parent); else toRemove.add(tnode);
        }
      }

      toRemove.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) n.remove(); else n.remove();
      });
    } catch (e) {
      console.error("removeNoiseMetaLines error:", e);
    }
  }

  function encodeSvgToDataUri(svgMarkup) {
    try {
      const bytes = new TextEncoder().encode(svgMarkup);
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const encoded = window.btoa(binary);
      return `data:image/svg+xml;base64,${encoded}`;
    } catch (e) {
      console.error("encodeSvgToDataUri error:", e);
      return "";
    }
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

  // MathJax
  function ensureMathJax() {
    if (UW.MathJax) return;
    const cfg = document.createElement("script");
    cfg.type = "text/javascript";
    cfg.text = `
      window.MathJax = {
        tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']], processEscapes: true, processEnvironments: true },
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

  // html2pdf
  let html2pdfReadyPromise = null;
  function ensureHtml2Pdf() {
    if (UW.html2pdf) return Promise.resolve();
    if (html2pdfReadyPromise) return html2pdfReadyPromise;
    html2pdfReadyPromise = new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
      sc.async = true;
      sc.onload = () => res();
      sc.onerror = () => rej(new Error("Không tải được html2pdf.js"));
      ensureHead(sc);
    });
    return html2pdfReadyPromise;
  }

  class AnswerDisplay {
    constructor() {
      this.isVisible = true;

      this.dragState = { dragging: false, startX: 0, startY: 0, initX: 0, initY: 0 };
      this.resizeState = null;

      const defaultH = Math.max(340, Math.round(window.innerHeight * 0.66));
      this.size = { w: Math.min(520, Math.max(340, Math.round(window.innerWidth * 0.9))), h: defaultH };
      this.pos = null;

      this.toggleDrag = { dragging: false, startX: 0, startY: 0, initL: 0, initT: 0 };
      this.togglePos = (() => {
        try { const p = JSON.parse(localStorage.getItem(LS_TOGGLE_POS) || "null"); if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) return p; } catch {}
        return null;
      })();

      this.dark = (() => {
        const saved = localStorage.getItem(LS_DARK);
        if (saved !== null) return saved === "1";
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
      })();
      this.stealthMode = (() => {
        const saved = localStorage.getItem(LS_STEALTH);
        return saved === "1";
      })();
      setStealthActive(this.stealthMode);
      this.autoSearchEnabled = (() => {
        const saved = localStorage.getItem(LS_AUTO_SEARCH);
        if (saved === null) return true;
        return saved === "1";
      })();

      try { const saved = JSON.parse(localStorage.getItem(LS_SIZE) || "null"); if (saved?.w && saved?.h) this.size = saved; } catch {}
      try { const p = JSON.parse(localStorage.getItem(LS_POS)  || "null"); if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) this.pos = p; } catch {}

      this.filterDebounced = debounce(this.filterQuestions.bind(this), 140);

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onPointerDownDrag = this.onPointerDownDrag.bind(this);
      this.onPointerMoveDrag = this.onPointerMoveDrag.bind(this);
      this.onPointerUpDrag   = this.onPointerUpDrag.bind(this);
      this.onPointerDownResize = this.onPointerDownResize.bind(this);
      this.onPointerMoveResize = this.onPointerMoveResize.bind(this);
      this.onPointerUpResize   = this.onPointerUpResize.bind(this);
      this.onWindowResize      = this.onWindowResize.bind(this);

      // Drag nút toggle
      this.onPointerDownToggle = this.onPointerDownToggle.bind(this);
      this.onPointerMoveToggle = this.onPointerMoveToggle.bind(this);
      this.onPointerUpToggle   = this.onPointerUpToggle.bind(this);

      this.handleSelectionChange = this.handleSelectionChange.bind(this);
      this.lastSelectionText = "";
      this.onControlsSliderInput = this.onControlsSliderInput.bind(this);
      this.syncControlsSlider = this.syncControlsSlider.bind(this);
      this.updateControlsSliderState = this.updateControlsSliderState.bind(this);

      // Track passages already rendered to avoid duplicates across questions
      this.renderedPassages = new Set();
      this.controlsRow = null;
      this.controlsSlider = null;
      this.autoSearchBtn = null;
    }

    init() {
      this.injectCSS();
      this.createUI();
      this.addEventListeners();
      if (this.dark) this.container.classList.add("olm-dark");
      this.applyPosOnly();
      this.ensureContainerInViewport();
      this.applyTogglePos();  // đặt vị trí nút nổi nếu có
      this.applyAutoSearchState(this.autoSearchEnabled);
      this.applyStealthMode(this.stealthMode);
    }

    injectCSS() {
      const css = `
        :root{
          --panel-w: 520px;
          --panel-h: 70vh;
          --glass-border: rgba(0,0,0,0.12);
          --bg-glass: #ffffffcc;
          --bg-top: #ffffffaa;
          --bg-sub: #ffffff88;
          --shadow: 0 10px 24px rgba(17,24,39,0.18);
          --text-main: #0f172a;
          --text-sub: #334155;
          --muted: #6b7280;
          --btn-bg: #f3f4f6;
          --btn-fg: #111827;
          --btn-border: #d1d5db;
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
          --bg-glass: rgba(27,31,40,0.75);
          --bg-top: rgba(255,255,255,0.06);
          --bg-sub: rgba(255,255,255,0.08);
          --shadow: 0 10px 30px rgba(0,0,0,0.55);
          --text-main: #e5e7eb; --text-sub: #f1f5f9;
          --btn-bg: #1f2937;
          --btn-fg: #e5e7eb;
          --btn-border: #4b5563;
          --muted: #e2e8f0;
        }

        .olm-topbar{
          display:flex; flex-direction:column; gap:6px;
          padding:10px 12px; background: var(--bg-top);
          border-bottom: 1px solid rgba(0,0,0,0.06); touch-action: none;
        }
        #olm-answers-container.olm-dark .olm-topbar{ border-bottom-color: rgba(255,255,255,0.06); }

        .olm-header{ display:flex; align-items:center; gap:10px; }
        .olm-brand{ display:flex; align-items:center; gap:10px; }
        .olm-logo{
          width:28px; height:28px; border-radius:6px; overflow:hidden; flex:0 0 auto;
          background:#eee;
        }
        .olm-logo img{ width:100%; height:100%; object-fit:cover; display:block; }
        .olm-title-line{ display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
        .olm-title-line .tt-strong{ font-size:14px; font-weight:800; }
        .olm-title-line .tt-sub{ font-size:12px; color: var(--muted); }
        .olm-title-line .tt-sub .brand-link{
          color: inherit;
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-decoration-color: currentColor;
          transition: color .15s ease, text-shadow .15s ease;
        }
        .olm-title-line .tt-sub .brand-link:hover{
          color: #fbbf24;
          text-shadow: 0 0 8px rgba(251,191,36,0.7);
        }

        .olm-controls-wrap{
          display:flex; flex-direction:column; gap:4px; position:relative; width:100%;
        }
        .olm-controls-row{
          display:flex; gap:8px; align-items:center; flex-wrap:nowrap;
          overflow-x:auto; -webkit-overflow-scrolling: touch; padding-top:2px;
          scrollbar-width: none;
        }
        .olm-controls-row::-webkit-scrollbar{ height:0; }
        .olm-controls-row .olm-btn{ flex:0 0 auto; min-width:max-content; }
        #olm-answers-container .controls-slider{
          width:100%;
          height:6px;
          border-radius:999px;
          background:linear-gradient(90deg,rgba(15,23,42,0.15),rgba(15,23,42,0.05));
          appearance:none;
          border:none;
          outline:none;
          cursor:pointer;
          order:-1;
          margin-bottom:4px;
          box-shadow:inset 0 1px 2px rgba(15,23,42,0.2);
        }
        #olm-answers-container .controls-slider:focus-visible{
          box-shadow:0 0 0 2px rgba(59,130,246,0.35), inset 0 1px 2px rgba(15,23,42,0.2);
        }
        #olm-answers-container .controls-slider::-webkit-slider-runnable-track{
          height:6px; border-radius:999px; background:transparent;
        }
        #olm-answers-container .controls-slider::-webkit-slider-thumb{
          appearance:none;
          width:18px; height:18px; border-radius:50%;
          background:radial-gradient(circle at 30% 30%, #fafcff, #dbeafe);
          border:1px solid rgba(37,99,235,0.6);
          box-shadow:0 4px 10px rgba(15,23,42,0.25);
          margin-top:-6px;
        }
        #olm-answers-container .controls-slider::-moz-range-track{
          height:6px; border-radius:999px; background:transparent;
        }
        #olm-answers-container .controls-slider::-moz-range-thumb{
          width:18px; height:18px; border-radius:50%;
          border:1px solid rgba(37,99,235,0.6);
          background:radial-gradient(circle at 30% 30%, #fafcff, #dbeafe);
          box-shadow:0 4px 10px rgba(15,23,42,0.25);
        }
        #olm-answers-container.olm-dark .controls-slider{
          background:linear-gradient(90deg,rgba(255,255,255,0.18),rgba(255,255,255,0.08));
          box-shadow:inset 0 1px 2px rgba(0,0,0,0.35);
        }
        #olm-answers-container.olm-dark .controls-slider:focus-visible{
          box-shadow:0 0 0 2px rgba(14,165,233,0.35), inset 0 1px 2px rgba(0,0,0,0.35);
        }
        #olm-answers-container.olm-dark .controls-slider::-webkit-slider-thumb,
        #olm-answers-container.olm-dark .controls-slider::-moz-range-thumb{
          border:1px solid rgba(125,211,252,0.8);
          background:radial-gradient(circle at 30% 30%, #f0f9ff, #0f172a);
          box-shadow:0 4px 12px rgba(8,145,178,0.45);
        }

        /* Nút riêng namespace #olm-answers-container để không ảnh hưởng web */
        #olm-answers-container .olm-btn{
          appearance: button;
          border: 1px solid var(--btn-border);
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          display:inline-flex; align-items:center; gap:6px;
          cursor:pointer;
          background: var(--btn-bg);
          color: var(--btn-fg);
          white-space: nowrap;
          user-select:none;
          position:relative;
          overflow:hidden;
          transition: background .2s ease, color .2s ease, box-shadow .2s ease, transform .2s ease;
        }
        #olm-answers-container .olm-btn svg{ fill: currentColor; }
        #olm-answers-container .olm-btn:active{ transform: translateY(1px); }
        #olm-answers-container .olm-btn.is-ghost{
          background: transparent;
          color: var(--text-main);
          border-color: var(--btn-border);
        }
        #olm-answers-container.olm-dark .olm-btn.is-ghost{ color: var(--text-main); }
        #olm-answers-container .olm-btn.glow-toggle{
          background:#fff;
          color:#0f172a;
          border:1px solid rgba(15,23,42,0.12);
          box-shadow:0 1px 2px rgba(15,23,42,0.08);
        }
        #olm-answers-container .olm-btn.glow-toggle:hover,
        #olm-answers-container .olm-btn.glow-toggle:focus-visible{
          box-shadow:0 0 0 1px rgba(37,99,235,0.35);
        }
        #olm-answers-container.olm-dark .olm-btn.glow-toggle{
          background:transparent;
          color:var(--text-main);
          border:1px solid rgba(148,163,184,0.45);
          box-shadow:0 0 0 1px rgba(15,23,42,0.6);
        }
        #olm-answers-container .olm-btn.glow-toggle.is-active{
          border:1px solid transparent;
          background:
            linear-gradient(#fff,#fff) padding-box,
            linear-gradient(130deg,#2563eb,#06b6d4,#a855f7,#f97316,#facc15,#2563eb) border-box;
          background-size:100% 100%, 280% 280%;
          background-position:0 0, 0% 50%;
          color:#0f172a;
          box-shadow:0 0 20px rgba(37,99,235,0.35);
          animation:glowSweep 3s linear infinite;
        }
        #olm-answers-container .olm-btn.glow-toggle.is-active::after{
          content:"";
          position:absolute;
          inset:2px;
          border-radius:inherit;
          border:1px solid rgba(255,255,255,0.4);
          pointer-events:none;
        }
        #olm-answers-container.olm-dark .olm-btn.glow-toggle.is-active{
          background:
            linear-gradient(rgba(8,11,20,0.9),rgba(8,11,20,0.9)) padding-box,
            linear-gradient(130deg,#38bdf8,#a855f7,#f97316,#facc15,#38bdf8) border-box;
          color:#f8fafc;
          box-shadow:0 0 24px rgba(14,165,233,0.5);
        }
        #olm-answers-container.olm-dark .olm-btn.glow-toggle.is-active::after{
          border-color:rgba(148,163,184,0.55);
        }
        @keyframes glowSweep{
          0%{ background-position:0 0, 0% 50%; }
          100%{ background-position:0 0, 300% 50%; }
        }

        .search-wrap{ display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid rgba(0,0,0,0.06); background: var(--bg-sub); }
        #olm-answers-container.olm-dark .search-wrap{ border-bottom-color: rgba(255,255,255,0.06); }
        .search-input{ flex:1; padding:8px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.06); outline:none; background: rgba(255,255,255,0.85); font-size:13px; color:#111827; }
        #olm-answers-container.olm-dark .search-input{ background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); color: var(--text-main); }
        .meta{ font-size:12px; color: var(--muted); min-width:74px; text-align:right; }

        #olm-answers-content{ padding:10px; overflow-y:auto; -webkit-overflow-scrolling: touch; flex:1; display:flex; flex-direction:column; gap:10px; }
        .qa-block{ display:flex; flex-direction:column; gap:8px; padding:12px; border-radius:10px; background: #ffffffdd; border:1px solid rgba(15,23,42,0.05); page-break-inside: avoid; break-inside: avoid; }
        #olm-answers-container.olm-dark .qa-block{ background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.08); }

        /* Passage shown once for a group of questions */
        .passage-block{ display:block; padding:12px; border-radius:10px; background:rgba(255,255,255,0.9); border:1px dashed rgba(15,23,42,0.15); color: var(--text-main); }
        #olm-answers-container.olm-dark .passage-block{ background:rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); }

        .qa-top{ display:flex; align-items:flex-start; gap:10px; }
        .question-content{ font-weight:700; color:var(--text-main); font-size:14px; flex:1; }
        .q-index{ margin-right:6px; color: var(--text-sub); }
        .content-container{ padding-left:6px; color:#0b3c49; font-size:13px; }
        #olm-answers-container.olm-dark .content-container{ color: var(--text-main); }
        .content-container[data-type="answer"]{ font-weight:600; }
        .content-container[data-type="answer"] .correct-answer{ color: #10b981 !important; }

        .footer-bar{ padding:8px 10px; display:flex; align-items:center; gap:8px; border-top:1px solid rgba(0,0,0,0.06); background: var(--bg-sub); }
        #olm-answers-container.olm-dark .footer-bar{ border-top-color: rgba(255,255,255,0.08); }
        #count-badge{ font-weight:700; color:var(--muted); margin-left:auto; font-size:13px; }

        .resize-handle{ position:absolute; right:8px; bottom:8px; width:18px; height:18px; cursor: nwse-resize;
          border-right:2px solid rgba(0,0,0,0.25); border-bottom:2px solid rgba(0,0,0,0.25); opacity:.7; touch-action: none; }
        #olm-answers-container.olm-dark .resize-handle{ border-right-color: rgba(255,255,255,0.35); border-bottom-color: rgba(255,255,255,0.35); }
        #olm-answers-container.resizing{ user-select:none; }

        mark.${HIGHLIGHT_CLASS}{ background: rgba(250, 204, 21, 0.35); padding: 0 2px; border-radius: 3px; }

        @media (max-width: 520px){
          #olm-answers-container{ left: 12px !important; right: 12px !important; width: auto !important; height: 66vh !important; }
          .question-content{ font-size:13px; }
          .olm-controls-row{ gap:6px; }
          #olm-answers-container .olm-btn{ padding:6px 8px; font-size:12px; }
        }

        /* Floating toggle - draggable + img icon */
        #olm-toggle-btn{
          position: fixed;
          top: max(12px, env(safe-area-inset-top));
          right: 12px;
          width: 46px; height: 46px;
          border-radius: 999px;
          display:none; align-items:center; justify-content:center;
          z-index: 2147483647;
          border: 1px solid rgba(0,0,0,0.12);
          -webkit-backdrop-filter: blur(10px) saturate(120%);
          backdrop-filter: blur(10px) saturate(120%);
          background: #ffffffee;
          box-shadow: 0 10px 24px rgba(17,24,39,0.18);
          cursor: grab; user-select: none;
          touch-action: none; /* để kéo mượt trên mobile */
        }
        #olm-toggle-btn:active{ cursor: grabbing; transform: scale(.98); }
        #olm-toggle-btn.show{ display:flex; }
        #olm-toggle-btn img{ width: 70%; height: 70%; object-fit: cover; border-radius: 999px; pointer-events: none; }
        /* Dark follow */
        #olm-answers-container.olm-dark ~ #olm-toggle-btn{
          border-color: rgba(255,255,255,0.12);
          background: rgba(40,44,52,0.92);
        }

        /* PDF helpers */
        .pdf-root{ width: 900px; max-width: 100%; margin: 0 auto; }
        .pdf-spacer{ height: 32px; }
        mjx-container{ page-break-inside: avoid; break-inside: avoid; }
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

      // Topbar
      const topbar = document.createElement("div");
      topbar.className = "olm-topbar";
      topbar.addEventListener("pointerdown", this.onPointerDownDrag);

      // Header
      const header = document.createElement("div");
      header.className = "olm-header";

      const brand = document.createElement("div");
      brand.className = "olm-brand";

      const logo = document.createElement("div");
      logo.className = "olm-logo";
      const logoImg = document.createElement("img");
      logoImg.src = "https://play-lh.googleusercontent.com/PMA5MRr5DUJBUbDgdUn6arbGXteDjRBIZVO3P3z9154Kud2slXPjy-iiPwwKfvZhc4o=w240-h480-rw";
      logoImg.alt = "OLM logo";
      logo.appendChild(logoImg);

      const titleLine = document.createElement("div");
      titleLine.className = "olm-title-line";
      const ttStrong = document.createElement("span");
      ttStrong.className = "tt-strong";
      ttStrong.textContent = "OLM Helper";
      const ttSub = document.createElement("span");
      ttSub.className = "tt-sub";
      const brandLink = document.createElement("a");
      brandLink.className = "brand-link";
      brandLink.textContent = "Đòn Hư Lém";
      brandLink.href = BRAND_LINK_URL || "#";
      brandLink.rel = "noopener";
      if (BRAND_LINK_URL) brandLink.target = "_blank";
      ttSub.append("by ", brandLink);
      titleLine.append(ttStrong, ttSub);

      brand.append(logo, titleLine);
      header.append(brand);

      // Controls
      const controlsRow = document.createElement("div");
      controlsRow.className = "olm-controls-row";
      const controlsWrap = document.createElement("div");
      controlsWrap.className = "olm-controls-wrap";

      const darkBtn = document.createElement("button");
      darkBtn.className = "olm-btn is-ghost"; darkBtn.title = "Dark mode"; darkBtn.setAttribute("aria-label","Toggle dark mode");
      darkBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
      darkBtn.addEventListener("click", () => this.toggleDarkMode());

      const stealthBtn = document.createElement("button");
      stealthBtn.className = "olm-btn glow-toggle";
      stealthBtn.title = "Chế độ chống phát hiện khi rời tab/app";
      stealthBtn.textContent = "Stealth";
      stealthBtn.addEventListener("click", () => this.toggleStealthMode());
      const autoSearchBtn = document.createElement("button");
      autoSearchBtn.className = "olm-btn glow-toggle";
      autoSearchBtn.title = "Bat/tat tu dong tim kiem khi boi den";
      autoSearchBtn.textContent = "Auto Search";
      autoSearchBtn.addEventListener("click", () => this.toggleAutoSearch());

      const collapseBtn = document.createElement("button");
      collapseBtn.className = "olm-btn is-ghost"; collapseBtn.title = "Ẩn/Hiện";
      collapseBtn.textContent = "Hide";
      collapseBtn.addEventListener("click", () => this.toggleVisibility());

      const exportTxtBtn = document.createElement("button");
      exportTxtBtn.id = "export-btn"; exportTxtBtn.className = "olm-btn";
      exportTxtBtn.textContent = "TXT";
      exportTxtBtn.addEventListener("click", () => this.exportToTxt());

      const exportPdfBtn = document.createElement("button");
      exportPdfBtn.id = "export-pdf-btn"; exportPdfBtn.className = "olm-btn";
      exportPdfBtn.textContent = "PDF";
      exportPdfBtn.addEventListener("click", () => this.exportToPDF());

      const exportWordBtn = document.createElement("button");
      exportWordBtn.id = "export-word-btn"; exportWordBtn.className = "olm-btn";
      exportWordBtn.textContent = "WORD";
      exportWordBtn.addEventListener("click", (event) => this.downloadWordFile(event));

      const exportWordV2Btn = document.createElement("button");
      exportWordV2Btn.id = "export-word-v2-btn"; exportWordV2Btn.className = "olm-btn";
      exportWordV2Btn.textContent = "WORD V2";
      exportWordV2Btn.addEventListener("click", (event) => this.exportWordV2(event));

      controlsRow.append(darkBtn, collapseBtn, stealthBtn, autoSearchBtn, exportTxtBtn, exportPdfBtn, exportWordBtn, exportWordV2Btn);
      const controlsSlider = document.createElement("input");
      controlsSlider.type = "range";
      controlsSlider.min = "0";
      controlsSlider.max = "100";
      controlsSlider.value = "0";
      controlsSlider.className = "controls-slider";
      controlsSlider.title = "Keo de xem them nut";
      controlsSlider.setAttribute("aria-label", "Keo de xem them nut");
      controlsSlider.hidden = true;
      controlsSlider.addEventListener("pointerdown", (evt) => evt.stopPropagation());
      controlsSlider.addEventListener("keydown", (evt) => evt.stopPropagation());
      controlsSlider.addEventListener("input", this.onControlsSliderInput);
      controlsRow.addEventListener("scroll", this.syncControlsSlider, { passive: true });
      controlsWrap.append(controlsSlider, controlsRow);
      topbar.append(header, controlsWrap);

      // Search
      const searchWrap = document.createElement("div"); searchWrap.className = "search-wrap";
      const searchInput = document.createElement("input");
      searchInput.className = "search-input";
      searchInput.placeholder = "Tìm theo từ khóa";
      searchInput.addEventListener("input", (e) => this.filterDebounced(e.target.value));
      const meta = document.createElement("div"); meta.className = "meta"; meta.id = "meta-info"; meta.textContent = "0 câu";
      searchWrap.append(searchInput, meta);

      // Content
      this.contentArea = document.createElement("div"); this.contentArea.id = "olm-answers-content";

      // Footer
      const footer = document.createElement("div"); footer.className = "footer-bar";
      const hint = document.createElement("div"); hint.style.fontSize = "12px"; hint.style.color = "var(--muted)";
      hint.textContent = "Note* Word có bài không dùng được • WordV2 lỗi hiển thị công thức Toán";
      const countBadge = document.createElement("div"); countBadge.id = "count-badge"; countBadge.textContent = "0 câu";
      footer.append(hint, countBadge);

      // Resize handle
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
      this.darkBtn = darkBtn;
      this.stealthBtn = stealthBtn;
      this.autoSearchBtn = autoSearchBtn;
      this.controlsRow = controlsRow;
      this.controlsSlider = controlsSlider;
      this.updateControlsSliderState();

      // Floating toggle (draggable + icon img)
      const tbtn = document.createElement("div");
      tbtn.id = "olm-toggle-btn"; tbtn.title = "Hiện OLM Helper";
      const timg = document.createElement("img");
      timg.alt = "Toggle OLM Helper";
      timg.src = TOGGLE_ICON_URL;
      tbtn.appendChild(timg);

      // Click để hiện panel
      tbtn.addEventListener("click", (e) => {
        // Nếu vừa kéo thì bỏ click (để không bị bật panel khi thả tay)
        if (tbtn.__dragging) return;
        this.isVisible = true; this.container.classList.remove("hidden"); this.hideToggleBtn();
      });

      // Kéo nút (pointer events)
      tbtn.addEventListener("pointerdown", this.onPointerDownToggle);
      ensureBody(tbtn);
      this.toggleBtn = tbtn;
    }

    addEventListeners() {
      window.addEventListener("keydown", this.onKeyDown);
      // Đảm bảo panel & nút không trượt ra ngoài khi đổi kích thước màn hình
      window.addEventListener("resize", this.onWindowResize);
      window.addEventListener("scroll", () => {}, { passive: true });
      document.addEventListener("selectionchange", this.handleSelectionChange);
    }

    onWindowResize() {
      this.ensureContainerInViewport();
      this.boundToggleInside();
      this.updateControlsSliderState();
    }

    handleSelectionChange() {
      if (!this.autoSearchEnabled || !this.searchInput || !this.filterDebounced) return;
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text || text.length > 200) return;
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if ((anchor && this.container?.contains(anchor)) || (focus && this.container?.contains(focus))) return;
      if (text === this.lastSelectionText) return;
      this.lastSelectionText = text;
      this.searchInput.value = text;
      this.filterDebounced(text);
    }

    onControlsSliderInput(event) {
      if (!this.controlsRow) return;
      const maxScroll = this.controlsRow.scrollWidth - this.controlsRow.clientWidth;
      if (maxScroll <= 0) return;
      const slider = event.currentTarget;
      const value = Number(slider?.value ?? 0);
      this.controlsRow.scrollLeft = Math.max(0, Math.min(maxScroll, (value / 100) * maxScroll));
    }

    syncControlsSlider() {
      if (!this.controlsRow || !this.controlsSlider || this.controlsSlider.hidden) return;
      const maxScroll = this.controlsRow.scrollWidth - this.controlsRow.clientWidth;
      if (maxScroll <= 0) {
        if (this.controlsSlider.value !== "0") this.controlsSlider.value = "0";
        return;
      }
      const ratio = this.controlsRow.scrollLeft / maxScroll;
      const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      const next = String(pct);
      if (this.controlsSlider.value !== next) this.controlsSlider.value = next;
    }

    updateControlsSliderState() {
      if (!this.controlsRow || !this.controlsSlider) return;
      const maxScroll = this.controlsRow.scrollWidth - this.controlsRow.clientWidth;
      const needsSlider = maxScroll > 4;
      this.controlsSlider.hidden = !needsSlider;
      if (!needsSlider) {
        this.controlsSlider.value = "0";
        this.controlsRow.scrollLeft = 0;
        return;
      }
      this.syncControlsSlider();
    }

    /* ===== Drag & resize panel ===== */
    onPointerDownDrag(e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const rect = this.container.getBoundingClientRect();
      this.container.style.right = "auto";
      this.container.style.left  = `${rect.left}px`;
      this.container.style.top   = `${rect.top}px`;
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
      const rect = this.container.getBoundingClientRect();
      const maxL = window.innerWidth - rect.width - 6;
      const maxT = window.innerHeight - rect.height - 6;
      left = Math.max(6, Math.min(maxL, left));
      top  = Math.max(6, Math.min(maxT,  top));
      this.container.style.left = `${left}px`;
      this.container.style.top  = `${top}px`;
    }
    onPointerUpDrag() {
      this.dragState.dragging = false;
      window.removeEventListener("pointermove", this.onPointerMoveDrag);
      window.removeEventListener("pointerup", this.onPointerUpDrag);
      this.container.style.transition = "";
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      try { localStorage.setItem(LS_POS,  JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })); } catch {}
      this.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
    }

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
      this.container.style.width  = newW + 'px';
      this.container.style.height = newH + 'px';
      this.updateControlsSliderState();
    }
    onPointerUpResize(){
      if (!this.resizeState) return;
      this.container.classList.remove('resizing');
      window.removeEventListener('pointermove', this.onPointerMoveResize);
      window.removeEventListener('pointerup', this.onPointerUpResize);
      const rect = this.container.getBoundingClientRect();
      this.size = { w: Math.round(rect.width), h: Math.round(rect.height) };
      try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      this.updateControlsSliderState();
      this.resizeState = null;
    }

    /* ===== DRAG NÚT TOGGLE ===== */
    onPointerDownToggle(e) {
      // Cho phép kéo với mọi pointer
      e.preventDefault();
      const rect = this.toggleBtn.getBoundingClientRect();
      this.toggleDrag.dragging = true;
      this.toggleBtn.__dragging = false; // cờ để phân biệt kéo vs click
      this.toggleDrag.startX = e.clientX;
      this.toggleDrag.startY = e.clientY;
      this.toggleDrag.initL = rect.left;
      this.toggleDrag.initT = rect.top;
      this.toggleBtn.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointermove", this.onPointerMoveToggle, { passive: false });
      window.addEventListener("pointerup", this.onPointerUpToggle);
    }
    onPointerMoveToggle(e) {
      if (!this.toggleDrag.dragging) return;
      e.preventDefault();
      const dx = e.clientX - this.toggleDrag.startX;
      const dy = e.clientY - this.toggleDrag.startY;
      const w = this.toggleBtn.offsetWidth;
      const h = this.toggleBtn.offsetHeight;
      const maxL = window.innerWidth - w - 6;
      const maxT = window.innerHeight - h - 6;
      let left = this.toggleDrag.initL + dx;
      let top  = this.toggleDrag.initT + dy;
      left = Math.max(6, Math.min(maxL, left));
      top  = Math.max(6, Math.min(maxT, top));
      // áp vị trí
      this.toggleBtn.style.left = left + "px";
      this.toggleBtn.style.top  = top + "px";
      this.toggleBtn.style.right = "auto";
      // đánh dấu là đang kéo để không trigger click
      if (Math.abs(dx) + Math.abs(dy) > 3) this.toggleBtn.__dragging = true;
    }
    onPointerUpToggle(e) {
      if (!this.toggleDrag.dragging) return;
      this.toggleDrag.dragging = false;
      this.toggleBtn.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", this.onPointerMoveToggle);
      window.removeEventListener("pointerup", this.onPointerUpToggle);
      // lưu vị trí
      const rect = this.toggleBtn.getBoundingClientRect();
      const pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      this.togglePos = pos;
      try { localStorage.setItem(LS_TOGGLE_POS, JSON.stringify(pos)); } catch {}
      // nhỏ delay để click không ăn sau khi kéo
      setTimeout(() => { this.toggleBtn.__dragging = false; }, 30);
    }
    applyTogglePos() {
      if (!this.toggleBtn) return;
      if (this.togglePos) {
        this.toggleBtn.style.left = this.togglePos.left + "px";
        this.toggleBtn.style.top  = this.togglePos.top  + "px";
        this.toggleBtn.style.right = "auto";
      } else {
        // mặc định ở góc trên phải
        this.toggleBtn.style.top = Math.max(12, (this.pos?.top ?? 12)) + "px";
        this.toggleBtn.style.right = "12px";
        this.toggleBtn.style.left = "auto";
      }
    }
    boundToggleInside() {
      if (!this.toggleBtn || !this.toggleBtn.classList.contains("show")) return;
      const rect = this.toggleBtn.getBoundingClientRect();
      let left = rect.left, top = rect.top;
      const w = rect.width, h = rect.height;
      const maxL = window.innerWidth - w - 6;
      const maxT = window.innerHeight - h - 6;
      left = Math.max(6, Math.min(maxL, left));
      top  = Math.max(6, Math.min(maxT, top));
      this.toggleBtn.style.left = left + "px";
      this.toggleBtn.style.top  = top + "px";
      this.toggleBtn.style.right = "auto";
      // cập nhật lưu
      const pos = { left: Math.round(left), top: Math.round(top) };
      this.togglePos = pos;
      try { localStorage.setItem(LS_TOGGLE_POS, JSON.stringify(pos)); } catch {}
    }

    /* ===== Exporters ===== */
    exportToTxt() {
      const clean = (txt) => txt.replace(/\s+/g, " ").trim();
      let fullText = "";
      const blocks = [...this.contentArea.querySelectorAll(".qa-block")]
        .filter(b => b.style.display !== "none");

      blocks.forEach((block) => {
        const q = block.querySelector(".question-content");
        const content = block.querySelector(".content-container");
        if (!q || !content) return;

        const textQ = clean(q.textContent || "");
        let answerLines = [];

        if (content.dataset.type === "answer") {
          const correctNodes = [...content.querySelectorAll(".correct-answer")];
          const correctTexts = correctNodes
            .map(node => clean(node.textContent || ""))
            .filter(Boolean);
          if (correctTexts.length) {
            answerLines = correctTexts.map(text => `--> ${text}`);
          }
        }

        if (!answerLines.length) {
          const fallback = clean(content.textContent || "");
          if (fallback) answerLines = [`--> ${fallback}`];
        }

        if (answerLines.length) {
          fullText += `${textQ}\n${answerLines.join("\n")}\n\n`;
        }
      });

      const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `dap-an-olm-${Date.now()}.txt`;
      ensureBody(link);
      link.click();
      link.remove();
    }

    // GIỮ NGUYÊN HÀM XUẤT PDF
    async exportToPDF() {
      try {
        const visibleBlocks = [...this.contentArea.querySelectorAll(".qa-block")]
          .filter(b => b.style.display !== "none");
        if (!visibleBlocks.length) { alert("Không có nội dung để xuất."); return; }

        const root = document.createElement("div");
        root.className = "pdf-root";

        const header = document.createElement("div");
        header.style.cssText = "font-weight:700;font-size:18px;margin-bottom:6px;text-align:center";
        header.textContent = "Đòn Hư Lém - PDF";
        root.append(header);

        visibleBlocks.forEach(b => {
          const clone = b.cloneNode(true);
          clone.querySelectorAll("mjx-container").forEach(m => {
            m.style.pageBreakInside = "avoid"; m.style.breakInside = "avoid";
          });
          clone.querySelectorAll("img").forEach(img => {
            try { img.src = new URL(img.getAttribute("src"), location.href).href; } catch {}
            img.style.maxWidth = "100%"; img.style.height = "auto";
          });
          root.appendChild(clone);
        });

        const spacer = document.createElement("div");
        spacer.className = "pdf-spacer";
        root.appendChild(spacer);

        await this.typesetForExport(root);
        await this.waitImages(root);
        await ensureHtml2Pdf();

        const opt = {
          margin: [10, 10, 12, 10],
          filename: `olm-${Date.now()}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            windowWidth: Math.max(document.documentElement.clientWidth, root.scrollWidth),
            windowHeight: root.scrollHeight + 200,
            scrollY: 0
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        const stash = document.createElement("div");
        stash.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:900px;opacity:0;pointer-events:none";
        stash.appendChild(root);
        ensureBody(stash);

        await new Promise(r => setTimeout(r, 60));

        await UW.html2pdf().set(opt).from(root).save();

        stash.remove();
      } catch (err) {
        console.error("Xuất PDF lỗi:", err);
        try {
          const w = window.open("", "_blank");
          if (!w) throw new Error("Popup bị chặn");
          w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Đòn Hư Lém - PDF</title>
            <style>
              body{ font-family: Arial, Helvetica, sans-serif; padding: 16px; }
              .qa-block{ page-break-inside: avoid; break-inside: avoid; border:1px solid #ddd; border-radius:10px; padding:12px; margin-bottom:10px; }
              mjx-container{ page-break-inside: avoid; break-inside: avoid; }
              img{ max-width:100%; height:auto; }
              .pdf-spacer{ height: 24px; }
              h1{ font-size:18px; text-align:center; margin:0 0 6px; }
            </style>
          </head><body>
            <h1>Đòn Hư Lém - PDF</h1>
          </body></html>`);
          const body = w.document.body;
          const blocks = [...this.contentArea.querySelectorAll(".qa-block")].filter(b => b.style.display !== "none");
          blocks.forEach(b => body.appendChild(b.cloneNode(true)));
          body.appendChild(Object.assign(document.createElement("div"), { className: "pdf-spacer" }));
          const cfg = w.document.createElement("script");
          cfg.type = "text/javascript";
          cfg.text = `window.MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']] }, startup: { typeset: true } };`;
          const mj = w.document.createElement("script");
          mj.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
          body.appendChild(cfg); body.appendChild(mj);
          mj.onload = () => setTimeout(() => { w.print(); }, 600);
        } catch {
          alert("Xuất PDF thất bại. Thử lại lần nữa giúp mình nhé!");
        }
      }
    }

    async exportWordV2(event) {
      const button = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const originalText = button?.textContent ?? "WORD V2";
      if (button) {
        button.disabled = true;
        button.textContent = "Đang tạo...";
      }
      try {
        const visibleBlocks = [...this.contentArea.querySelectorAll(".qa-block")]
          .filter(b => b.style.display !== "none");
        if (!visibleBlocks.length) { alert("Không có nội dung để xuất."); return; }

        const wrapper = document.createElement("div");
        wrapper.className = "word-v2-wrapper";

        const header = document.createElement("div");
        header.className = "word-v2-header";
        header.innerHTML = `
          <h1>OLM Helper - WORD V2</h1>
        `;
        wrapper.appendChild(header);

        visibleBlocks.forEach((block, idx) => {
          const clone = block.cloneNode(true);
          const qIndex = clone.querySelector(".q-index");
          if (qIndex) qIndex.textContent = `Câu ${idx + 1}. `;
          wrapper.appendChild(clone);
        });

        await this.prepareWordCloneForDoc(wrapper);

        const styles = `
          body{ font-family:'Times New Roman',serif; color:#111827; padding:32px; line-height:1.5; font-size:14px; }
          .word-v2-header{text-align:center;margin-bottom:18px;}
          .word-v2-header h1{margin:0;font-size:20px;text-transform:uppercase;letter-spacing:0.05em;}
          .qa-block{border:1px solid #d1d5db;border-radius:10px;padding:14px 16px;margin-bottom:14px;background:#fff;}
          .question-content{font-weight:600;margin-bottom:10px;font-size:15px;}
          .question-content .q-index{color:#0f172a;margin-right:4px;}
          .content-container{font-weight:400;font-size:14px;}
          .content-container ul,.content-container ol{margin:6px 0 6px 22px;}
          .correct-answer{font-weight:600;color:#0f766e;}
          img{max-width:100%;height:auto;}
          table{border-collapse:collapse;width:100%;margin:10px 0;}
          table td, table th{border:1px solid #94a3b8;padding:6px;}
        `;

        const html = `<!DOCTYPE html>
          <html lang="vi">
            <head>
              <meta charset="utf-8" />
              <title>OLM Helper - WORD V2</title>
              <style>${styles}</style>
            </head>
            <body>${wrapper.innerHTML}</body>
          </html>`;

        const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `olm-word-v2-${Date.now()}.doc`;
        ensureBody(link);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        link.remove();
      } catch (err) {
        console.error("WORD V2 export error:", err);
        alert("Tạo WORD V2 thất bại. Thử lại giúp mình nhé!");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    async prepareWordCloneForDoc(root) {
      root.querySelectorAll("script, style").forEach((el) => el.remove());
      root.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
      root.querySelectorAll("button, input, textarea, select").forEach((el) => el.remove());
      root.querySelectorAll("." + HIGHLIGHT_CLASS).forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize?.();
      });
      root.querySelectorAll("a").forEach((a) => {
        const span = document.createElement("span");
        span.innerHTML = a.innerHTML || a.textContent || "";
        a.replaceWith(span);
      });
      await this.convertMathNodesToImages(root);
      root.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (!src) return img.remove();
        if (!src.startsWith("data:")) {
          try { img.src = new URL(src, location.href).href; } catch {}
        }
        img.removeAttribute("loading");
        img.removeAttribute("decoding");
        if (!img.style.maxWidth) img.style.maxWidth = "100%";
        img.style.height = "auto";
      });
    }

    async convertMathNodesToImages(root) {
      const mathNodes = root.querySelectorAll("mjx-container");
      if (!mathNodes.length) return;
      const MJ = UW.MathJax;
      const adaptor = MJ?.startup?.adaptor;
      if (!MJ || !MJ.mathml2svg || !adaptor) {
        mathNodes.forEach((node) => this.replaceMathWithFallback(node));
        return;
      }
      await Promise.all([...mathNodes].map(async (node) => {
        const mathEl = node.querySelector("mjx-assistive-mml math");
        if (!mathEl) { this.replaceMathWithFallback(node); return; }
        let svgElement;
        try {
          const serialized = new XMLSerializer().serializeToString(mathEl);
          const isDisplay = node.getAttribute("display") === "true";
          svgElement = MJ.mathml2svg(serialized, { display: isDisplay });
        } catch (error) {
          console.error("mathml2svg failed:", error);
          this.replaceMathWithFallback(node);
          return;
        }
        const svgMarkup = adaptor.outerHTML(svgElement);
        const dataUri = encodeSvgToDataUri(svgMarkup);
        if (!dataUri) { this.replaceMathWithFallback(node); return; }
        const img = document.createElement("img");
        img.src = dataUri;
        img.alt = (node.textContent || "").replace(/\s+/g, " ").trim() || "math";
        img.style.verticalAlign = "middle";
        img.style.maxWidth = "100%";
        node.replaceWith(img);
      }));
    }

    replaceMathWithFallback(node) {
      const span = document.createElement("span");
      span.textContent = (node.textContent || "").trim() || "[math]";
      node.replaceWith(span);
    }

    async downloadWordFile(event) {
      const button = event?.currentTarget ?? event?.target;
      const btnEl = button instanceof HTMLElement ? button : null;
      const originalText = btnEl?.textContent ?? "WORD";
      if (btnEl) {
        btnEl.textContent = "Đang xử lý...";
        btnEl.disabled = true;
      }
      try {
        const match = window.location.pathname.match(/(\d+)$/);
        if (!match || !match[0]) {
          alert("Lỗi: Không tìm thấy ID chủ đề");
          throw new Error("Không tìm thấy ID chủ đề.");
        }
        const id_cate = match[0];
        if (btnEl) btnEl.textContent = "Đang lấy link...";
        const apiUrl = `https://olm.vn/download-word-for-user?id_cate=${id_cate}&showAns=1&questionNotApproved=0`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`Lỗi server OLM: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data || !data.file) {
          throw new Error("Response JSON không hợp lệ hoặc không có link file.");
        }
        const fileUrl = data.file;
        if (btnEl) btnEl.textContent = "Đang tải về...";
        const link = document.createElement("a");
        link.href = fileUrl;
        link.target = "_blank";
        let filename = fileUrl.split("/").pop();
        if (!filename || !filename.includes(".")) {
          filename = `olm-answers-${id_cate}.docx`;
        }
        link.download = filename;
        ensureBody(link);
        link.click();
        link.remove();
      } catch (error) {
        console.error("Lỗi khi tải file Word:", error);
        alert(`Đã xảy ra lỗi: ${error.message}`);
      } finally {
        if (btnEl) {
          btnEl.textContent = originalText;
          btnEl.disabled = false;
        }
      }
    }

    async typesetForExport(root) {
      if (UW.MathJax?.typesetPromise) {
        const box = document.createElement("div");
        box.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:900px;opacity:0;pointer-events:none";
        box.appendChild(root);
        ensureBody(box);
        try { await UW.MathJax.typesetPromise([box]); } catch {}
        document.body.appendChild(root);
        box.remove();
        await new Promise(r => setTimeout(r, 30));
      }
    }

    waitImages(root) {
      const imgs = [...root.querySelectorAll("img")];
      if (!imgs.length) return Promise.resolve();
      return Promise.allSettled(imgs.map(img => new Promise(res => {
        if (img.complete && img.naturalWidth) return res();
        img.addEventListener("load", () => res(), { once: true });
        img.addEventListener("error", () => res(), { once: true });
      })));
    }

    copyAllVisibleAnswers() {
      const blocks = [...this.contentArea.querySelectorAll(".qa-block")].filter(b => b.style.display !== "none");
      if (!blocks.length) return;
      let out = "";
      blocks.forEach((b) => {
        const q = b.querySelector(".question-content")?.innerText ?? "";
        const a = b.querySelector(".content-container")?.innerText ?? "";
        out += `${q}\n--> ${a}\n\n`;
      });
      const doCopy = (txt) => navigator.clipboard?.writeText(txt).catch(() => {
        const ta = document.createElement("textarea"); ta.value = txt; ensureBody(ta); ta.select(); document.execCommand("copy"); ta.remove();
      });
      doCopy(out);
    }

    onKeyDown(event) {
      if (event.altKey && !event.shiftKey && !event.ctrlKey) {
        const k = event.key.toLowerCase();
        if (k === "a") { event.preventDefault(); this.copyAllVisibleAnswers(); }
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
      try { localStorage.setItem(LS_DARK, this.dark ? "1" : "0"); } catch {}
      this.updateControlsSliderState();
    }

    toggleStealthMode() {
      this.applyStealthMode(!this.stealthMode);
    }

    toggleAutoSearch() {
      this.applyAutoSearchState(!this.autoSearchEnabled);
    }

    applyAutoSearchState(force) {
      this.autoSearchEnabled = !!force;
      if (this.autoSearchBtn) {
        this.autoSearchBtn.classList.toggle("is-active", this.autoSearchEnabled);
        this.autoSearchBtn.textContent = this.autoSearchEnabled ? "Auto Search ON" : "Auto Search";
        this.autoSearchBtn.setAttribute("aria-pressed", this.autoSearchEnabled ? "true" : "false");
      }
      if (!this.autoSearchEnabled) this.lastSelectionText = "";
      try { localStorage.setItem(LS_AUTO_SEARCH, this.autoSearchEnabled ? "1" : "0"); } catch {}
      this.updateControlsSliderState();
    }

    applyStealthMode(force) {
      this.stealthMode = !!force;
      setStealthActive(this.stealthMode);
      if (this.stealthBtn) {
        this.stealthBtn.classList.toggle("is-active", this.stealthMode);
        this.stealthBtn.textContent = this.stealthMode ? "Stealth ON" : "Stealth";
        this.stealthBtn.setAttribute("aria-pressed", this.stealthMode ? "true" : "false");
      }
      try { localStorage.setItem(LS_STEALTH, this.stealthMode ? "1" : "0"); } catch {}
      this.updateControlsSliderState();
    }

    applyPosOnly() {
      const c = this.container; c.style.left = ""; c.style.right = ""; c.style.top = "";
      if (this.pos) {
        c.style.left = this.pos.left + "px";
        c.style.top  = this.pos.top  + "px";
      } else {
        c.style.right = "12px"; c.style.left = "auto"; c.style.top = "12px";
      }
    }

    ensureContainerInViewport() {
      if (!this.container) return;
      const style = this.container.style;
      let rect = this.container.getBoundingClientRect();

      const maxWidth = Math.max(240, window.innerWidth - 16);
      const maxHeight = Math.max(240, window.innerHeight - 16);
      let adjustedSize = false;

      if (rect.width > maxWidth) {
        style.width = `${maxWidth}px`;
        adjustedSize = true;
      }
      if (rect.height > maxHeight) {
        style.height = `${maxHeight}px`;
        adjustedSize = true;
      }
      if (adjustedSize) rect = this.container.getBoundingClientRect();

      const maxLeft = Math.max(6, window.innerWidth - rect.width - 6);
      const maxTop = Math.max(6, window.innerHeight - rect.height - 6);
      let left = rect.left;
      let top = rect.top;

      left = Math.min(Math.max(left, 6), maxLeft);
      top  = Math.min(Math.max(top, 6), maxTop);

      style.left = `${left}px`;
      style.right = "auto";
      style.top = `${top}px`;

      this.pos = { left: Math.round(left), top: Math.round(top) };
      try { localStorage.setItem(LS_POS, JSON.stringify(this.pos)); } catch {}

      if (adjustedSize) {
        this.size = { w: Math.round(this.container.offsetWidth), h: Math.round(this.container.offsetHeight) };
        try { localStorage.setItem(LS_SIZE, JSON.stringify(this.size)); } catch {}
      }
    }

    showToggleBtn(){ this.toggleBtn?.classList.add("show"); this.applyTogglePos(); this.boundToggleInside(); }
    hideToggleBtn(){ this.toggleBtn?.classList.remove("show"); }

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

    // --- Thêm helper: lấy answers từ HTML đã giải mã (chunk) ---
        parseAnswersFromHtml(html) {
      try {
        const listElement = document.createElement("ul");
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;

        // Remove solution/explain blocks to avoid picking lists inside them
        tempDiv.querySelectorAll(
          ".loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in"
        ).forEach(el => el.remove());

        // Remove noisy meta lines like "p.shuffle=0" which sometimes appear in TF blocks
        removeNoiseMetaLines(tempDiv);

        // 1) Multiple-choice: find option list if present
        const findOptionList = () => {
          // Prefer quiz-list class
          let lst = tempDiv.querySelector("ol.quiz-list, ul.quiz-list");
          if (lst) return lst;
          // Else pick any list that looks like options (>=2 items)
          const candidates = Array.from(tempDiv.querySelectorAll("ol, ul"));
          return candidates.find(ul => ul.querySelectorAll(":scope > li").length >= 2) || null;
        };

        const optionList = findOptionList();
        if (optionList) {
          const items = Array.from(optionList.querySelectorAll(":scope > li"));
          if (items.length) {
            items.forEach(it => {
              const li = document.createElement("li");
              // Mark correct by class or inner markers
              const isCorrect = (
                (it.className && /correct|true|right/i.test(it.className)) ||
                !!it.querySelector(".correctAnswer, .is-correct, .answer-true")
              );

              if (isCorrect) li.classList.add("correct-answer");

              const tmp = document.createElement("div");
              tmp.innerHTML = it.innerHTML;
              stripLeadingHashesFromElement(tmp);
              while (tmp.firstChild) li.appendChild(tmp.firstChild);
              listElement.appendChild(li);
            });
            return listElement;
          }
        }

        // 2) If only .correctAnswer nodes appear, try to find their parent list to show all
        const correctNodes = tempDiv.querySelectorAll(".correctAnswer, li.correctAnswer");
        if (correctNodes.length > 0) {
          const parentList = correctNodes[0].closest("ol, ul");
          if (parentList) {
            const items = Array.from(parentList.querySelectorAll(":scope > li"));
            items.forEach(it => {
              const li = document.createElement("li");
              const isCorrect = (
                it === correctNodes[0] ||
                it.classList.contains("correctAnswer") ||
                /correct|true|right/i.test(it.className || "") ||
                !!it.querySelector(".correctAnswer, .is-correct, .answer-true")
              );
              if (isCorrect) li.classList.add("correct-answer");
              const tmp = document.createElement("div");
              tmp.innerHTML = it.innerHTML;
              stripLeadingHashesFromElement(tmp);
              while (tmp.firstChild) li.appendChild(tmp.firstChild);
              listElement.appendChild(li);
            });
            return listElement;
          } else {
            // No parent list => show correct items only (legacy behavior)
            correctNodes.forEach(ans => {
              const li = document.createElement("li");
              li.className = "correct-answer";
              const tmp = document.createElement("div");
              tmp.innerHTML = ans.innerHTML;
              stripLeadingHashesFromElement(tmp);
              while (tmp.firstChild) li.appendChild(tmp.firstChild);
              listElement.appendChild(li);
            });
            return listElement;
          }
        }

        // 3) Fill-in: input[data-accept]
        const fillInInput = tempDiv.querySelector("input[data-accept]");
        if (fillInInput) {
          fillInInput.getAttribute("data-accept").split("|").forEach((a) => {
            const li = document.createElement("li");
            li.className = "correct-answer";
            li.textContent = a.trim().replace(/^\s*#\s*/g, '');
            listElement.appendChild(li);
          });
          return listElement;
        }

        // 4) Last fallback: take any list and mark guessed correct items
        const quizLists = tempDiv.querySelectorAll("ol, ul");
        for (const list of quizLists) {
          const items = list.querySelectorAll(":scope > li");
          if (!items.length) continue;
          let any = false;
          items.forEach(it => {
            any = true;
            const li = document.createElement("li");
            const isCorrect = (
              (it.className && /correct|true|right/i.test(it.className)) ||
              !!it.querySelector(".correctAnswer, .is-correct, .answer-true")
            );
            if (isCorrect) li.classList.add("correct-answer");
            const tmp = document.createElement("div");
            tmp.innerHTML = it.innerHTML;
            stripLeadingHashesFromElement(tmp);
            while (tmp.firstChild) li.appendChild(tmp.firstChild);
            listElement.appendChild(li);
          });
          if (any) return listElement;
        }

        return null;
      } catch (e) {
        console.error("parseAnswersFromHtml error:", e);
        return null;
      }
    }

    getSolutionAsDOM(decodedContent) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = decodedContent;
      const solutionNode = tempDiv.querySelector(".loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in");
      if (!solutionNode) return null;
      // clone và strip leading hashes inside solution
      const clone = solutionNode.cloneNode(true);
      stripLeadingHashesFromElement(clone);
      return clone;
    }

    renderData(data) {
      if (!Array.isArray(data)) return;

      const responseContainer = document.createElement("div");

      data.forEach((question) => {
        // Giải mã nội dung gốc
        let decodedContent = decodeBase64Utf8(question.content || "");
        decodedContent = mildLatexFix(decodedContent);

        // Nếu content có nhiều câu (được phân tách bằng <hr ...>), tách thành các đoạn.
        // Phần trước hr đầu tiên xem là "passage" (ngữ cảnh chung) và được gộp với mỗi đoạn tiếp theo.
        const parts = decodedContent.split(/<hr\b[^>]*>/gi).map(s => s.trim()).filter(s => s);
        let passage = null;
        let qChunks = parts;
        if (parts.length > 1) {
          passage = parts[0];
          qChunks = parts.slice(1);
        }

        // Nếu không có hr nào => xử lý toàn bộ decodedContent như 1 câu
        if (qChunks.length === 0) qChunks = [decodedContent];

                // If there is a shared passage, render it once (deduplicated)
        if (passage) {
          const pd = document.createElement("div");
          pd.innerHTML = passage;
          pd.querySelectorAll("ol.quiz-list, ul.quiz-list, .interaction, .form-group, .loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in, hr").forEach(el => el.remove());
          stripLeadingHashesFromElement(pd);
          removeNoiseMetaLines(pd);
          const pkey = pd.textContent.trim().replace(/\s+/g, " ");
          if (pkey && !this.renderedPassages.has(pkey)) {
            const pblock = document.createElement("div");
            pblock.className = "passage-block";
            while (pd.firstChild) pblock.appendChild(pd.firstChild);
            responseContainer.appendChild(pblock);
            this.renderedPassages.add(pkey);
          }
        }
qChunks.forEach((chunk) => {
          const fullHtml = chunk; // do not repeat passage per question
          // Tìm đáp án từ html chunk (ưu tiên class correctAnswer / input[data-accept], ...)
          const answersElement = this.parseAnswersFromHtml(fullHtml);

          // Tìm lời giải trong chunk (đã strip # bên trong)
          const solutionElement = this.getSolutionAsDOM(fullHtml);

          // Chuẩn bị hiển thị question text (loại bỏ phần list/options/solution)
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = fullHtml;
          // loại bỏ phần list/options/interactive/solution trước khi đưa vào vùng question content
          tempDiv.querySelectorAll("ol.quiz-list, ul.quiz-list, .interaction, .form-group, .loigiai, .huong-dan-giai, .explain, .solution, #solution, .guide, .exp, .exp-in, hr").forEach(el => el.remove());
          // remove inline short-answer inputs so the question text doesn't render empty boxes
          tempDiv.querySelectorAll(".trigger-curriculum-cate, .trigger-curriculum").forEach(el => el.remove());
          tempDiv.querySelectorAll("input[data-accept], input[data-placeholder-answer]").forEach((inputEl) => {
            const parent = inputEl.parentElement;
            if (parent && parent.childNodes.length === 1) parent.remove();
            else inputEl.remove();
          });

          // *** làm sạch các # đầu dòng trong phần question text trước khi append ***
          stripLeadingHashesFromElement(tempDiv);
          removeNoiseMetaLines(tempDiv);

          const questionDiv = document.createElement("div"); questionDiv.className = "qa-block";

          const qaTop = document.createElement("div"); qaTop.className = "qa-top";
          const questionDisplayContainer = document.createElement("div"); questionDisplayContainer.className = "question-content";

          const indexSpan = document.createElement("span"); indexSpan.className = "q-index"; indexSpan.textContent = "Câu ?. ";
          questionDisplayContainer.appendChild(indexSpan);

          // append phần văn bản câu hỏi (nội dung đã lọc)
          while (tempDiv.firstChild) questionDisplayContainer.appendChild(tempDiv.firstChild);

          // nếu rỗng và question.title có giá trị thì dùng title
          if (!questionDisplayContainer.hasChildNodes() && question.title) {
            questionDisplayContainer.innerHTML = `<span class="q-index">Câu ?. </span>${question.title}`;
          }

          qaTop.append(questionDisplayContainer);

          const contentContainer = document.createElement("div"); contentContainer.className = "content-container";
          if (answersElement) {
            contentContainer.dataset.type = "answer";
            contentContainer.appendChild(answersElement);
          } else if (solutionElement) {
            contentContainer.dataset.type = "solution";
            contentContainer.appendChild(solutionElement);
          } else {
            contentContainer.dataset.type = "not-found";
            const nf = document.createElement("div"); nf.style.cssText="color:#6b7280;font-style:italic";
            nf.textContent = "Không tìm thấy đáp án hay lời giải.";
            contentContainer.appendChild(nf);
          }

          questionDiv.append(qaTop, contentContainer);
          responseContainer.appendChild(questionDiv);
        });
      });

      // chèn lên đầu content area (cũ vẫn giữ)
      this.contentArea.prepend(responseContainer);
      this.renumber();
      this.updateCounts();
      this.renderContentWithMath(this.contentArea);
      const kw = this.searchInput?.value?.trim(); if (kw) highlightInElement(this.contentArea, kw);
      this.syncPassageBlocksVisibility();
    }

    syncPassageBlocksVisibility() {
      const passages = this.contentArea.querySelectorAll(".passage-block");
      passages.forEach((passage) => {
        let next = passage.nextElementSibling;
        let hasVisible = false;
        while (next && !next.classList.contains("passage-block")) {
          if (next.classList.contains("qa-block") && next.style.display !== "none") {
            hasVisible = true;
            break;
          }
          next = next.nextElementSibling;
        }
        passage.style.display = hasVisible ? "" : "none";
      });
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
      this.syncPassageBlocksVisibility();
    }

  }

  const answerUI = new AnswerDisplay();
  answerUI.init();

  // Network hooks
  const originalFetch = UW.fetch?.bind(UW) || fetch.bind(window);
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

  if (UW.XMLHttpRequest) {
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
  }
})();
