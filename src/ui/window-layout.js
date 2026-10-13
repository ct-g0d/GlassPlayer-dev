  /* ================= stable Edge window fitting ================= */
  const APP_MIN_WIDTH = 1040;
  const APP_MIN_HEIGHT = 800;
  const initialFrameRatio=(window.outerWidth&&window.innerWidth)?window.outerWidth/window.innerWidth:1;
  let viewportFitFrame = 0;

  function fitActiveView(view=null){
    const mainArea = $(".main-area");
    const activeView = view || $(".view.active:not(.gp-view-overlay)") || $(".view.active");
    if(!mainArea || !activeView) return;
    const target = activeView.querySelector(".view-fill") || activeView.querySelector(".player-layout");
    if(!target) return;
    const style = getComputedStyle(mainArea);
    const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const available = mainArea.clientHeight - verticalPadding;
    const nextHeight=Math.floor(Math.max(520,available));
    const currentHeight=parseFloat(target.style.height)||0;
    if(Math.abs(currentHeight-nextHeight)>=1)target.style.height=nextHeight+"px";
  }

  function applyViewportFit(){
    viewportFitFrame = 0;
    const viewport = window.visualViewport;
    const width = Math.max(320, Math.round(viewport ? viewport.width : window.innerWidth));
    const height = Math.max(320, Math.round(viewport ? viewport.height : window.innerHeight));
    const currentFrameRatio=(window.outerWidth&&window.innerWidth)?window.outerWidth/window.innerWidth:initialFrameRatio;
    const pageZoom=Math.max(.75,Math.min(2,currentFrameRatio/initialFrameRatio));
    const rawScale = Math.min(1, (width*pageZoom) / APP_MIN_WIDTH, (height*pageZoom) / APP_MIN_HEIGHT);
    /* Snap fit zoom to a device-pixel-aware raster step. Tiny continuously
       changing fractions force Chromium to resample glyphs onto half pixels. */
    const rasterStep=1/(64*Math.max(1,Math.round(window.devicePixelRatio||1)));
    const scale=rawScale>=.999?1:Math.max(.5,Math.floor(rawScale/rasterStep)*rasterStep);
    const shell = $("#appShell");
    shell.style.width = (width / scale) + "px";
    shell.style.height = (height / scale) + "px";
    /* Chromium layout zoom keeps glyphs in the text rasterization pipeline.
       Scaling the complete shell as one texture made fractional-size text rough. */
    shell.style.transform = "none";
    shell.style.zoom = scale;
    document.documentElement.style.setProperty("--ui-scale", scale.toFixed(4));
    document.body.classList.toggle("compact-window", scale < .999);
    window.dispatchEvent(new CustomEvent("gp:viewport-fit",{detail:{width:Math.round(width*pageZoom),height:Math.round(height*pageZoom)}}));
    fitActiveView();
    requestAnimationFrame(()=>{
      updateNavGlider(false);updateAllGliders(false);
      refreshScrollEdgeFrames();GPUIRegistry.refresh($(".view.active")||document,false);
      refreshNowTitleMarqueeForScale();
    });
  }

  function scheduleViewportFit(){
    if(viewportFitFrame) cancelAnimationFrame(viewportFitFrame);
    viewportFitFrame = requestAnimationFrame(applyViewportFit);
  }

  window.addEventListener("resize", scheduleViewportFit, {passive:true});
  window.addEventListener("load",()=>requestAnimationFrame(initializeSelectionGliders),{once:true});
  document.addEventListener("fullscreenchange", scheduleViewportFit);
  if(window.visualViewport) window.visualViewport.addEventListener("resize", scheduleViewportFit, {passive:true});
  scheduleViewportFit();
  /* Window and visualViewport events are sufficient here. Observing main-area itself
     created a resize feedback loop that made the two facing glass borders shimmer. */

  /* Bind the existing, tested 3.5.3 player to /src/core/audio without changing
     any UI handler or playback call site in this Beta. */
  GPAudioCore.bindRuntime({
    play:playAudio,
    pause:pauseAudio,
    toggle:togglePlay,
    loadTrack,
    next:nextTrack,
    previous:prevTrack,
    getState:()=>({currentIndex,isPlaying,wantsPlayback,playMode,queueLength:playQueue.length})
  });
