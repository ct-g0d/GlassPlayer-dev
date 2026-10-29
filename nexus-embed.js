/* ?embed=1: Glass Player framed by the Nexus launcher. Reports the track to Nexus's Now Playing widget, takes
   play / prev / next back, and follows Nexus's theme (?theme= on load, then { nexus: 'theme' } messages).
   Owns no product state: it reads what the runtime rendered and presses the runtime's own controls. */
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has('embed') || parent === window) return;
  const $ = (s) => document.querySelector(s);

  let last = '', coverSrc = '', coverData = '';
  // The cover is usually a blob: URL the shell can't load from its origin, so it travels as a small JPEG
  const cover = () => {
    const img = [$('#staticCover'), $('#rotorCover')].find((i) => i?.getAttribute('src') && i.naturalWidth);
    if (!img) return '';
    if (img.src !== coverSrc) {
      coverSrc = img.src;
      try {
        const c = Object.assign(document.createElement('canvas'), { width: 160, height: 160 });
        c.getContext('2d').drawImage(img, 0, 0, 160, 160);
        coverData = c.toDataURL('image/jpeg', 0.8);
      } catch { coverData = ''; }
    }
    return coverData;
  };
  setInterval(() => {
    const state = { nexus: 'nowPlaying', title: $('#nowTitle').textContent.trim(), artist: $('#nowArtist').textContent.trim(), cover: cover(),
      playing: /<rect/i.test($('#playIcon').innerHTML), loaded: $('#durTime').textContent !== '0:00',
      cur: $('#curTime').textContent, dur: $('#durTime').textContent, pos: +$('#seek').value / +$('#seek').max };
    const json = JSON.stringify(state);
    if (json !== last) { last = json; parent.postMessage(state, '*'); }
  }, 500);

  // Through the app's own theme switch, so the choice sticks
  const setTheme = (t) => (t === 'light' || t === 'dark') && $(`#themeSeg [data-v="${t}"]`)?.click();
  setTheme(q.get('theme'));
  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    if (e.data?.nexus === 'theme') return setTheme(e.data.theme);
    if (e.data?.nexus !== 'control') return;
    ({ toggle: $('#playBtn'), prev: $('#prevBtn'), next: $('#nextBtn') })[e.data.action]?.click();
  });
})();
