/* Themed dropdowns: every <select> opens this menu instead of the system list (Windows draws that in its own style).
   A drop-in for any page or framework: it listens on the document, so selects added later work too. The <select>
   stays the source of truth: picking an item sets its value and fires 'input' and 'change', like choosing natively.
   The menu takes the page's look from the select itself: light text means a dark page, and --accent if the page has one. */
(() => {
  if (window.__selectMenu) return;
  window.__selectMenu = true;

  const style = document.createElement('style');
  style.textContent = `
.sm-menu { position: fixed; z-index: 2147483000; min-width: 120px; max-height: 320px; overflow-y: auto; padding: 5px; border-radius: 9px; box-sizing: border-box;
  font: 13px/1 -apple-system, "Segoe UI Variable Text", "Segoe UI", Inter, "PingFang SC", sans-serif; scrollbar-width: none; user-select: none;
  backdrop-filter: blur(24px) saturate(1.8); -webkit-backdrop-filter: blur(24px) saturate(1.8); animation: sm-in .12s ease-out; }
.sm-menu.dark { background: rgba(44,44,48,.88); color: #f5f5f7; box-shadow: 0 12px 36px rgba(0,0,0,.45), 0 0 0 .5px rgba(255,255,255,.16); }
.sm-menu.light { background: rgba(248,248,250,.92); color: #1d1d1f; box-shadow: 0 12px 36px rgba(0,0,0,.16), 0 0 0 .5px rgba(0,0,0,.12); }
.sm-item { position: relative; display: flex; align-items: center; height: 24px; padding: 0 12px 0 24px; border-radius: 5px; white-space: nowrap; cursor: default; }
.sm-item.on::before { content: ""; position: absolute; left: 8px; top: 7px; width: 7px; height: 4px; border: solid currentColor; border-width: 0 0 1.6px 1.6px; transform: rotate(-45deg); }
.sm-item.hi { background: var(--sm-accent); color: #fff; }
.sm-item.off { opacity: .35; }
.sm-group { padding: 6px 12px 3px; font-size: 11px; font-weight: 600; opacity: .55; }
select:focus { outline: none !important; box-shadow: none !important; }
@keyframes sm-in { from { opacity: 0; transform: translateY(-3px); } }`;
  (document.head || document.documentElement).append(style);

  let open = null;   // { select, menu, items: [{ el, option }], hi }

  const darkPage = (el) => {
    const [r, g, b] = (getComputedStyle(el).color.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;   // light text → dark page
  };
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff';

  function show(select) {
    close();
    const menu = document.createElement('div');
    menu.className = 'sm-menu ' + (darkPage(select) ? 'dark' : 'light');
    menu.style.setProperty('--sm-accent', accent());
    const items = [];
    for (const node of select.children) {
      const options = node.tagName === 'OPTGROUP' ? [...node.children] : [node];
      if (node.tagName === 'OPTGROUP') menu.insertAdjacentHTML('beforeend', `<div class="sm-group"></div>`), (menu.lastChild.textContent = node.label);
      for (const option of options) {
        if (option.tagName !== 'OPTION' || option.hidden) continue;
        const el = document.createElement('div');
        el.className = 'sm-item' + (option.selected ? ' on' : '') + (option.disabled ? ' off' : '');
        el.textContent = option.textContent;
        menu.append(el);
        items.push({ el, option });
      }
    }
    document.body.append(menu);
    // Under the select, at least as wide; above it if there isn't room below
    const r = select.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    const below = innerHeight - r.bottom - 8, h = Math.min(menu.offsetHeight, 320);
    menu.style.top = (below >= h || below >= r.top ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    open = { select, menu, items, hi: items.findIndex((i) => i.option.selected) };
    highlight(open.hi);
    menu.addEventListener('pointermove', (e) => { const i = items.findIndex((x) => x.el === e.target.closest('.sm-item')); if (i >= 0) highlight(i); });
    menu.addEventListener('click', (e) => { const i = items.findIndex((x) => x.el === e.target.closest('.sm-item')); if (i >= 0) choose(i); });
  }
  function highlight(i) {
    if (!open) return;
    open.items.forEach((x, n) => x.el.classList.toggle('hi', n === i && !x.option.disabled));
    open.hi = i;
    open.items[i]?.el.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const { select, items } = open, option = items[i]?.option;
    close();
    select.focus();
    if (!option || option.disabled || option.selected) return;
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function close() { open?.menu.remove(); open = null; }
  const usable = (s) => s && !s.disabled && !s.multiple && !(s.size > 1);

  // Open on press (instead of the system list), close on a press anywhere else
  document.addEventListener('mousedown', (e) => {
    if (open && e.target.closest('.sm-menu')) return e.preventDefault();
    const select = e.target.closest?.('select');
    if (e.button !== 0 || !usable(select)) return close();
    e.preventDefault();
    if (open?.select === select) return close();
    select.focus();
    show(select);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (open) {
      const step = (d) => { let i = open.hi; do { i = (i + d + open.items.length) % open.items.length; } while (open.items[i].option.disabled && i !== open.hi); highlight(i); };
      if (e.key === 'ArrowDown') step(1);
      else if (e.key === 'ArrowUp') step(-1);
      else if (e.key === 'Enter' || e.key === ' ') choose(open.hi);
      else if (e.key === 'Escape' || e.key === 'Tab') { close(); if (e.key === 'Tab') return; }
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    const select = e.target.closest?.('select');
    if (usable(select) && (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) {
      e.preventDefault(); e.stopImmediatePropagation(); show(select);
    }
  }, true);

  addEventListener('blur', close);
  addEventListener('resize', close);
  document.addEventListener('scroll', (e) => { if (open && !open.menu.contains(e.target)) close(); }, true);
})();
