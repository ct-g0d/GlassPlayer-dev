  /* ================= glow feedback ================= */
  const heldPressTargets=new Map();
  const pressReleaseTimers=new WeakMap();
  const gpMotionRestartTokens=new WeakMap();
  function restartCssMotion(element,className){
    if(!element)return;const token=(gpMotionRestartTokens.get(element)||0)+1;gpMotionRestartTokens.set(element,token);
    element.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());element.classList.remove(className);
    requestAnimationFrame(()=>{if(gpMotionRestartTokens.get(element)===token)element.classList.add(className);});
  }
  function releaseHeldPress(pointerId){
    const el=heldPressTargets.get(pointerId);if(!el)return;heldPressTargets.delete(pointerId);
    el.classList.remove("gp-press-held");restartCssMotion(el,"gp-press-release");
    clearTimeout(pressReleaseTimers.get(el));
    pressReleaseTimers.set(el,setTimeout(()=>{el.classList.remove("gp-press-release");pressReleaseTimers.delete(el);},230));
  }
  document.addEventListener("pointerdown",event=>{
    const el=event.target.closest("button,.ripple-target");if(!el||el.matches(":disabled,.toggle-switch"))return;
    clearTimeout(pressReleaseTimers.get(el));el.classList.remove("glow-pulse","gp-press-release");el.classList.add("gp-press-held");
    heldPressTargets.set(event.pointerId,el);
  },true);
  window.addEventListener("pointerup",event=>releaseHeldPress(event.pointerId));
  window.addEventListener("pointercancel",event=>releaseHeldPress(event.pointerId));
  /* ================= pause background work when tab is hidden ================= */
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("tab-hidden", document.hidden);
    if(!document.hidden && bgMode==="color" && playlist[currentIndex]?.coverUrl) startCoverColorMotion();
  });

  /* ================= sidebar navigation ================= */
  function updateNavGlider(animate=true){
    const sidebar=$(".sidebar"),active=sidebar?.querySelector(".nav-item.active");if(!sidebar||!active)return;
    const y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight;
    if(!w||!h){sidebar.classList.remove("nav-glider-ready");return;}
    let glider=sidebar.querySelector(":scope>.nav-glider");
    if(!glider){glider=document.createElement("div");glider.className="nav-glider";sidebar.prepend(glider);}
    const oldY=Number(glider.dataset.y||y),oldH=Number(glider.dataset.h||h);
    glider.style.height=`${h}px`;glider.style.transform=`translate3d(0,${y}px,0)`;
    if(animate&&Math.abs(oldY-y)>.5){
      glider.getAnimations().forEach(animation=>animation.cancel());
      glider.style.willChange="transform";
      const motion=glider.animate([
        {transform:`translate3d(0,${oldY}px,0) scale(1,${oldH/h})`},
        {transform:`translate3d(0,${oldY+(y-oldY)*.62}px,0) scale(1.018,1.028)`,offset:.58},
        {transform:`translate3d(0,${y}px,0) scale(1)`}
      ],{duration:420,easing:"cubic-bezier(.2,.82,.2,1)"});
      motion.onfinish=motion.oncancel=()=>{glider.style.willChange="auto";};
    }
    glider.dataset.y=y;glider.dataset.h=h;
    sidebar.classList.add("nav-glider-ready");
  }
  /* Shared semantic micro-interaction trigger. Hover requires a deliberate
     300 ms dwell; click always restarts the complete motion immediately. */
  function replayMicroMotion(element,className,duration=400){
    if(!element||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    restartCssMotion(element,className);
    clearTimeout(element._gpMicroResetTimer);
    element._gpMicroResetTimer=setTimeout(()=>element.classList.remove(className),duration+40);
  }
  function bindMicroMotion(element,className,duration=400){
    if(!element)return;
    element.addEventListener("pointerenter",()=>{
      clearTimeout(element._gpMicroHoverTimer);
      element._gpMicroHoverTimer=setTimeout(()=>{element._gpMicroHoverTimer=0;replayMicroMotion(element,className,duration);},300);
    });
    element.addEventListener("pointerleave",()=>{clearTimeout(element._gpMicroHoverTimer);element._gpMicroHoverTimer=0;});
    element.addEventListener("click",()=>{clearTimeout(element._gpMicroHoverTimer);element._gpMicroHoverTimer=0;replayMicroMotion(element,className,duration);});
  }
  function bindImmediateMotion(element,className,duration=300){
    if(!element)return;
    element.addEventListener("pointerdown",event=>{if(event.button===0)replayMicroMotion(element,className,duration);});
  }
  function playSidebarIconMotion(btn){
    if(!btn||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    /* CSS keyframes are the compatibility source of truth. Removing and
       re-adding this class restarts hover/click motion without SVG WAAPI. */
    restartCssMotion(btn,"icon-motion-run");
    clearTimeout(btn._iconMotionTimer);
    const resetAfter=620;
    btn._iconMotionTimer=setTimeout(()=>btn.classList.remove("icon-motion-run"),resetAfter);
  }
  const GP_VIEW_EXIT_MS=150,GP_VIEW_GAP_MS=32,GP_VIEW_ENTER_MS=180;
  let gpViewPhase="idle",gpPendingView=null,gpViewExitTimer=0,gpViewEnterTimer=0,gpViewTransitionToken=0;
  function refreshPrimaryViewLayout(viewName){
    requestAnimationFrame(()=>{
      fitActiveView($(`.view[data-view="${viewName}"]`));updateAllGliders(false);updateNavGlider(true);refreshScrollEdgeFrames();updateAdaptiveTextColors();updateContextualControlColors();
      if(viewName==="history")requestAnimationFrame(()=>{scheduleHistoryRender();refreshScrollEdgeFrames();if(typeof maybeAutoOpenAnnualReport==="function")maybeAutoOpenAnnualReport();});
      if(viewName==="player")requestAnimationFrame(()=>{$("#curTime").textContent=fmtTime(audio.currentTime);drawWaveform();drawDiscRotation();miniEqGeometry=null;drawMiniEq();syncMiniEqMeter();refreshNowTitleMarquee();});
    });
  }
  function switchPrimaryView(viewName){
    const current=$(".view.active"),requested=$(`.view[data-view="${viewName}"]`);
    if(!requested||!current||requested===current)return false;
    gpPendingView=viewName;
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){
      clearTimeout(gpViewExitTimer);clearTimeout(gpViewEnterTimer);gpViewPhase="idle";
      document.body.classList.remove("gp-view-transitioning");
      $$(".view").forEach(view=>{view.classList.remove("active","gp-view-exit","gp-view-enter");view.style.removeProperty("will-change");});
      requested.classList.add("active");refreshPrimaryViewLayout(viewName);return true;
    }
    /* Fade the complete outgoing view to the actual app background, hold that
       background briefly, then commit and fade in the destination. */
    if(gpViewPhase==="exit"||gpViewPhase==="enter")return true;
    const transitionToken=++gpViewTransitionToken;
    const destination=$(`.view[data-view="${gpPendingView}"]`)||current;
    gpViewPhase="exit";
    current.classList.remove("gp-view-enter");current.classList.add("gp-view-exit");
    clearTimeout(gpViewExitTimer);clearTimeout(gpViewEnterTimer);
    gpViewExitTimer=setTimeout(()=>{
      if(transitionToken!==gpViewTransitionToken)return;
      current.classList.remove("active","gp-view-exit");gpViewPhase="gap";
      gpViewEnterTimer=setTimeout(()=>{
        if(transitionToken!==gpViewTransitionToken)return;
        destination.style.opacity="0";destination.classList.add("active");fitActiveView(destination);updateAllGliders(false);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(transitionToken!==gpViewTransitionToken)return;
          destination.classList.add("gp-view-enter");destination.style.removeProperty("opacity");gpViewPhase="enter";refreshPrimaryViewLayout(destination.dataset.view);
          document.body.classList.remove("gp-view-transitioning");
          gpViewEnterTimer=setTimeout(()=>{
          if(transitionToken!==gpViewTransitionToken)return;
          destination.classList.remove("gp-view-enter");destination.style.removeProperty("will-change");
          document.body.classList.remove("gp-view-transitioning");
          $$(".view").forEach(view=>{if(view!==destination)view.classList.remove("active","gp-view-overlay","gp-view-enter","gp-view-exit");});
          gpViewPhase="idle";const latest=gpPendingView;if(latest&&latest!==destination.dataset.view)switchPrimaryView(latest);
          },GP_VIEW_ENTER_MS+24);
        }));
      },GP_VIEW_GAP_MS);
    },GP_VIEW_EXIT_MS+8);
    return true;
  }
  function mountPrimaryNavButton(btn){
    if(!btn||btn.dataset.gpNavMounted==="1")return;btn.dataset.gpNavMounted="1";
    btn.addEventListener("pointerenter",()=>{
      clearTimeout(btn._iconHoverTimer);
      btn._iconHoverTimer=setTimeout(()=>{btn._iconHoverTimer=0;playSidebarIconMotion(btn);},300);
    });
    btn.addEventListener("pointerleave",()=>{clearTimeout(btn._iconHoverTimer);btn._iconHoverTimer=0;});
    btn.addEventListener("click", () => {
      clearTimeout(btn._iconHoverTimer);btn._iconHoverTimer=0;
      playSidebarIconMotion(btn);
      if(btn.classList.contains("active"))return;
      $$(".nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      switchPrimaryView(btn.dataset.view);
      requestAnimationFrame(()=>updateNavGlider(true));
    });
  }
  $$(".nav-item").forEach(mountPrimaryNavButton);
  const sidebarShell=$("#appShell"),sidebar=$(".sidebar"),sidebarToggle=$("#sidebarToggle"),sidebarBrand=$(".brand"),sidebarBrandLogo=$(".brand-logo");
  let sidebarSettleTimer=0,sidebarBrandHintTimer=0,sidebarHintHandoffTimer=0,sidebarLabelFadeFrame=0;
  const sidebarHintIcon=document.createElement("span");
  sidebarHintIcon.className="sidebar-expand-hint-icon";
  sidebarHintIcon.setAttribute("aria-hidden","true");
  sidebarHintIcon.innerHTML=sidebarToggle?.querySelector("svg")?.outerHTML||"";
  sidebarBrand?.appendChild(sidebarHintIcon);
  function clearSidebarBrandHint(){
    clearTimeout(sidebarBrandHintTimer);sidebarBrandHintTimer=0;
    sidebar?.classList.remove("sidebar-brand-hint");
  }
  function refreshBrandOverflow(){
    const host=sidebarBrand?.querySelector(".brand-name"),track=host?.querySelector(".brand-name-track");if(!host||!track)return;
    const overflow=Math.max(0,track.scrollWidth-host.clientWidth);
    host.style.setProperty("--brand-scroll-distance",`${overflow}px`);
    host.classList.toggle("brand-name-overflow",overflow>2&&!sidebarShell?.classList.contains("sidebar-collapsed"));
  }
  const brandResizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(()=>requestAnimationFrame(refreshBrandOverflow)):null;
  [sidebar,sidebarBrand,sidebarBrand?.querySelector(".brand-name")].filter(Boolean).forEach(node=>brandResizeObserver?.observe(node));
  document.fonts?.ready?.then(()=>requestAnimationFrame(refreshBrandOverflow));
  function settleSidebarGeometry(){
    clearTimeout(sidebarSettleTimer);
    sidebarSettleTimer=setTimeout(()=>{updateNavGlider(false);fitActiveView();refreshScrollEdgeFrames();},540);
  }
  function cancelSidebarLabelFadeWatch(){
    if(sidebarLabelFadeFrame)cancelAnimationFrame(sidebarLabelFadeFrame);
    sidebarLabelFadeFrame=0;
  }
  function watchSidebarLabelContact(triggerRight){
    cancelSidebarLabelFadeWatch();
    const watch=()=>{
      if(!sidebarShell?.classList.contains("sidebar-collapsed")){sidebarLabelFadeFrame=0;return;}
      if(sidebar.getBoundingClientRect().right<=triggerRight){
        sidebarShell.classList.add("sidebar-label-fade-out");
        sidebarLabelFadeFrame=0;
        return;
      }
      sidebarLabelFadeFrame=requestAnimationFrame(watch);
    };
    sidebarLabelFadeFrame=requestAnimationFrame(watch);
  }
  function setSidebarCollapsed(collapsed,persist=true){
    collapsed=Boolean(collapsed);
    const wasCollapsed=sidebarShell?.classList.contains("sidebar-collapsed");
    const labelRects=collapsed&&!wasCollapsed?[...sidebar.querySelectorAll(".brand-name,.nav-label")].map(label=>label.getBoundingClientRect()).filter(rect=>rect.width>0):[];
    const labelContactRight=labelRects.length?Math.max(...labelRects.map(rect=>rect.right))+6:0;
    clearSidebarBrandHint();
    cancelSidebarLabelFadeWatch();
    if(!collapsed)sidebarShell?.classList.remove("sidebar-label-fade-out");
    sidebarShell?.classList.toggle("sidebar-collapsed",collapsed);
    if(collapsed){
      if(!persist||wasCollapsed||!labelContactRight)sidebarShell?.classList.add("sidebar-label-fade-out");
      else watchSidebarLabelContact(labelContactRight);
    }
    if(sidebarToggle){
      sidebarToggle.setAttribute("aria-expanded",String(!collapsed));
      const label=collapsed?tr("展开侧边栏","Expand Sidebar"):tr("收起侧边栏","Collapse Sidebar");
      sidebarToggle.setAttribute("aria-label",label);sidebarToggle.title=label;
    }
    if(sidebarBrandLogo){
      sidebarBrandLogo.setAttribute("role","img");
      sidebarBrandLogo.setAttribute("tabindex","-1");
      sidebarBrandLogo.setAttribute("aria-label","Glass Player");
    }
    if(sidebarBrand){
      sidebarBrand.setAttribute("role",collapsed?"button":"group");
      sidebarBrand.setAttribute("tabindex",collapsed?"0":"-1");
      sidebarBrand.setAttribute("aria-label",collapsed?tr("展开侧边栏","Expand Sidebar"):"Glass Player");
    }
    if(persist)GPBrowserStorage.setLocal("glassPlayerSidebarCollapsed",collapsed?"1":"0");
    settleSidebarGeometry();requestAnimationFrame(refreshBrandOverflow);
  }
  function expandSidebarFromHint(){
    clearTimeout(sidebarHintHandoffTimer);sidebarHintHandoffTimer=0;
    clearSidebarBrandHint();sidebar.classList.remove("sidebar-hint-flight");
    setSidebarCollapsed(false);
  }
  if(sidebarToggle&&sidebarShell&&sidebar){
    setSidebarCollapsed(GPBrowserStorage.getLocal("glassPlayerSidebarCollapsed")==="1",false);
    bindMicroMotion(sidebarToggle,"sidebar-toggle-motion",500);
    sidebarToggle.addEventListener("click",event=>{
      event.stopPropagation();
      const collapsing=!sidebarShell.classList.contains("sidebar-collapsed");
      setSidebarCollapsed(collapsing);
    });
    const expandFromBrand=event=>{
      if(!sidebarShell.classList.contains("sidebar-collapsed"))return;
      event.stopPropagation();
      const hinted=sidebar.classList.contains("sidebar-brand-hint");
      if(hinted)expandSidebarFromHint();else{clearSidebarBrandHint();setSidebarCollapsed(false);}
    };
    sidebarBrand?.addEventListener("click",expandFromBrand);
    sidebarBrand?.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();expandFromBrand(event);}});
    sidebarBrand?.addEventListener("pointerenter",()=>{
      if(!sidebarShell.classList.contains("sidebar-collapsed"))return;
      clearTimeout(sidebarBrandHintTimer);
      sidebarBrandHintTimer=setTimeout(()=>{
        sidebarBrandHintTimer=0;
        if(sidebarShell.classList.contains("sidebar-collapsed")&&sidebarBrand.matches(":hover"))sidebar.classList.add("sidebar-brand-hint");
      },550);
    });
    sidebarBrand?.addEventListener("pointerleave",clearSidebarBrandHint);
  }
  function activateSidebarView(viewName){
    $$(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===viewName));
    requestAnimationFrame(()=>updateNavGlider(true));
  }
  $("#buildBadgeBtn").addEventListener("click",()=>{
    activateSidebarView("settings");
    if(typeof activateSettingsCategory==="function")activateSettingsCategory("about");
    switchPrimaryView("changelog");
    GP.changelog.render();
  });
  $("#changelogBackBtn").addEventListener("click",()=>{
    activateSidebarView("settings");
    if(typeof activateSettingsCategory==="function")activateSettingsCategory("about");
    switchPrimaryView("settings");
  });
  bindMicroMotion($("#changelogBackBtn"),"changelog-back-motion",400);

  /* ================= panel tabs (queue / sound / recommend) ================= */
  const GLIDER_SELECTORS=["#panelTabs","#themeSeg","#bgSeg","#coverSeg","#rangeSeg","#languageSeg","#historyModeSeg","#spatialModeSeg","#eqSoundPresetSeg","#eqDevicePresetSeg"];
  GLIDER_SELECTORS.forEach(selector=>$(selector)?.setAttribute("data-gp-glider",""));
  const NOOP_ACTIVE_SEGMENTS=[...GLIDER_SELECTORS,"#eqPresetSeg",".gp-segmented","[data-gp-glider]"];
  document.addEventListener("click",event=>{
    const group=event.target.closest?.(NOOP_ACTIVE_SEGMENTS.join(","));
    const button=event.target.closest?.("button");
    if(group?.id==="spatialModeSeg"&&!spatialEnabled)return;
    if(group&&button&&group.contains(button)&&button.classList.contains("active")){
      // Clicking the already selected option is a true no-op. Switching away
      // and returning still runs the normal refresh path.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
  function updateGlider(group,animate=true){
    if(!group)return;const active=group.querySelector("button.active");if(!active)return;
    let glider=group.querySelector(":scope>.segment-glider");if(!glider){glider=document.createElement("div");glider.className="segment-glider";group.prepend(glider);}
    const x=active.offsetLeft,y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight;
    if(!w||!h){group.classList.remove("glider-ready");return;}
    const targetKey=[x,y,w,h].join(":");if(glider._gpMotion?.playState==="running"&&glider._gpTargetKey===targetKey)return;
    let oldX=Number(glider.dataset.x||x),oldY=Number(glider.dataset.y||y),oldW=Number(glider.dataset.w||w),oldH=Number(glider.dataset.h||h);
    if(glider._gpMotion?.playState==="running"){
      const groupRect=group.getBoundingClientRect(),gliderRect=glider.getBoundingClientRect(),scaleX=group.offsetWidth?groupRect.width/group.offsetWidth:1,scaleY=group.offsetHeight?groupRect.height/group.offsetHeight:scaleX;
      oldX=(gliderRect.left-groupRect.left)/Math.max(scaleX,.001);oldY=(gliderRect.top-groupRect.top)/Math.max(scaleY,.001);oldW=gliderRect.width/Math.max(scaleX,.001);oldH=gliderRect.height/Math.max(scaleY,.001);
      glider._gpMotion.cancel();glider._gpMotion=null;
    }
    glider.style.width=`${w}px`;glider.style.height=`${h}px`;glider.style.transform=`translate3d(${x}px,${y}px,0)`;glider._gpTargetKey=targetKey;
    if(animate&&(Math.abs(oldX-x)>.5||Math.abs(oldY-y)>.5||Math.abs(oldW-w)>.5||Math.abs(oldH-h)>.5)){
      const spatialOnly=group.id==="spatialModeSeg";
      glider.style.willChange=spatialOnly?"transform,width,height":"transform";
      const frames=spatialOnly?[
        {transform:`translate3d(${oldX}px,${oldY}px,0)`,width:`${oldW}px`,height:`${oldH}px`},
        {transform:`translate3d(${x}px,${y}px,0)`,width:`${w}px`,height:`${h}px`}
      ]:[
        {transform:`translate3d(${oldX}px,${oldY}px,0) scale(${oldW/w},${oldH/h})`},
        {transform:`translate3d(${oldX+(x-oldX)*.58}px,${oldY+(y-oldY)*.58}px,0) scale(${oldW/w*1.045},${oldH/h*1.025})`,offset:.5},
        {transform:`translate3d(${x}px,${y}px,0) scale(1)`}
      ];
      const motion=glider.animate(frames,{duration:spatialOnly?260:310,easing:spatialOnly?"cubic-bezier(.22,.72,.22,1)":"cubic-bezier(.2,.82,.2,1)",fill:"both"});glider._gpMotion=motion;
      motion.onfinish=()=>{if(glider._gpMotion!==motion)return;glider._gpMotion=null;glider.style.willChange="auto";motion.cancel();};
    }
    glider.dataset.x=x;glider.dataset.y=y;glider.dataset.w=w;glider.dataset.h=h;
    group.classList.add("glider-ready");
  }
  function gpElementIsRenderable(element){
    if(!element?.isConnected)return false;
    const view=element.closest?.(".view");
    if(view&&!view.classList.contains("active")&&!view.classList.contains("gp-view-overlay"))return false;
    return element.getClientRects().length>0;
  }
  function updateAllGliders(animate=true){$$('[data-gp-glider],.gp-segmented').forEach(group=>{if(gpElementIsRenderable(group))updateGlider(group,animate);});}
  function initializeSelectionGliders(){updateAllGliders(false);updateNavGlider(false);}
  document.addEventListener("click",e=>{const group=e.target.closest?.('[data-gp-glider],.gp-segmented');if(group&&e.target.closest("button"))requestAnimationFrame(()=>updateGlider(group,true));});

  /* GP Core 2.1: the panel shell is stationary; only its viewport moves.
     GP Motion Engine 2.0: complete moving sectors dissolve into that shell. */
  const GP_SCROLL_EDGE_SELECTORS=["#queueBody","#recommendBody","#trackList","#historyRankingLeft","#historyRanks11to50","#settingsPanel","#releaseIndex","#releaseDetail","#favoritesGrid","#dataDashboard","#annualReportBody"];
  const GP_SCROLLBAR_SELECTOR=".panel-body,.track-list,.history-ranking-left,.history-ranks-list,.settings-panel,.font-picker-pop,.release-index,.release-detail,.favorites-grid,.data-dashboard,.annual-report-body";
  const GP_SCROLL_INTENT_WINDOW_MS=900;
  const gpScrollbarTimers=new WeakMap();
  const gpScrollIntentUntil=new WeakMap();
  function scrollSurfaceFromTarget(target){
    if(target instanceof Element)return target.closest(GP_SCROLLBAR_SELECTOR);
    return document.activeElement instanceof Element?document.activeElement.closest(GP_SCROLLBAR_SELECTOR):null;
  }
  function markScrollIntent(surface){
    if(!(surface instanceof Element)||surface.scrollHeight<=surface.clientHeight+1)return;
    gpScrollIntentUntil.set(surface,performance.now()+GP_SCROLL_INTENT_WINDOW_MS);
  }
  function revealLiquidScrollbar(surface){
    if(!(surface instanceof Element)||surface.scrollHeight<=surface.clientHeight+1||performance.now()>(gpScrollIntentUntil.get(surface)||0))return;
    clearTimeout(gpScrollbarTimers.get(surface));surface.classList.add("gp-scrollbar-active");
    gpScrollbarTimers.set(surface,setTimeout(()=>surface.classList.remove("gp-scrollbar-active"),500));
  }
  document.addEventListener("wheel",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("touchstart",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("pointerdown",event=>markScrollIntent(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  document.addEventListener("keydown",event=>{
    if(["ArrowUp","ArrowDown","PageUp","PageDown","Home","End","Space"].includes(event.code))markScrollIntent(scrollSurfaceFromTarget(event.target));
  },true);
  document.addEventListener("scroll",event=>revealLiquidScrollbar(scrollSurfaceFromTarget(event.target)),{capture:true,passive:true});
  const GP_OWN_SURFACE_IDS=new Set(["topList","settingsPanel","releaseIndex","releaseDetail"]);
  const GP_SHARED_SHELLS={queueBody:".side-panel",recommendBody:".side-panel",trackList:".library-panel",historyRankingLeft:".top-list",historyRanks11to50:".top-list",favoritesGrid:"#historyFavoritesPane",dataDashboard:"#historyDataPane",annualReportBody:".annual-report-dialog"};
  const gpEdgeUpdateFrames=new WeakMap();
  function prepareScrollSurface(el){
    if(!el)return null;
    let shell=null;
    if(GP_OWN_SURFACE_IDS.has(el.id)||el.matches('[data-gp-sse-shell="own"],.gp-sse-own')){
      if(el.parentElement?.classList.contains("gp-sse-owned-shell"))shell=el.parentElement;
      else{
        shell=document.createElement("div");
        shell.className=`gp-sse-shell gp-sse-owned-shell gp-sse-shell-${el.id}`;
        if(el.classList.contains("glass")){el.classList.remove("glass");shell.classList.add("glass");}
        el.parentNode.insertBefore(shell,el);shell.appendChild(el);
      }
    }else{
      const selector=GP_SHARED_SHELLS[el.id];
      shell=selector?el.closest(selector):el.closest('[data-gp-sse-shell]:not([data-gp-sse-shell="own"]),.gp-panel,.side-panel,.library-panel')||el.parentElement;
      shell?.classList.add("gp-sse-shell",`gp-sse-shell-${el.id}`);
    }
    el.classList.remove("gp-scroll-edge","gp-sse-native","edge-top","edge-bottom");
    el.classList.add("gp-sse-viewport");
    el.dataset.edgeReady="1";
    return shell;
  }
  function updateScrollEdge(el){
    if(!el)return;
    const scrollable=el.scrollHeight>el.clientHeight+3;
    const hasTop=scrollable&&el.scrollTop>1;
    const hasBottom=scrollable&&el.scrollTop+el.clientHeight<el.scrollHeight-1;
    el.classList.toggle("gp-has-top",hasTop);
    el.classList.toggle("gp-has-bottom",hasBottom);
    const shell=el.closest(".gp-sse-shell");
    shell?.classList.toggle(`gp-${el.id}-has-top`,hasTop);
    shell?.classList.toggle(`gp-${el.id}-has-bottom`,hasBottom);
  }
  function scheduleScrollEdgeUpdate(el){
    if(!gpElementIsRenderable(el))return;
    const old=gpEdgeUpdateFrames.get(el);if(old)cancelAnimationFrame(old);
    gpEdgeUpdateFrames.set(el,requestAnimationFrame(()=>{gpEdgeUpdateFrames.delete(el);updateScrollEdge(el);}));
  }
  function initializeScrollEdges(){
    GP_SCROLL_EDGE_SELECTORS.forEach(selector=>{
      const el=$(selector);if(el)el.setAttribute("data-gp-sse","");
    });
  }
  function mountScrollEdge(el){
    if(!el||el.dataset.gpSseMounted==="1")return;
    el.dataset.gpSseMounted="1";prepareScrollSurface(el);
    el.addEventListener("scroll",()=>scheduleScrollEdgeUpdate(el),{passive:true});
    if("ResizeObserver" in window)new ResizeObserver(()=>scheduleScrollEdgeUpdate(el)).observe(el);
    new MutationObserver(()=>{if(el.dataset.gpSseBatch!=="1")scheduleScrollEdgeUpdate(el);}).observe(el,{childList:true,subtree:true});
    requestAnimationFrame(()=>updateScrollEdge(el));
  }
  function refreshScrollEdgeFrames(){$$('[data-gp-sse],.gp-sse').forEach(element=>{if(gpElementIsRenderable(element))scheduleScrollEdgeUpdate(element);});}
  window.addEventListener("resize",()=>requestAnimationFrame(refreshScrollEdgeFrames),{passive:true});
  initializeScrollEdges();

  /* ================= 6.0.0 GP Core 2.3 / Motion Engine 3.1 =================
     Declarative UI registry. A component is mounted once, can be refreshed as
     layout changes, and is discovered automatically when future views append
     matching class/data contracts. Existing 5.6.3 markup remains authoritative. */
  const gpUIComponents=new Map(),gpUIMountState=new WeakMap();
  const gpUIPendingRoots=new Set();let gpUIObserver=null,gpUIMountFrame=0;
  function gpUIComponentTargets(root,selector){
    if(!root||!selector)return[];const targets=[];
    if(root.nodeType===1&&root.matches?.(selector))targets.push(root);
    root.querySelectorAll?.(selector).forEach(element=>targets.push(element));
    return targets;
  }
  const GPUIRegistry={
    version:"3.0",
    contracts:Object.freeze({action:"gp-action",view:"GP.motion.transitionView",sector:"GP.motion.transitionSector",sse:"gp-sse / data-gp-sse",glider:"gp-segmented / data-gp-glider",popover:"gp-popover / data-gp-popover",adaptiveTitle:"gp-adaptive-title",contextControl:"gp-context-control"}),
    register(name,definition){
      if(!name||!definition?.selector||typeof definition.mount!=="function")throw new Error("Invalid GP UI component registration");
      gpUIComponents.set(name,Object.freeze({...definition,name}));return this;
    },
    mount(root=document){
      gpUIComponents.forEach((component,name)=>{
        gpUIComponentTargets(root,component.selector).forEach(element=>{
          let mounted=gpUIMountState.get(element);if(!mounted){mounted=new Set();gpUIMountState.set(element,mounted);}
          if(mounted.has(name))return;mounted.add(name);
          try{component.mount(element,this);}catch(error){mounted.delete(name);console.warn(`GP UI mount failed: ${name}`,error);}
        });
      });return root;
    },
    refresh(root=document,animate=false){
      gpUIComponents.forEach((component,name)=>{
        if(typeof component.refresh!=="function")return;
        gpUIComponentTargets(root,component.selector).forEach(element=>{
          if(gpUIMountState.get(element)?.has(name))component.refresh(element,animate,this);
        });
      });return root;
    },
    observe(root=document.body){
      if(gpUIObserver||!root)return gpUIObserver;
      gpUIObserver=new MutationObserver(records=>{
        records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)gpUIPendingRoots.add(node);}));
        if(!gpUIPendingRoots.size||gpUIMountFrame)return;
        gpUIMountFrame=requestAnimationFrame(()=>{
          gpUIMountFrame=0;const roots=[...gpUIPendingRoots];gpUIPendingRoots.clear();
          roots.forEach(node=>this.mount(node));
        });
      });
      gpUIObserver.observe(root,{childList:true,subtree:true});return gpUIObserver;
    },
    switchView:switchPrimaryView,
    transitionSector:transitionMotionSector,
    setPopover:setMotionPopover
  };
  function mountRangeGlass(element){
    const eligible=!element.matches?.(".eq-slider");
    const settingsRange=element.matches?.("#crossfadeSlider,#fontSizeSlider,#fontWeightSlider");
    if(settingsRange)element.classList.add("gp-settings-range");
    let pointerId=null,pointerMoved=false,pointerDownX=0,pointerDownTarget=Number(element.value||0),targetValue=pointerDownTarget,visualValue=targetValue,rangeFrame=0,animationStart=0,animationFrom=targetValue,commitOnSettle=false;
    const limits=()=>({min:Number(element.min||0),max:Number(element.max||100),step:Number(element.step||0)});
    const clampValue=value=>{const {min,max}=limits();return Math.max(min,Math.min(max,Number(value)||0));};
    const snapValue=value=>{const {min,max,step}=limits();if(!(step>0))return Math.max(min,Math.min(max,value));return Math.max(min,Math.min(max,min+Math.round((value-min)/step)*step));};
    const syncProgress=()=>{
      if(element.id==="seek"||element.id==="vol")return;
      const min=Number(element.min||0),max=Number(element.max||100),value=Number(element.value||0),pct=max>min?(value-min)/(max-min):0;
      element.style.setProperty("--gp-range-pct",`${Math.max(0,Math.min(1,pct))*100}%`);
    };
    const emitValue=value=>{
      element.value=String(clampValue(value));syncProgress();
      element.dispatchEvent(new Event("input",{bubbles:true}));
    };
    const valueAtX=clientX=>{
      const rect=element.getBoundingClientRect(),{min,max}=limits(),ratio=rect.width?Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)):0;
      return min+ratio*(max-min);
    };
    const settleRange=timestamp=>{
      if(!animationStart)animationStart=timestamp;
      const progress=Math.max(0,Math.min(1,(timestamp-animationStart)/100));
      visualValue=animationFrom+(targetValue-animationFrom)*progress;
      emitValue(visualValue);
      if(progress>=1){
        rangeFrame=0;visualValue=snapValue(targetValue);emitValue(visualValue);animationStart=0;
        if(pointerId===null)element.classList.remove("dragging");
        if(commitOnSettle){commitOnSettle=false;element.dispatchEvent(new Event("change",{bubbles:true}));}
        return;
      }
      rangeFrame=requestAnimationFrame(settleRange);
    };
    const animateTo=(value,commit=false)=>{
      const nextTarget=snapValue(clampValue(value));
      animationFrom=visualValue;targetValue=nextTarget;animationStart=0;
      commitOnSettle=commitOnSettle||commit;
      if(!rangeFrame)rangeFrame=requestAnimationFrame(settleRange);
    };
    element._gpAnimateRangeTo=(value,commit=true)=>animateTo(value,commit);
    const begin=event=>{
      if(!eligible||event.button!==0)return;
      event.preventDefault();
      if(rangeFrame)cancelAnimationFrame(rangeFrame);
      rangeFrame=0;animationStart=0;pointerId=event.pointerId;pointerMoved=false;pointerDownX=event.clientX;
      pointerDownTarget=snapValue(valueAtX(event.clientX));targetValue=pointerDownTarget;commitOnSettle=false;visualValue=Number(element.value||0);
      element.classList.add("dragging");element.focus({preventScroll:true});element.setPointerCapture?.(event.pointerId);
      animateTo(pointerDownTarget,false);
    };
    const move=event=>{
      if(pointerId!==event.pointerId)return;
      event.preventDefault();
      if(Math.abs(event.clientX-pointerDownX)>3)pointerMoved=true;
      if(!pointerMoved)return;
      if(rangeFrame)cancelAnimationFrame(rangeFrame);
      rangeFrame=0;animationStart=0;
      targetValue=snapValue(valueAtX(event.clientX));visualValue=targetValue;emitValue(visualValue);
    };
    const release=event=>{
      if(pointerId===null||event?.pointerId!==pointerId)return;
      const releasedPointerId=pointerId,dragged=pointerMoved;pointerId=null;pointerMoved=false;
      if(element.hasPointerCapture?.(releasedPointerId))element.releasePointerCapture(releasedPointerId);
      if(dragged){
        if(Number.isFinite(event.clientX))targetValue=snapValue(valueAtX(event.clientX));
        visualValue=targetValue;emitValue(visualValue);element.classList.remove("dragging");
        element.dispatchEvent(new Event("change",{bubbles:true}));
      }else{
        animateTo(pointerDownTarget,true);
      }
    };
    const cancel=event=>{
      if(pointerId===null||event?.pointerId!==pointerId)return;
      const dragged=pointerMoved;pointerId=null;pointerMoved=false;
      if(dragged){
        targetValue=visualValue=Number(element.value||0);element.classList.remove("dragging");
        element.dispatchEvent(new Event("change",{bubbles:true}));
      }else animateTo(pointerDownTarget,true);
    };
    element.addEventListener("pointerdown",begin);element.addEventListener("pointermove",move);
    element.addEventListener("pointerup",release);element.addEventListener("pointercancel",cancel);
    element.addEventListener("click",event=>{if(eligible)event.preventDefault();});
    element.addEventListener("input",()=>{
      syncProgress();
      if(pointerId===null&&!rangeFrame)targetValue=Number(element.value||0);
    });
    if(settingsRange){window.addEventListener("resize",syncProgress,{passive:true});document.addEventListener("scroll",syncProgress,true);}
    syncProgress();
  }
  GPUIRegistry
    .register("action",{selector:".gp-action",mount:element=>element.classList.add("ripple-target")})
    .register("primary-nav",{selector:".nav-item[data-view],.gp-nav-item[data-view]",mount:mountPrimaryNavButton})
    .register("range",{selector:'input[type="range"],.gp-range',mount:mountRangeGlass})
    .register("glider",{selector:"[data-gp-glider],.gp-segmented",mount:element=>{
      if(element.classList.contains("gp-segmented"))element.classList.add("segmented");
      requestAnimationFrame(()=>updateGlider(element,false));
      if(!element._gpGliderResizeObserver){
        element._gpGliderResizeObserver=new ResizeObserver(()=>requestAnimationFrame(()=>updateGlider(element,false)));
        element._gpGliderResizeObserver.observe(element);
      }
      document.fonts?.ready?.then(()=>requestAnimationFrame(()=>updateGlider(element,false)));
    },refresh:(element,animate)=>updateGlider(element,animate)})
    .register("sse",{selector:"[data-gp-sse],.gp-sse",mount:mountScrollEdge,refresh:element=>scheduleScrollEdgeUpdate(element)})
    .register("popover",{selector:"[data-gp-popover],.gp-popover",mount:element=>element.classList.add("gp-motion-popover")})
    .register("adaptive-title",{selector:".gp-adaptive-title",mount:()=>{},refresh:element=>{
      const surface=elementSurface(element),black=[17,18,22],white=[250,250,252];
      element.style.color=contrastRatio(black,surface)>=contrastRatio(white,surface)?"rgb(17,18,22)":"rgb(250,250,252)";
    }})
    .register("context-control",{selector:".gp-context-control",mount:()=>{},refresh:element=>{
      const surface=elementSurface(element),light=activeTheme()==="light",tone=mixRgb(surface,[255,255,255],light?.42:.1),accented=mixRgb(tone,currentAccentRgb(),light?.035:.065);
      element.style.setProperty("--context-control-bg",`rgba(${accented.join(",")},${light?.74:.62})`);
      element.style.setProperty("--context-control-border",`rgba(${currentAccentRgb().join(",")},${light?.09:.14})`);
    }});
  GP.ui=Object.assign(GP.ui||{},GPUIModules,{core:GPUIRegistry,mount:root=>GPUIRegistry.mount(root),refresh:(root,animate)=>GPUIRegistry.refresh(root,animate),observe:root=>GPUIRegistry.observe(root),switchView:switchPrimaryView,transitionSector:transitionMotionSector,setPopover:setMotionPopover});
  GP.motion=Object.freeze({version:"3.3",targetFps:GP_MOTION_TARGET_FPS,transitionView:switchPrimaryView,transitionSector:transitionMotionSector,setPopover:setMotionPopover});
  function transitionQueueContent(commit){
    const body=$("#queueBody");if(!body||typeof commit!=="function"){commit?.();return;}
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){commit();return;}
    body.getAnimations().forEach(animation=>animation.cancel());
    const out=body.animate([{opacity:1},{opacity:0}],{duration:126,easing:"ease-out",fill:"forwards"});
    out.onfinish=()=>{
      commit();body.getAnimations().forEach(animation=>animation.cancel());body.style.opacity="0";
      setTimeout(()=>{body.style.removeProperty("opacity");body.animate([{opacity:0},{opacity:1}],{duration:155,easing:"cubic-bezier(.18,.74,.2,1)"});},42);
    };
  }
  document.addEventListener("click",event=>{
    const trigger=event.target.closest?.("[data-gp-popover-target]");if(!trigger)return;
    const target=trigger.getAttribute("data-gp-popover-target"),popover=target?(document.querySelector(target)||document.getElementById(target.replace(/^#/,""))):null;
    if(popover){event.stopPropagation();setMotionPopover(popover,!popover.classList.contains("show"));}
  });
  document.addEventListener("click",event=>{
    if(event.target.closest?.("[data-gp-popover-target]"))return;
    $$("[data-gp-popover].show,.gp-popover.show").forEach(popover=>{if(!popover.contains(event.target))setMotionPopover(popover,false);});
  });
  $("#panelTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    if(btn.classList.contains("active"))return;
    const tab = btn.dataset.tab;
    const bodies={queue:$("#queueBody"),recommend:$("#recommendBody")};
    const host=$("#panelTabs");
    $$("#panelTabs button").forEach(b => b.classList.toggle("active",b===btn));
    requestAnimationFrame(()=>updateGlider(host,true));
    transitionMotionSector(host,()=>Object.values(bodies).find(body=>body.style.display!=="none"),()=>{
      const finalTab=$("#panelTabs button.active")?.dataset.tab||tab;
      Object.entries(bodies).forEach(([key,body])=>{body.style.display=key===finalTab?"block":"none";body.classList.remove("panel-enter");});
      if(finalTab==="queue"&&!manualQueueActive)positionCurrentQueueRow(false);
      if(finalTab === "recommend")renderRecommendList();
      requestAnimationFrame(refreshScrollEdgeFrames);return bodies[finalTab];
    },true);
  });

  /* ================= helpers ================= */
  const fmtTime=(...args)=>GP.utils.formatTime(...args);
  function fmtDuration(totalSec){
    totalSec = Math.round(totalSec||0);
    const h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60);
    if(h>0) return tr(`${h}小时${m}分钟`,`${h}h ${m}m`);
    if(m>0) return tr(`${m}分钟`,`${m} min`);
    return tr(`${totalSec}秒`,`${totalSec} sec`);
  }
  function hashString(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; } return Math.abs(h); }
  function parseName(filename){
    const clean = filename.replace(/\.[^/.]+$/, "");
    if(clean.includes(" - ")){ const [a,...rest]=clean.split(" - "); return {artist:a.trim(), title:rest.join(" - ").trim()}; }
    return {artist:"未知艺人", title:clean};
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function trackKey(t){ return t.artist + "||" + t.title; }
  function todayKey(d){ d = d || new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function hexToRgbArr(hex){ const v=hex.replace("#",""); return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)]; }

  /* ================= embedded cover extraction ================= */
  async function extractID3Cover(file){
    let sliceSize = Math.min(file.size, 1*1024*1024);
    let buf = await readFileBuffer(file,0,sliceSize);
    let view = new DataView(buf);
    if(buf.byteLength < 10) return null;
    if(String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2)) !== "ID3") return null;
    const majorVer = view.getUint8(3);
    const flags = view.getUint8(5);
    const tagSize = ((view.getUint8(6)&0x7f)<<21)|((view.getUint8(7)&0x7f)<<14)|((view.getUint8(8)&0x7f)<<7)|(view.getUint8(9)&0x7f);
    const tagEnd = 10 + tagSize;
    if(tagEnd > buf.byteLength){
      sliceSize = Math.min(file.size, tagEnd + 16);
      buf = await readFileBuffer(file,0,sliceSize);
      view = new DataView(buf);
    }
    let offset = 10;
    if(flags & 0x40){
      let extSize;
      if(majorVer === 4) extSize = ((view.getUint8(offset)&0x7f)<<21)|((view.getUint8(offset+1)&0x7f)<<14)|((view.getUint8(offset+2)&0x7f)<<7)|(view.getUint8(offset+3)&0x7f);
      else extSize = view.getUint32(offset);
      offset += extSize + (majorVer === 4 ? 0 : 4);
    }
    while(offset < tagEnd - 10 && offset < buf.byteLength - 10){
      let frameId, frameSize;
      if(majorVer >= 3){
        frameId = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
        if(!/^[A-Z0-9]{4}$/.test(frameId)) break;
        frameSize = majorVer === 4
          ? ((view.getUint8(offset+4)&0x7f)<<21)|((view.getUint8(offset+5)&0x7f)<<14)|((view.getUint8(offset+6)&0x7f)<<7)|(view.getUint8(offset+7)&0x7f)
          : view.getUint32(offset+4);
        offset += 10;
      } else {
        frameId = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2));
        if(!/^[A-Z0-9]{3}$/.test(frameId)) break;
        frameSize = (view.getUint8(offset+3)<<16)|(view.getUint8(offset+4)<<8)|view.getUint8(offset+5);
        offset += 6;
      }
      if(frameSize <= 0) break;
      const frameEnd = offset + frameSize;
      if(frameId === "APIC" || frameId === "PIC"){
        if(frameEnd > buf.byteLength){
          sliceSize = Math.min(file.size, frameEnd + 16);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
        }
        let p = offset;
        const encoding = view.getUint8(p); p += 1;
        let mime;
        if(frameId === "APIC"){
          let e = p; while(e < buf.byteLength && view.getUint8(e) !== 0) e++;
          mime = new TextDecoder("latin1").decode(new Uint8Array(buf, p, e-p)); p = e+1;
        } else {
          mime = "image/" + new TextDecoder("latin1").decode(new Uint8Array(buf, p, 3)).toLowerCase(); p += 3;
        }
        p += 1; // picture type byte
        if(encoding === 1 || encoding === 2){
          while(p < buf.byteLength-1 && !(view.getUint8(p)===0 && view.getUint8(p+1)===0)) p += 2;
          p += 2;
        } else {
          while(p < buf.byteLength && view.getUint8(p) !== 0) p += 1;
          p += 1;
        }
        const imgBytes = buf.slice(p, frameEnd);
        if(imgBytes.byteLength < 50) return null;
        return URL.createObjectURL(new Blob([imgBytes], {type: mime || "image/jpeg"}));
      }
      offset = frameEnd;
    }
    return null;
  }

  async function extractFLACCover(file){
    let sliceSize = Math.min(file.size, 2*1024*1024);
    let buf = await readFileBuffer(file,0,sliceSize);
    let view = new DataView(buf);
    if(buf.byteLength < 4 || String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3)) !== "fLaC") return null;
    let offset = 4;
    while(offset < buf.byteLength - 4){
      const header = view.getUint8(offset);
      const isLast = (header & 0x80) !== 0;
      const blockType = header & 0x7f;
      const blockSize = (view.getUint8(offset+1)<<16)|(view.getUint8(offset+2)<<8)|view.getUint8(offset+3);
      const blockStart = offset + 4;
      const blockEnd = blockStart + blockSize;
      if(blockType === 6){
        if(blockEnd > buf.byteLength){
          sliceSize = Math.min(file.size, blockEnd + 16);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
          if(blockEnd > buf.byteLength) return null;
        }
        let p = blockStart;
        p += 4; // picture type
        const mimeLen = view.getUint32(p); p += 4;
        const mime = new TextDecoder("latin1").decode(new Uint8Array(buf, p, mimeLen)); p += mimeLen;
        const descLen = view.getUint32(p); p += 4; p += descLen;
        p += 16; // width, height, depth, colors
        const dataLen = view.getUint32(p); p += 4;
        if(p + dataLen > buf.byteLength){
          sliceSize = Math.min(file.size, p + dataLen + 8);
          buf = await readFileBuffer(file,0,sliceSize);
          view = new DataView(buf);
        }
        const imgBytes = buf.slice(p, p+dataLen);
        return URL.createObjectURL(new Blob([imgBytes], {type: mime || "image/jpeg"}));
      }
      offset = blockEnd;
      if(isLast) break;
    }
    return null;
  }

  async function extractMP4Cover(file){
    let offset=0,moovBuffer=null,guard=0;
    while(offset+8<=file.size&&guard++<4096){
      const header=await readFileBuffer(file,offset,Math.min(file.size,offset+16)-offset);
      if(header.byteLength<8)break;
      const headerView=new DataView(header);
      let size=headerView.getUint32(0),headerLen=8;
      const type=String.fromCharCode(headerView.getUint8(4),headerView.getUint8(5),headerView.getUint8(6),headerView.getUint8(7));
      if(size===1){if(header.byteLength<16)break;size=Number(headerView.getBigUint64(8));headerLen=16;}
      else if(size===0)size=file.size-offset;
      if(!Number.isFinite(size)||size<headerLen||offset+size>file.size)break;
      if(type==="moov"){
        if(size>32*1024*1024)return null;
        moovBuffer=await readFileBuffer(file,offset,size);break;
      }
      offset+=size;
    }
    if(!moovBuffer)return null;
    const buf=moovBuffer;
    const view=new DataView(buf);
    function walk(start, end, isMeta){
      let offset = start;
      while(offset < end - 8){
        let size = view.getUint32(offset);
        const type = String.fromCharCode(view.getUint8(offset+4),view.getUint8(offset+5),view.getUint8(offset+6),view.getUint8(offset+7));
        let headerLen = 8;
        if(size === 1){ size = Number(view.getBigUint64(offset+8)); headerLen = 16; }
        else if(size === 0){ size = end - offset; }
        if(size <= 0 || offset + size > end) break;
        if(type === "moov" || type === "udta"){
          const found = walk(offset+headerLen, offset+size, false);
          if(found) return found;
        } else if(type === "meta"){
          const found = walk(offset+headerLen+4, offset+size, true); // meta has 4-byte version/flags
          if(found) return found;
        } else if(type === "ilst"){
          const found = walk(offset+headerLen, offset+size, false);
          if(found) return found;
        } else if(type === "covr"){
          let p = offset + headerLen;
          const boxEnd = offset + size;
          while(p < boxEnd - 8){
            const dsize = view.getUint32(p);
            const dtype = String.fromCharCode(view.getUint8(p+4),view.getUint8(p+5),view.getUint8(p+6),view.getUint8(p+7));
            if(dsize <= 0) break;
            if(dtype === "data"){
              const dataFlags = view.getUint32(p+8);
              const dataStart = p+16;
              const dataLen = dsize-16;
              const mime = dataFlags === 14 ? "image/png" : "image/jpeg";
              return {mime, bytes: buf.slice(dataStart, dataStart+dataLen)};
            }
            p += dsize;
          }
        }
        offset += size;
      }
      return null;
    }
    const result = walk(0, buf.byteLength, false);
    if(result){
      return URL.createObjectURL(new Blob([result.bytes], {type: result.mime}));
    }
    return null;
  }

  async function extractEmbeddedCover(file){
    try{
      const name = file.name.toLowerCase();
      if(name.endsWith(".flac")) return await extractFLACCover(file);
      if(name.endsWith(".m4a") || name.endsWith(".mp4") || name.endsWith(".aac")) return await extractMP4Cover(file);
      return await extractID3Cover(file);
    }catch(e){ return null; }
  }

  /* ================= genre tag extraction (ID3 TCON / FLAC VORBIS GENRE) ================= */
  const ID3_GENRES = ["Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal","New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial","Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk","Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise","AlternRock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic","Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta","Top 40","Christian Rap","Pop/Funk","Jungle","Native US","Cabaret","New Wave","Psychedelic","Rave","Showtunes","Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock"];
  function cleanMetadataText(value){
    /* NUL bytes at the ends of ID3 text frames terminate the field. Only NULs
       inside the decoded value represent multiple artists or values. */
    const cleaned=String(value||"")
      .replace(/^\uFEFF/,"")
      .replace(/^\u0000+|\u0000+$/g,"")
      .replace(/\u0000+/g," / ")
      .replace(/\s*\/\s*\/\s*/g," / ")
      .replace(/(?:\s*\/\s*)+$/g,"")
      .replace(/\s+/g," ")
      .trim();
    /* Multi-value tags may repeat the exact same artist (for example two
       identical TPE1/Vorbis ARTIST values). Deduplicate only spaced separators
       created by metadata parsing so legitimate names such as AC/DC remain
       untouched. */
    const values=cleaned.split(/\s+\/\s+/).map(part=>part.trim()).filter(Boolean);
    if(values.length<2)return cleaned;
    const seen=new Set();
    return values.filter(part=>{const key=part.normalize("NFKC").toLocaleLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).join(" / ");
  }
  function decodeID3Text(bytes,encodingByte){
    const encoding=encodingByte===1?"utf-16":encodingByte===2?"utf-16be":encodingByte===3?"utf-8":"windows-1252";
    try{return cleanMetadataText(new TextDecoder(encoding).decode(bytes));}
    catch(error){return cleanMetadataText(new TextDecoder("latin1").decode(bytes));}
  }
  async function extractID3Metadata(file){
    const result={title:null,artist:null,album:null,date:null,genre:null};
    try{
      const header=await readFileBuffer(file,0,10),head=new DataView(header);
      if(header.byteLength<10||String.fromCharCode(head.getUint8(0),head.getUint8(1),head.getUint8(2))!=="ID3")return result;
      const major=head.getUint8(3),tagSize=((head.getUint8(6)&0x7f)<<21)|((head.getUint8(7)&0x7f)<<14)|((head.getUint8(8)&0x7f)<<7)|(head.getUint8(9)&0x7f);
      const buffer=await readFileBuffer(file,0,Math.min(file.size,10+tagSize)),view=new DataView(buffer),tagEnd=Math.min(10+tagSize,buffer.byteLength);
      const frameMap={TIT2:"title",TT2:"title",TPE1:"artist",TP1:"artist",TALB:"album",TAL:"album",TDRC:"date",TYER:"date",TYE:"date",TCON:"genre",TCO:"genre"};
      let offset=10;
      while(offset<tagEnd-6){
        let id,size,headerLength;
        if(major===2){id=String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2));if(!/^[A-Z0-9]{3}$/.test(id))break;size=(view.getUint8(offset+3)<<16)|(view.getUint8(offset+4)<<8)|view.getUint8(offset+5);headerLength=6;}
        else{id=String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));if(!/^[A-Z0-9]{4}$/.test(id))break;size=major>=4?((view.getUint8(offset+4)&0x7f)<<21)|((view.getUint8(offset+5)&0x7f)<<14)|((view.getUint8(offset+6)&0x7f)<<7)|(view.getUint8(offset+7)&0x7f):view.getUint32(offset+4);headerLength=10;}
        if(size<=0)break;const bodyStart=offset+headerLength,frameEnd=bodyStart+size;if(frameEnd>buffer.byteLength)break;
        const field=frameMap[id];
        if(field&&size>1){
          let value=decodeID3Text(new Uint8Array(buffer,bodyStart+1,size-1),view.getUint8(bodyStart));
          if(field==="genre"){const match=value.match(/^\(?(\d+)\)?$/);if(match)value=ID3_GENRES[Number(match[1])]||value;}
          if(value&&!result[field])result[field]=value;
        }
        offset=frameEnd;
      }
    }catch(error){}
    return result;
  }
  async function extractFLACMetadata(file){
    const result={title:null,artist:null,album:null,date:null,genre:null};
    try{
      const signature=new Uint8Array(await readFileBuffer(file,0,4));
      if(signature.length<4||String.fromCharCode(...signature)!=="fLaC")return result;
      let offset=4;
      while(offset+4<=file.size){
        const header=new Uint8Array(await readFileBuffer(file,offset,4));if(header.length<4)break;
        const isLast=Boolean(header[0]&0x80),type=header[0]&0x7f,size=(header[1]<<16)|(header[2]<<8)|header[3],start=offset+4,end=start+size;
        if(type===4){
          const block=await readFileBuffer(file,start,Math.min(file.size,end)-start),view=new DataView(block);if(block.byteLength<8)return result;
          let cursor=0;const vendorLength=view.getUint32(cursor,true);cursor+=4+vendorLength;if(cursor+4>block.byteLength)return result;const count=view.getUint32(cursor,true);cursor+=4;const values={TITLE:[],ARTIST:[],ALBUM:[],DATE:[],YEAR:[],GENRE:[]};
          for(let i=0;i<count&&cursor+4<=block.byteLength;i++){const length=view.getUint32(cursor,true);cursor+=4;if(cursor+length>block.byteLength)break;const text=new TextDecoder("utf-8").decode(new Uint8Array(block,cursor,length));cursor+=length;const eq=text.indexOf("=");if(eq>0){const key=text.slice(0,eq).toUpperCase(),value=cleanMetadataText(text.slice(eq+1));if(value&&values[key])values[key].push(value);}}
          result.title=values.TITLE[0]||null;result.artist=cleanMetadataText(values.ARTIST.join(" / "))||null;result.album=values.ALBUM[0]||null;result.date=values.DATE[0]||values.YEAR[0]||null;result.genre=Array.from(new Set(values.GENRE)).join(" / ")||null;return result;
        }
        offset=end;if(isLast)break;
      }
    }catch(error){}
    return result;
  }
  async function extractFileMetadata(file){
    const name=String(file?.name||"").toLowerCase();
    if(name.endsWith(".flac"))return extractFLACMetadata(file);
    if(name.endsWith(".mp3"))return extractID3Metadata(file);
    return {title:null,artist:null,album:null,date:null,genre:null};
  }
  async function extractGenre(file){return (await extractFileMetadata(file)).genre||null;}
  GP.core.metadata=Object.freeze({extractFileMetadata,extractGenre});
