/* CinemaX window chrome for Glass Player. It owns no product state: every control here presses an existing
   Glass Player control or mirrors what the runtime already rendered. */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const shell = $('#appShell');
  const html = document.documentElement;

  const STRINGS = {
    settings: { zh: '设置 (Ctrl+,)', en: 'Settings (Ctrl+,)', ru: 'Настройки (Ctrl+,)' },
    dark: { zh: '深色外观（点按切换为浅色）', en: 'Dark appearance (click for Light)', ru: 'Тёмная тема (нажмите для светлой)' },
    light: { zh: '浅色外观（点按切换为深色）', en: 'Light appearance (click for Dark)', ru: 'Светлая тема (нажмите для тёмной)' },
    play: { zh: '播放', en: 'Play', ru: 'Воспроизвести' },
    pause: { zh: '暂停', en: 'Pause', ru: 'Пауза' },
    open: { zh: '打开播放页', en: 'Open Now Playing', ru: 'Открыть плеер' },
    artist: { zh: '歌手', en: 'Artist', ru: 'Исполнитель' },
  };
  const lang = () => (html.lang.startsWith('zh') ? 'zh' : html.lang === 'ru' ? 'ru' : 'en');
  const t = (key) => STRINGS[key][lang()];

  /* ---- window controls (browser preview: maximize is full screen; close and minimize belong to the desktop app) ---- */
  $('#cxLights').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'maximize') void (document.fullscreenElement ? document.exitFullscreen() : html.requestFullscreen()).catch(() => {});
    if (act === 'close') window.close();
  });
  document.addEventListener('fullscreenchange', () => html.classList.toggle('cx-filled', !!document.fullscreenElement));
  window.addEventListener('blur', () => html.classList.add('cx-blurred'));
  window.addEventListener('focus', () => html.classList.remove('cx-blurred'));

  /* ---- sidebar: the CinemaX toggle presses Glass Player's own (which persists the choice and handles compact mode) ---- */
  const nativeToggle = $('#sidebarToggle');
  const sideToggle = $('#cxSideToggle');
  sideToggle.addEventListener('click', () => nativeToggle.click());

  /* ---- Theme + Settings corner ---- */
  const themeBtn = $('#cxTheme');
  themeBtn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    $(`#themeSeg button[data-v="${next}"]`)?.click();
  });

  const navButton = (view) => $(`.sidebar .nav-item[data-view="${view}"]`);
  const activeView = () => ($('.view.active:not(.gp-view-overlay)') || $('.view.active'))?.dataset.view;
  let lastPage = 'player';
  const openSettings = () => navButton('settings').click();
  const closeSettings = () => navButton(lastPage).click();
  $('#cxSettings').addEventListener('click', () => (activeView() === 'settings' ? closeSettings() : openSettings()));
  $('#cxSettingsClose').addEventListener('click', closeSettings);
  // A click on the dimmed backdrop, outside the window, closes it
  const settingsView = $('.main-area > .view[data-view="settings"]');
  settingsView.addEventListener('click', (e) => {
    if (e.target === settingsView || e.target === settingsView.firstElementChild) closeSettings();
  });

  // The transport has no captions; the mode button carries the runtime's mode label as its tooltip
  const modeLabel = $('#modeLabel');
  const syncMode = () => ($('#modeBtn').title = modeLabel.textContent.trim());
  new MutationObserver(syncMode).observe(modeLabel, { childList: true, characterData: true, subtree: true });
  syncMode();
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      openSettings();
    } else if (e.key === 'Escape' && activeView() === 'settings' && !$('.gp-motion-popover.show, .rescan-modal-backdrop.show, .rescan-modal-backdrop.open')) {
      closeSettings();
    }
  });

  /* ---- playlists in the sidebar: mirror the library's playlist menu, pick through it ---- */
  const pop = $('#playlistPop');
  const list = $('#cxPlaylists');
  const listIcon = '<svg class="cx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path class="p ln" d="M3 6h11"/><path class="p ln" d="M3 12h11"/><path class="p ln" d="M3 18h7"/><g class="p note"><circle cx="17" cy="17" r="2.5"/><path d="M19.5 17V7l2 1"/></g></svg>';
  const renderPlaylists = () => {
    const rows = $$('button[data-collection]', pop);
    list.replaceChildren(
      ...rows.map((source) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'cx-side-row' + (source.classList.contains('active') && activeView() === 'library' ? ' active' : '');
        row.innerHTML = listIcon;
        const name = document.createElement('span');
        name.textContent = source.querySelector('span')?.textContent ?? '';
        const count = document.createElement('span');
        count.className = 'cx-count';
        count.textContent = source.querySelector('em')?.textContent ?? '';
        row.append(name, count);
        row.addEventListener('click', () => {
          source.click();
          navButton('library').click();
        });
        return row;
      }),
    );
  };
  new MutationObserver(renderPlaylists).observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  // The menu is built the first time it opens; open and close it once, unseen, so the sidebar has rows from the start
  if (!pop.querySelector('[data-collection]')) {
    $('#playlistBtn').click();
    document.body.click();
  }
  $('#cxImportFolder').addEventListener('click', () => $('#addFolderBtn').click());

  /* ---- mini player + playing state ---- */
  const mini = $('#cxMini');
  const miniArt = $('#cxMiniArt');
  const miniTitle = $('#cxMiniTitle');
  const miniPlay = $('#cxMiniPlay');
  const covers = [$('#rotorCover'), $('#staticCover')];
  const syncNowPlaying = () => {
    const playing = /<rect/i.test($('#playIcon').innerHTML);
    shell.classList.toggle('cx-playing', playing);
    mini.classList.toggle('playing', playing);
    miniPlay.setAttribute('aria-label', t(playing ? 'pause' : 'play'));
    miniPlay.title = t(playing ? 'pause' : 'play');
    const src = covers.map((img) => img.getAttribute('src')).find(Boolean) || '';
    if (miniArt.getAttribute('src') !== src) src ? miniArt.setAttribute('src', src) : miniArt.removeAttribute('src');
    miniArt.hidden = !src;
    miniTitle.textContent = $('#nowTitle').textContent.trim();
    const loaded = !!src || $('#durTime').textContent.trim() !== '0:00';
    mini.hidden = !loaded || activeView() === 'player';
  };
  miniPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#playBtn').click();
  });
  $('#cxMiniCard').addEventListener('click', () => navButton('player').click());
  $('#cxMiniOpen').title = t('open');
  const watch = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'style'] };
  [$('#playIcon'), $('#nowTitle'), $('#durTime'), ...covers].forEach((node) => new MutationObserver(syncNowPlaying).observe(node, watch));

  /* ---- page changes: remember the last page for Settings' close, mark Settings open for the cog ---- */
  const syncView = () => {
    const view = activeView();
    if (view && view !== 'settings' && view !== 'changelog') lastPage = view;
    shell.classList.toggle('cx-settings-open', view === 'settings');
    // Settings floats over the page it was opened from, which stays on screen (inert) behind the dimmed backdrop
    $$('.view.cx-behind').forEach((v) => v.classList.remove('cx-behind'));
    if (view === 'settings') $(`.main-area > .view[data-view="${lastPage}"]`)?.classList.add('cx-behind');
    syncNowPlaying();
    renderPlaylists();
  };
  $$('.main-area > .view').forEach((v) => new MutationObserver(syncView).observe(v, { attributes: true, attributeFilter: ['class'] }));

  /* ---- titles follow language and state; the toast centers over the page, clear of the sidebar ---- */
  const syncTitles = () => {
    sideToggle.title = nativeToggle.title;
    themeBtn.title = t(document.body.dataset.theme === 'dark' ? 'dark' : 'light');
    $('#cxSettings').title = t('settings');
    $('#cxMiniOpen').title = t('open');
    $('#cxArtistHead').textContent = t('artist');
    const scale = parseFloat(getComputedStyle(html).getPropertyValue('--ui-scale')) || 1;
    const side = shell.classList.contains('sidebar-collapsed') ? 0 : 232 * scale;
    html.style.setProperty('--cx-toast-x', `${(side + innerWidth) / 2}px`);
  };
  new MutationObserver(syncTitles).observe(html, { attributes: true, attributeFilter: ['lang'] });
  new MutationObserver(syncTitles).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(syncTitles).observe(shell, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', syncTitles, { passive: true });

  syncTitles();
  syncView();
})();
