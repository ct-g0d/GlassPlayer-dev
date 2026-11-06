// Standalone Electron window chrome: Mac X used to handle the traffic lights and round the window; here we do it.
(() => {
  const api = window.glassAPI;
  if (!api || !api.isElectron) return;
  const root = document.documentElement;
  root.classList.add('gp-standalone');
  // Green light maximizes the window like other Windows apps (app.js would put the page in full screen)
  document.addEventListener('click', (event) => {
    const green = event.target instanceof Element && event.target.closest('.traffic[data-window-action="fullscreen"]');
    if (!green) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else api.maximize();
  }, true);
  window.addEventListener('gp:window-action', (event) => {
    const action = event.detail && event.detail.action;
    if (action === 'close') api.close();
    else if (action === 'minimize') api.minimize();
  });
  const syncFill = () => root.classList.toggle('gp-fill', Boolean(document.fullscreenElement));
  document.addEventListener('fullscreenchange', syncFill);
  syncFill();
})();
