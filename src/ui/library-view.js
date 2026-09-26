  /* ================= search / import / drag&drop ================= */
  let searchBehaviorTimer=0,searchRenderFrame=0;
  $("#search").addEventListener("input", () => {
    const query=$("#search").value;$(".search-wrap")?.classList.toggle("has-query",Boolean(query));
    if(searchRenderFrame)cancelAnimationFrame(searchRenderFrame);
    searchRenderFrame=requestAnimationFrame(()=>{searchRenderFrame=0;if($("#search").value===query)render(query);});
    clearTimeout(searchBehaviorTimer);
    if(query.trim())searchBehaviorTimer=setTimeout(()=>{
      const resultCount=playlist.filter(track=>fuzzySearchScore(track,query).score>=.5).length;
      recordBehaviorEvent("search",null,{query:query.trim(),resultCount});
    },650);
  });
  $("#searchClearBtn").addEventListener("click",event=>{
    event.preventDefault();const search=$("#search");if(!search.value)return;
    search.value="";$(".search-wrap")?.classList.remove("has-query");render("");search.focus();
  });
  bindMicroMotion($("#addFilesBtn"),"gp-import-file-motion",500);
  bindMicroMotion($("#addFolderBtn"),"gp-import-folder-motion",500);
  $("#addFilesBtn").addEventListener("click", () => requestAnimationFrame(()=>$("#fileInput").click()));
  $("#addFolderBtn").addEventListener("click", () => requestAnimationFrame(()=>$("#folderInput").click()));
  $("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files).catch(error=>finishImportProgress(null,error)); e.target.value=""; });
  $("#folderInput").addEventListener("change", (e) => { addFiles(e.target.files).catch(error=>finishImportProgress(null,error)); e.target.value=""; });

  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); dragCounter++; $("#drop-overlay").classList.add("show"); });
  window.addEventListener("dragover", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if(queueDragFrom !== null) return; e.preventDefault(); dragCounter--; if(dragCounter<=0){ dragCounter=0; $("#drop-overlay").classList.remove("show"); } });
  window.addEventListener("drop", (e) => {
    if(queueDragFrom !== null) return;
    e.preventDefault(); dragCounter=0; $("#drop-overlay").classList.remove("show");
    if(e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files).catch(error=>finishImportProgress(null,error));
  });

