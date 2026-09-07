  /* ================= built-in changelog ================= */
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
  /* Motion Engine 3.3 sector primitive: fade out, expose the real background
     for a short beat, then fade the committed destination in. */
  const gpSectorMotionStates=new WeakMap();
  function transitionMotionSector(host,getCurrent,commit,animate=true){
    if(!host||typeof commit!=="function")return;
    if(!animate||matchMedia("(prefers-reduced-motion: reduce)").matches){
      const incoming=commit();incoming?.classList.remove("gp-sector-exit","gp-sector-enter");return;
    }
    let state=gpSectorMotionStates.get(host);
    if(!state){state={phase:"idle",pending:null,timer:0,settleTimer:0};gpSectorMotionStates.set(host,state);}
    state.pending={getCurrent,commit};
    if(state.phase!=="idle")return;
    const run=()=>{
      const task=state.pending;if(!task){state.phase="idle";return;}
      state.pending=null;
      const outgoing=task.getCurrent?.();state.phase="exit";
      outgoing?.classList.remove("gp-sector-enter");
      outgoing?.classList.add("gp-motion-stable","gp-sector-exit");
      clearTimeout(state.timer);clearTimeout(state.settleTimer);
      state.timer=setTimeout(()=>{
        outgoing?.classList.remove("gp-sector-exit");
        const incoming=task.commit();
        if(!incoming){state.phase="idle";if(state.pending)run();return;}
        incoming.classList.add("gp-motion-stable","gp-sector-gap");state.phase="gap";
        state.timer=setTimeout(()=>{
          incoming.classList.remove("gp-sector-gap");incoming.classList.add("gp-sector-enter");state.phase="enter";
          state.settleTimer=setTimeout(()=>{
            incoming.style.willChange="opacity";incoming.classList.remove("gp-sector-enter");
            requestAnimationFrame(()=>incoming.style.removeProperty("will-change"));
            state.phase="idle";if(state.pending)run();
          },155);
        },42);
      },130);
    };
    run();
  }
  $("#exportChangelogBtn").addEventListener("click",GP.changelog.exportLog);
  function syncVersionStoryText(){
    $("#versionStoryText").textContent=tr(
      "一切始于那个寻常的下午。伟大的项目从不诞生于万事俱备，而始于有人愿意先迈出第一步。",
      "It began on an ordinary afternoon. Great projects are not born when everything is ready, but when someone has the courage to take the first step."
    );
  }
  function setVersionStory(open){
    const modal=$("#versionStoryModal");syncVersionStoryText();modal.classList.toggle("show",!!open);modal.setAttribute("aria-hidden",String(!open));
    if(open)requestAnimationFrame(()=>$("#versionStoryClose").focus());
  }
  $("#currentVersionBtn").addEventListener("click",()=>setVersionStory(true));
  const versionStoryClose=$("#versionStoryClose");
  bindMicroMotion(versionStoryClose,"version-close-motion",400);
  versionStoryClose.addEventListener("click",()=>setVersionStory(false));
