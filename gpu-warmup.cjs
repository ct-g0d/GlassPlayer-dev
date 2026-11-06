// The first animation of anything frosted (a menu, a sidebar sliding, a dialog) used to stutter: 30 to 120ms frames while the GPU
// compiled the shaders for its blur, which Chromium doesn't keep between launches; the second time was smooth. So once each page
// has loaded, it draws its own frosted styles once, tiny and 1% opaque in a corner, moving for a quarter of a second, and the real
// first animation finds them ready. Call it once, before app is ready: it covers every window the app opens.
function warm() {
  if (window.__gpuWarm) return;
  window.__gpuWarm = true;
  // What menus, sidebars and dialogs hold: text in the page's own font (sizes and weights as they use them), stroked and filled
  // icons, a rounded highlight. Drawing these into a layer the first time is its own GPU work, apart from the blur behind them
  const PROBE_CONTENT = '<div style="margin:6px;padding:4px 8px;border-radius:8px;background:rgba(128,128,128,.3);font-size:13px;line-height:1.3;color:#fff">Aa Gg 0123 <b>Bold</b> <span style="font-weight:600">Semi</span></div>'
    + '<div style="margin:0 6px;padding:0 8px;font-size:11px;color:#999">Small helper text 59</div>'
    + '<div style="margin:2px 6px;font-size:20px;font-weight:700;color:#fff">Title 12</div>'
    + '<svg width="16" height="16" viewBox="0 0 24 24" style="margin:0 6px"><path d="M5 12h14M12 5l7 7-7 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="6" r="3" fill="#0a84ff"/></svg>';
  const go = () => {
    const keys = new Set(), probes = [];
    const probe = (key, setup) => {
      if (keys.has(key) || probes.length >= 40) return;
      keys.add(key);
      const el = document.createElement('div');
      el.innerHTML = PROBE_CONTENT;
      setup(el);
      Object.assign(el.style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto', width: '180px', height: '120px', margin: '0',
        opacity: '0.01', pointerEvents: 'none', zIndex: '2147483647', animation: 'none', transition: 'none' });
      el.setAttribute('aria-hidden', 'true');
      probes.push(el);
    };
    const simpleClass = (sel) => { const m = /^\.((?:\\.|[\w-])+)$/.exec(sel.trim()); return m && m[1].replace(/\\(.)/g, '$1'); };
    // var(--x) as the page defines it on :root (Glass Player's --gp-popover-blur); null when it's set elsewhere (Tailwind's --tw-*)
    const rootStyle = getComputedStyle(document.documentElement);
    const resolve = (v, depth = 0) => {
      if (!v.includes('var(') || depth > 4) return v.includes('var(') || !v.trim() ? null : v.trim();
      const out = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))*[^()]*))?\)/g, (_, name, fb) => rootStyle.getPropertyValue(name).trim() || (fb || '').trim());
      return out === v ? null : resolve(out, depth + 1);
    };
    // Every rule with a backdrop blur or a blur filter: its value, or (when the value leans on CSS variables, as Tailwind's do) its class
    const visit = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
        if (!r.style) continue;
        for (const [prop, set] of [['backdrop-filter', 'backdropFilter'], ['-webkit-backdrop-filter', 'backdropFilter'], ['filter', 'filter']]) {
          const v = r.style.getPropertyValue(prop);
          if (!v || v === 'none' || (prop === 'filter' && !v.includes('blur'))) continue;
          // A plain class (.sm-menu, .liquid, Tailwind's .backdrop-blur-xl) is drawn as itself, with its real shadow, edge and padding
          for (const part of (r.selectorText || '').split(',')) { const c = simpleClass(part); if (c) probe('class ' + c, (el) => el.classList.add(c)); }
          const value = resolve(v);
          if (value && value !== 'none' && (prop !== 'filter' || value.includes('blur')))
            probe(set + value, (el) => { el.style[set] = value; el.style.background = 'rgba(40,40,44,.6)'; el.style.borderRadius = '14px'; });
        }
      }
    };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
    // And what's on screen now with a blur, as it actually resolves
    const els = document.body.getElementsByTagName('*');
    for (let i = 0; i < els.length && i < 4000; i++) {
      const cs = getComputedStyle(els[i]), b = cs.backdropFilter;
      if (b && b !== 'none') probe('backdropFilter' + b, (el) => { el.style.backdropFilter = b; el.style.background = cs.backgroundColor; el.style.borderRadius = cs.borderRadius; });
    }
    // Things a page builds only later (its menus), given as their real markup in window.gpuWarmHTML: drawn as they are, inside a
    // 1%-opaque holder, so their own entrance animation (which may fade them in to full) still can't show
    for (const html of window.gpuWarmHTML || []) probe('html ' + html, (el) => { el.innerHTML = html; });
    // The soft scroll edges (a gradient mask) and a rounded clip that moves
    probe('mask', (el) => { el.style.webkitMaskImage = el.style.maskImage = 'linear-gradient(transparent, #000 28px, #000 calc(100% - 28px), transparent)'; el.style.background = '#888'; });
    probe('clip', (el) => { el.style.borderRadius = '16px'; el.style.overflow = 'hidden'; el.style.background = '#888'; });
    probe('plain', (el) => { el.style.background = 'rgba(30,30,32,.9)'; el.style.borderRadius = '12px'; });   // text on a plain see-through layer
    for (const el of probes) {
      document.body.append(el);   // in the body, so the probes inherit the page's font
      el.animate({ transform: ['translate(0px, 0px)', 'translate(24px, 12px) scale(1.04)'], opacity: [0.01, 0.02] }, { duration: 260, easing: 'ease-out' })
        .finished.finally(() => el.remove());
    }
  };
  const start = () => requestAnimationFrame(() => requestAnimationFrame(go));
  document.readyState === 'complete' ? start() : addEventListener('load', start, { once: true });
}

module.exports = function warmGpuOnLoad(app) {
  const code = `(${warm})()`;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => { contents.executeJavaScript(code, true).catch(() => {}); });
  });
};
