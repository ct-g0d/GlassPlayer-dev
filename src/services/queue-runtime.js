  /* ================= rendering track lists ================= */
  let libraryRenderCommits=0;
  let libraryGridView=false;
  function trackRowHTML(t, idx,options={}){
    const rowClass=options.rowClass?` ${options.rowClass}`:"";
    const thumb=libraryGridView&&!options.compact?(t.coverUrl||t.thumbUrl):(t.thumbUrl||t.coverUrl);
    const cover = thumb ? `<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">` :
      `<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    if(options.compact===true)return `<div class="track-item ripple-target${idx===currentIndex?' playing':''}${rowClass}" data-idx="${idx}">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div><div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div></div>`;
    const playCount=Number.isFinite(Number(options.playCount))?Number(options.playCount):0;
    return `
      <div class="track-item library-row ripple-target${idx===currentIndex?' playing':''}${rowClass}" data-idx="${idx}">
        <div class="library-rank">${Number(options.rank)||idx+1}</div>
        <div class="library-track-cell">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div></div>
        <div class="track-album" title="${escapeHtml(t.album||"")}">${escapeHtml(t.album||tr("未标注专辑","No Album"))}</div>
        <div class="track-plays">${playCount}</div>
        <div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div>
        <div class="track-actions">
          <button class="track-action track-like ripple-target${isLikedTrack(playlist[idx])?" active":""}" data-idx="${idx}" aria-pressed="${isLikedTrack(playlist[idx])}" title="${isLikedTrack(playlist[idx])?tr("取消喜欢","Unlike"):tr("喜欢","Like")}" aria-label="${isLikedTrack(playlist[idx])?tr("取消喜欢","Unlike"):tr("喜欢","Like")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
          <button class="track-action queue-next ripple-target" data-idx="${idx}" title="${tr("下一首播放","Play Next")}" aria-label="${tr("下一首播放","Play Next")}"><svg class="rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path class="list-next-triangle" d="M5.9 5.55c-.52-.36-.9-.12-.9.52v11.86c0 .64.38.88.9.52l8.45-5.93c.48-.34.48-.7 0-1.04z"/><path class="list-next-echo" d="M19 5.8v12.4"/><path class="list-next-bar" d="M19 5.8v12.4"/></svg></button>
          <button class="track-action queue-add ripple-target" data-idx="${idx}" title="${tr("加入播放队列","Add to Queue")}" aria-label="${tr("加入播放队列","Add to Queue")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><g class="queue-bars"><path d="M4 6h9M4 12h7M4 18h7"/></g><path class="queue-plus-wave" d="M17 11v8M13 15h8"/><path class="queue-plus" d="M17 11v8M13 15h8"/></svg></button>
          ${options.playlistRemove?"":`<button class="track-action playlist-add ripple-target" data-idx="${idx}" title="${tr("添加到歌单","Add to playlist")}" aria-label="${tr("添加到歌单","Add to playlist")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h9M4 12h9M4 18h5"/><path d="M17.5 13v7M14 16.5h7"/></svg></button>`}
          ${options.playlistRemove?`<button class="track-action playlist-remove ripple-target" data-idx="${idx}" title="${tr("从歌单移除","Remove from playlist")}" aria-label="${tr("从歌单移除","Remove from playlist")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`:""}
        </div>
      </div>`;
  }
  function wireRows(container){
    if(!container||container.dataset.gpRowsWired==="1")return;container.dataset.gpRowsWired="1";
    container.addEventListener("pointerdown",event=>{if(event.target.closest(".track-actions button"))event.stopPropagation();});
    container.addEventListener("click",event=>{
      const button=event.target.closest(".track-actions button");
      if(button&&container.contains(button)){
        event.stopPropagation();const idx=+button.dataset.idx;
        if(button.classList.contains("queue-next"))enqueueTrack(idx,"next");
        else if(button.classList.contains("queue-add"))enqueueTrack(idx,"end");
        else if(button.classList.contains("track-like"))toggleLike(idx,{source:container.id==="recommendList"?"recommendation":"library"});
        else if(button.classList.contains("playlist-add"))openRowPlaylistPop(idx,button);
        else if(button.classList.contains("playlist-remove"))removeTrackFromPlaylist(activePlaylistId(),idx);
        else if(button.classList.contains("track-remove"))removeTrack(idx);
        return;
      }
      const item=event.target.closest(".track-item");if(item&&container.contains(item)){
        playAt(+item.dataset.idx,container.id==="recommendList"?"recommendation":null);
        if(container.id==="recommendList")requestAnimationFrame(()=>{container.querySelectorAll(".recommend-track").forEach(row=>row.classList.remove("playing","gp-press-held","gp-press-release","glow-pulse"));});
      }
    });
  }
  /* ============ user playlists + liked songs (7.4.0 典藏更新) ============
     Queue Service owns the single manual queue AND user-defined playlists.
     Playlists persist as one record in the existing recommendations store
     (no schema/version change). Tracks are referenced by stable
     neuralTrackId keys, never by playlist index or runtime id. Likes are
     behavior events so Resonance Boost learns them; the liked set is
     derived latest-wins from those events (unlike persists with signal 0). */
  const USER_PLAYLISTS_RECORD_ID="userPlaylists";
  let userPlaylistsCache=null,userPlaylistsLoaded=false;
  let likedKeys=new Set(),likedKeysLoaded=false;
  let libraryCollectionMode="all";
  let collectionScopeActive=false;
  function playlistTrackKey(track){try{return neuralTrackId(track);}catch(error){return track?.id||null;}}
  async function loadUserPlaylists(){
    try{
      const record=await GPDatabase.getRecommendations(USER_PLAYLISTS_RECORD_ID);
      const lists=Array.isArray(record?.lists)?record.lists.filter(item=>item&&typeof item.id==="string"&&Array.isArray(item.trackKeys)):[];
      userPlaylistsCache={version:1,lists:lists.map(item=>({id:item.id,name:String(item.name||tr("未命名歌单","Untitled Playlist")).slice(0,30),createdAt:Number(item.createdAt)||Date.now(),updatedAt:Number(item.updatedAt)||Date.now(),trackKeys:item.trackKeys.filter(key=>key!==null&&key!==undefined)}))};
    }catch(error){userPlaylistsCache={version:1,lists:[]};}
    userPlaylistsLoaded=true;return userPlaylistsCache;
  }
  async function saveUserPlaylists(){
    if(!userPlaylistsCache)return false;
    try{await GPDatabase.saveRecommendations({id:USER_PLAYLISTS_RECORD_ID,version:1,updatedAt:Date.now(),lists:userPlaylistsCache.lists});return true;}
    catch(error){console.warn("User playlists persistence failed",error);return false;}
  }
  function userPlaylists(){return userPlaylistsCache?.lists||[];}
  function findUserPlaylist(id){return userPlaylists().find(item=>item.id===id)||null;}
  function activePlaylistId(){return libraryCollectionMode.startsWith("pl:")?libraryCollectionMode.slice(3):null;}
  function activePlaylist(){const id=activePlaylistId();return id?findUserPlaylist(id):null;}
  async function loadUserPlaylistsIfNeeded(){if(!userPlaylistsLoaded)await loadUserPlaylists();return userPlaylistsCache;}
  async function createUserPlaylist(name){
    const clean=String(name||"").trim().slice(0,30);
    if(!clean){showToast(tr("请输入歌单名称","Enter a playlist name"));return null;}
    await loadUserPlaylistsIfNeeded();
    const list={id:`pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,name:clean,createdAt:Date.now(),updatedAt:Date.now(),trackKeys:[]};
    userPlaylistsCache.lists.push(list);
    if(await saveUserPlaylists()){showToast(tr(`已创建歌单「${clean}」`,`Created playlist “${clean}”`));setLibraryCollectionMode(`pl:${list.id}`);return list;}
    userPlaylistsCache.lists.pop();showToast(tr("歌单保存失败","Playlist save failed"));return null;
  }
  async function renameUserPlaylist(id,name){
    const list=findUserPlaylist(id),clean=String(name||"").trim().slice(0,30);
    if(!list||!clean)return false;
    list.name=clean;list.updatedAt=Date.now();
    if(await saveUserPlaylists()){syncPlaylistUI();return true;}
    return false;
  }
  async function deleteUserPlaylist(id){
    const list=findUserPlaylist(id);if(!list)return false;
    userPlaylistsCache.lists=userPlaylistsCache.lists.filter(item=>item.id!==id);
    if(await saveUserPlaylists()){
      showToast(tr(`已删除歌单「${list.name}」`,`Deleted playlist “${list.name}”`));
      if(activePlaylistId()===id)setLibraryCollectionMode("all");else syncPlaylistUI();
      return true;
    }
    await loadUserPlaylists();syncPlaylistUI();return false;
  }
  async function addTrackToPlaylist(id,idx){
    const list=findUserPlaylist(id),track=playlist[idx];if(!list||!track)return false;
    const key=playlistTrackKey(track);if(key===null||key===undefined)return false;
    if(list.trackKeys.includes(key)){showToast(tr(`「${track.title}」已在歌单「${list.name}」中`,`“${track.title}” is already in “${list.name}”`));return false;}
    list.trackKeys.push(key);list.updatedAt=Date.now();
    if(await saveUserPlaylists()){showToast(tr(`已将「${track.title}」加入「${list.name}」`,`Added “${track.title}” to “${list.name}”`));syncPlaylistUI(true);return true;}
    list.trackKeys=list.trackKeys.filter(item=>item!==key);return false;
  }
  async function removeTrackFromPlaylist(id,idx){
    const list=findUserPlaylist(id),track=playlist[idx];if(!list||!track)return false;
    const key=playlistTrackKey(track),before=list.trackKeys.length;
    list.trackKeys=list.trackKeys.filter(item=>item!==key);
    if(list.trackKeys.length===before)return false;
    list.updatedAt=Date.now();
    if(await saveUserPlaylists()){render(searchInputSafe());return true;}
    await loadUserPlaylists();render(searchInputSafe());return false;
  }
  function collectionTrackIndices(){
    if(libraryCollectionMode==="liked")return playlist.map((track,idx)=>idx).filter(idx=>{const key=playlistTrackKey(playlist[idx]);return key!==null&&likedKeys.has(key);});
    const list=activePlaylist();
    if(list){
      const position=new Map();list.trackKeys.forEach((key,order)=>{if(!position.has(key))position.set(key,order);});
      return playlist.map((track,idx)=>[position.get(playlistTrackKey(track)),idx]).filter(([order])=>order!==undefined).sort((a,b)=>a[0]-b[0]).map(([,idx])=>idx);
    }
    return playlist.map((_,idx)=>idx);
  }
  function collectionTrackIndicesForMode(mode){
    const keep=libraryCollectionMode;libraryCollectionMode=mode;
    const out=collectionTrackIndices();libraryCollectionMode=keep;return out;
  }
  function syncCollectionScope(){
    // Collection-scoped sequential playback reuses the existing overrideQueue
    // consumer chain (next/previous/ended/crossfade). It has no other producer.
    if(libraryCollectionMode==="all"){if(collectionScopeActive){overrideQueue=null;collectionScopeActive=false;}return;}
    overrideQueue=collectionTrackIndices();collectionScopeActive=true;
  }
  function isLikedTrack(track){if(!track)return false;try{const key=playlistTrackKey(track);return key!==null&&likedKeys.has(key);}catch(error){return false;}}
  function syncLikeButtons(){
    document.querySelectorAll("#trackList .track-like").forEach(button=>{
      const track=playlist[+button.dataset.idx];if(!track)return;
      const liked=isLikedTrack(track);
      button.classList.toggle("active",liked);button.setAttribute("aria-pressed",String(liked));
      const label=liked?tr("取消喜欢","Unlike"):tr("喜欢","Like");button.title=label;button.setAttribute("aria-label",label);
    });
  }
  async function refreshLikedKeys(){
    try{
      const events=await GPDatabase.getBehaviorEvents()||[],latest=new Map();
      events.forEach(event=>{if(event?.type!=="like"||event.spectrumId===null||event.spectrumId===undefined)return;latest.set(event.spectrumId,event);});
      likedKeys=new Set([...latest.entries()].filter(([,event])=>event?.context?.liked!==false).map(([key])=>key));
    }catch(error){likedKeys=new Set();}
    likedKeysLoaded=true;syncLikeButtons();
    if(libraryCollectionMode==="liked")render(searchInputSafe());
  }
  async function toggleLike(idx,options={}){
    const track=playlist[idx];if(!track)return;
    const key=playlistTrackKey(track);if(key===null||key===undefined)return;
    const liked=!likedKeys.has(key);
    await recordBehaviorEvent("like",track,{liked,source:options.source||"library"});
    if(liked)likedKeys.add(key);else likedKeys.delete(key);
    syncLikeButtons();
    if(libraryCollectionMode==="liked")render(searchInputSafe());else syncPlaylistUI(true);
    showToast(liked?tr(`已喜欢「${track.title}」`,`Liked “${track.title}”`):tr(`已取消喜欢「${track.title}」`,`Unliked “${track.title}”`));
  }
  function collectionDisplayName(){
    if(libraryCollectionMode==="liked")return tr("我喜欢","Liked");
    const list=activePlaylist();if(list)return list.name;
    return tr("全部歌曲","All Songs");
  }
  function playCollectionNow(){
    const members=collectionTrackIndices();
    if(!members.length){showToast(tr("这个歌单还没有可播放的歌曲","No playable songs in this collection"));return;}
    members.forEach(idx=>{const id=playlist[idx]?.id;if(id&&!playQueue.includes(id))playQueue.push(id);});
    manualQueueActive=true;beginQueuedPlayback();pendingSelectionSource="playlist";
    loadTrack(members[0],true);renderMiniQueue();
    showToast(tr(`正在播放${collectionDisplayName()}（${members.length} 首）`,`Playing ${collectionDisplayName()} (${members.length} songs)`));
  }
  function setLibraryCollectionMode(mode){
    libraryCollectionMode=mode==="liked"||mode.startsWith("pl:")?mode:"all";
    syncCollectionScope();syncPlaylistUI();
  }
  function syncPlaylistUI(skipRender=false){
    const label=$("#playlistBtnText"),pop=$("#playlistPop"),bar=$("#collectionBar");
    if(label)label.textContent=`${tr("歌单","Playlists")}：${collectionDisplayName()}`;
    if(pop){
      const rows=[{mode:"all",name:tr("全部歌曲","All Songs"),count:playlist.length},{mode:"liked",name:`♥ ${tr("我喜欢","Liked")}`,count:collectionTrackIndicesForMode("liked").length}].concat(userPlaylists().map(list=>({mode:`pl:${list.id}`,name:list.name,count:collectionTrackIndicesForMode(`pl:${list.id}`).length,id:list.id})));
      pop.querySelectorAll("[data-collection]").forEach(node=>node.remove());
      const anchor=pop.querySelector(".playlist-pop-divider");
      rows.forEach(row=>{
        const item=document.createElement("div");item.className="playlist-pop-row";item.dataset.collection=row.mode;
        const pick=document.createElement("button");pick.type="button";pick.className="ripple-target";pick.dataset.collection=row.mode;
        const name=document.createElement("span");name.textContent=row.name;
        const count=document.createElement("em");count.textContent=row.count;
        pick.append(name,count);pick.classList.toggle("active",libraryCollectionMode===row.mode);
        item.appendChild(pick);
        if(row.id){
          const del=document.createElement("button");del.type="button";del.className="playlist-pop-del ripple-target";del.dataset.deletePlaylist=row.id;
          del.title=tr("删除歌单","Delete playlist");del.setAttribute("aria-label",tr("删除歌单","Delete playlist"));del.textContent="×";
          item.appendChild(del);
        }
        if(anchor)anchor.before(item);else pop.appendChild(item);
      });
      const input=$("#playlistNameInput"),confirm=$("#playlistConfirmBtn"),active=activePlaylist();
      if(input&&document.activeElement!==input)input.value=active?active.name:"";
      if(confirm)confirm.textContent=active?tr("重命名","Rename"):tr("新建歌单","New Playlist");
    }
    if(bar){
      const active=libraryCollectionMode!=="all";
      bar.classList.toggle("show",active);
      if(active){
        const members=collectionTrackIndices();
        bar.querySelector(".collection-name").textContent=collectionDisplayName();
        bar.querySelector(".collection-count").textContent=tr(`${members.length} 首`,`${members.length} songs`);
      }
    }
    if(!skipRender)render(searchInputSafe());
  }
  $("#playlistBtn").addEventListener("click",event=>{event.stopPropagation();syncPlaylistUI(true);const pop=$("#playlistPop"),show=!pop.classList.contains("show");setMotionPopover(pop,show);if(show)requestAnimationFrame(()=>{try{$("#playlistNameInput")?.focus({preventScroll:true});}catch(error){}});});
  $("#playlistPop").addEventListener("click",async event=>{
    const del=event.target.closest("[data-delete-playlist]");
    if(del){event.stopPropagation();await deleteUserPlaylist(del.dataset.deletePlaylist);return;}
    if(event.target.closest("#playlistCreateRow"))return;
    const row=event.target.closest("[data-collection]");
    if(!row||!row.dataset.collection)return;
    event.stopPropagation();setLibraryCollectionMode(row.dataset.collection);setMotionPopover($("#playlistPop"),false);
  });
  $("#playlistConfirmBtn").addEventListener("click",async event=>{
    event.stopPropagation();
    const input=$("#playlistNameInput"),active=activePlaylist();
    if(active)await renameUserPlaylist(active.id,input.value);
    else await createUserPlaylist(input.value);
  });
  $("#playlistNameInput").addEventListener("keydown",event=>{
    if(event.key==="Enter"){event.preventDefault();$("#playlistConfirmBtn").click();}
    event.stopPropagation();
  });
  $("#collectionPlayBtn").addEventListener("click",event=>{event.stopPropagation();playCollectionNow();});
  document.addEventListener("click",event=>{if(!event.target.closest("#playlistWrap"))setMotionPopover($("#playlistPop"),false);});
  let pendingRowPlaylistIdx=-1;
  function openRowPlaylistPop(idx,anchor){
    pendingRowPlaylistIdx=idx;
    const pop=$("#rowPlaylistPop");if(!pop)return;
    pop.querySelectorAll("[data-row-playlist]").forEach(node=>node.remove());
    const lists=userPlaylists();
    if(!lists.length)pop.querySelector(".row-playlist-empty").style.display="block";
    else{
      pop.querySelector(".row-playlist-empty").style.display="none";
      lists.forEach(list=>{
        const button=document.createElement("button");button.type="button";button.className="ripple-target";button.dataset.rowPlaylist=list.id;
        const name=document.createElement("span");name.textContent=list.name;
        const count=document.createElement("em");count.textContent=collectionTrackIndicesForMode(`pl:${list.id}`).length;
        button.append(name,count);pop.appendChild(button);
      });
    }
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    pop.style.position="fixed";pop.style.zIndex="320";
    const rect=anchor.getBoundingClientRect(),width=200;
    pop.style.width=`${width}px`;
    pop.style.left=`${Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width))}px`;
    const below=rect.bottom+8,popHeight=Math.min(320,48+lists.length*44);
    pop.style.top=`${Math.max(10,(below+popHeight>window.innerHeight-10)?rect.top-popHeight-8:below)}px`;
    setMotionPopover(pop,true);
  }
  $("#rowPlaylistPop").addEventListener("click",async event=>{
    if(event.target.closest("#rowPlaylistNew")){event.stopPropagation();setMotionPopover($("#rowPlaylistPop"),false);syncPlaylistUI(true);setMotionPopover($("#playlistPop"),true);return;}
    const button=event.target.closest("[data-row-playlist]");
    if(!button)return;event.stopPropagation();
    setMotionPopover($("#rowPlaylistPop"),false);
    if(pendingRowPlaylistIdx>=0)await addTrackToPlaylist(button.dataset.rowPlaylist,pendingRowPlaylistIdx);
    pendingRowPlaylistIdx=-1;
  });
  document.addEventListener("click",event=>{if(!event.target.closest("#rowPlaylistPop")&&!event.target.closest(".playlist-add"))setMotionPopover($("#rowPlaylistPop"),false);});
  loadUserPlaylists().then(()=>syncPlaylistUI(true));
  refreshLikedKeys();
  function normalizeSearchText(value){
    return String(value||"").normalize("NFKD").replace(/\p{M}+/gu,"").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
  }
  const SEARCH_PINYIN_BOUNDARIES=[['阿','a'],['芭','b'],['擦','c'],['搭','d'],['蛾','e'],['发','f'],['噶','g'],['哈','h'],['击','j'],['喀','k'],['垃','l'],['妈','m'],['拿','n'],['哦','o'],['啪','p'],['期','q'],['然','r'],['撒','s'],['塌','t'],['挖','w'],['昔','x'],['压','y'],['匝','z']];
  const SEARCH_SOUND_GROUPS=["的地得","在再载","已以蚁","他她它","你拟","爱碍艾","生声升","夜页叶","光广","海还","心新欣","想响享","情晴","明名鸣","里理礼","只纸指","时十石","歌哥鸽","周洲舟","陈晨尘","张章彰","方芳","林临琳","王旺","红宏虹","雨语宇","梦孟","静境镜","蓝兰岚","杰洁捷","飞菲非","伟纬玮","东冬","阳杨洋","美每","乐月悦","亮谅","安岸","城成诚"];
  const SEARCH_PINYIN_PHRASES=new Map([["邓紫棋","dengziqi"],["陈奕迅","chenyixun"],["周杰伦","zhoujielun"],["方大同","fangdatong"],["薛之谦","xuezhiqian"],["毛不易","maobuyi"],["五月天","wuyuetian"],["李荣浩","lironghao"],["孙燕姿","sunyanzi"],["张国荣","zhangguorong"],["王力宏","wanglihong"],["林俊杰","linjunjie"],["许嵩","xusong"],["张学友","zhangxueyou"],["刘德华","liudehua"],["梁静茹","liangjingru"],["张惠妹","zhanghuimei"],["田馥甄","tianfuzhen"],["蔡依林","caiyilin"],["陶喆","taozhe"],["任然","renran"],["丁当","dingdang"],["朴树","pushu"],["汪峰","wangfeng"]]);
  /* Compact offline music-search lexicon. It intentionally covers common
     artist/title vocabulary instead of shipping a large transliteration
     dependency; unknown Han characters still fall back to pinyin initials. */
  const SEARCH_PINYIN_CHAR_MAP=new Map(Object.entries({
    爱:"ai",安:"an",暗:"an",岸:"an",把:"ba",白:"bai",半:"ban",北:"bei",被:"bei",别:"bie",不:"bu",猜:"cai",曾:"ceng",长:"chang",唱:"chang",城:"cheng",成:"cheng",陈:"chen",晨:"chen",春:"chun",从:"cong",错:"cuo",大:"da",当:"dang",到:"dao",的:"de",等:"deng",地:"di",第:"di",点:"dian",冬:"dong",东:"dong",懂:"dong",都:"dou",对:"dui",多:"duo",方:"fang",飞:"fei",风:"feng",该:"gai",告:"gao",歌:"ge",给:"gei",孤:"gu",故:"gu",国:"guo",过:"guo",还:"hai",海:"hai",好:"hao",黑:"hei",红:"hong",后:"hou",花:"hua",坏:"huai",欢:"huan",回:"hui",会:"hui",火:"huo",几:"ji",记:"ji",见:"jian",江:"jiang",将:"jiang",叫:"jiao",街:"jie",今:"jin",尽:"jin",静:"jing",睛:"jing",就:"jiu",久:"jiu",开:"kai",看:"kan",空:"kong",哭:"ku",阔:"kuo",来:"lai",蓝:"lan",老:"lao",泪:"lei",冷:"leng",离:"li",里:"li",力:"li",恋:"lian",亮:"liang",林:"lin",流:"liu",留:"liu",路:"lu",落:"luo",没:"mei",美:"mei",梦:"meng",明:"ming",名:"ming",难:"nan",年:"nian",你:"ni",暖:"nuan",女:"nv",泡:"pao",朋:"peng",平:"ping",起:"qi",千:"qian",前:"qian",蔷:"qiang",情:"qing",晴:"qing",秋:"qiu",去:"qu",然:"ran",人:"ren",日:"ri",如:"ru",三:"san",山:"shan",伤:"shang",上:"shang",少:"shao",谁:"shei",深:"shen",生:"sheng",声:"sheng",时:"shi",十:"shi",世:"shi",是:"shi",手:"shou",水:"shui",说:"shuo",思:"si",四:"si",送:"song",岁:"sui",他:"ta",她:"ta",太:"tai",听:"ting",天:"tian",同:"tong",痛:"tong",头:"tou",透:"tou",外:"wai",晚:"wan",忘:"wang",往:"wang",为:"wei",微:"wei",薇:"wei",未:"wei",问:"wen",我:"wo",无:"wu",舞:"wu",雾:"wu",西:"xi",夏:"xia",下:"xia",想:"xiang",像:"xiang",笑:"xiao",心:"xin",新:"xin",星:"xing",醒:"xing",雪:"xue",眼:"yan",阳:"yang",夜:"ye",一:"yi",已:"yi",音:"yin",影:"ying",永:"yong",有:"you",又:"you",友:"you",雨:"yu",月:"yue",再:"zai",在:"zai",怎:"zen",张:"zhang",真:"zhen",只:"zhi",中:"zhong",终:"zhong",重:"zhong",周:"zhou",紫:"zi",走:"zou",最:"zui",昨:"zuo",作:"zuo",玫:"mei",瑰:"gui",光:"guang",沫:"mo",杰:"jie",伦:"lun",奕:"yi",迅:"xun",荣:"rong",浩:"hao",燕:"yan",姿:"zi",俊:"jun",学:"xue",德:"de",静:"jing",茹:"ru",惠:"hui",妹:"mei",馥:"fu",甄:"zhen",依:"yi",谦:"qian",易:"yi"
  }));
  const SEARCH_SOUND_FOLD=new Map();SEARCH_SOUND_GROUPS.forEach(group=>[...group].forEach(char=>SEARCH_SOUND_FOLD.set(char,group[0])));
  function soundFold(value){return [...String(value||"")].map(char=>SEARCH_SOUND_FOLD.get(char)||char).join("");}
  function pinyinInitial(char){
    if(!/[\u3400-\u9fff]/u.test(char))return char;
    let initial="";for(const [boundary,value] of SEARCH_PINYIN_BOUNDARIES){if(char.localeCompare(boundary,"zh-CN-u-co-pinyin")>=0)initial=value;else break;}return initial;
  }
  function pinyinInitials(value){return normalizeSearchText([...String(value||"")].map(pinyinInitial).join(""));}
  function pinyinApproximation(value){
    const raw=String(value||"");
    const phraseForms=[...SEARCH_PINYIN_PHRASES].filter(([phrase])=>raw.includes(phrase)).map(([,pinyin])=>pinyin);
    const characterForm=normalizeSearchText([...raw].map(char=>SEARCH_PINYIN_CHAR_MAP.get(char)||pinyinInitial(char)).join(""));
    return [...new Set([characterForm,...phraseForms].filter(Boolean))];
  }
  function fuzzySubsequence(candidate,query){
    let qi=0,last=-1,gaps=0;
    for(let i=0;i<candidate.length&&qi<query.length;i++){
      if(candidate[i]===query[qi]){if(last>=0)gaps+=i-last-1;last=i;qi++;}
    }
    return qi===query.length&&gaps<=Math.max(2,Math.ceil(query.length*.65));
  }
  function boundedSearchDistance(candidate,query,limit){
    if(Math.abs(candidate.length-query.length)>limit)return limit+1;
    let previous=Array.from({length:query.length+1},(_,index)=>index);
    for(let i=1;i<=candidate.length;i++){
      const current=[i];let rowMin=i;
      for(let j=1;j<=query.length;j++){const value=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(candidate[i-1]===query[j-1]?0:1));current[j]=value;rowMin=Math.min(rowMin,value);}
      if(rowMin>limit)return limit+1;previous=current;
    }
    return previous[query.length];
  }
  function trackSearchFields(track){
    return [track?.title,track?.artist,track?.album,track?.genre,track?.inferredGenre,track?.genreSecondary,track?.name,track?.file?.name,...(track?.identityLinks?.artistAliases||[]),...(track?.identityLinks?.titleAliases||[])].filter(Boolean);
  }
  const trackSearchDocumentCache=new WeakMap();
  function trackSearchDocument(track){
    const fields=trackSearchFields(track),signature=fields.join("\u0001");let cached=trackSearchDocumentCache.get(track);
    if(cached?.signature===signature)return cached.documents;
    const documents=fields.map(raw=>({field:normalizeSearchText(raw),sound:normalizeSearchText(soundFold(raw)),initials:pinyinInitials(raw),pinyin:pinyinApproximation(raw)}));
    trackSearchDocumentCache.set(track,{signature,documents});return documents;
  }
  function fuzzySearchScore(track,queryText){
    const query=normalizeSearchText(queryText);if(!query)return {exact:true,score:1};
    const querySound=normalizeSearchText(soundFold(queryText));let best=0,exact=false;
    for(const {field,sound,initials,pinyin:fullPinyin} of trackSearchDocument(track)){
      if(field.includes(query)||sound.includes(querySound)){exact=true;best=Math.max(best,1);continue;}
      if(initials&&initials.includes(query)){best=Math.max(best,.92);continue;}
      if(fullPinyin.some(pinyin=>pinyin.includes(query))){best=Math.max(best,.94);continue;}
      if(query.length>=2&&fuzzySubsequence(field,query))best=Math.max(best,.82-Math.max(0,field.length-query.length)*.012);
      const limit=query.length>=8?3:query.length>=4?2:1,distance=Math.min(boundedSearchDistance(field,query,limit),boundedSearchDistance(sound,querySound,limit),...fullPinyin.map(value=>boundedSearchDistance(value,query,limit)));
      if(distance<=limit)best=Math.max(best,.78-distance*.13);
    }
    return {exact,score:best};
  }
  function rankedLibrarySearch(indices,queryText){
    const query=String(queryText||"").trim();if(!query)return {indices,similar:false};
    const scored=indices.map(index=>({index,...fuzzySearchScore(playlist[index],query)}));
    const exact=scored.filter(item=>item.exact);if(exact.length)return {indices:exact.map(item=>item.index),similar:false};
    const similar=scored.filter(item=>item.score>=.5).sort((a,b)=>b.score-a.score).slice(0,24);
    return {indices:similar.map(item=>item.index),similar:similar.length>0,empty:similar.length===0};
  }
  function updateSearchFeedback(similar,query,empty=false){const feedback=$("#searchFeedback");if(!feedback)return;feedback.textContent=query?(similar?tr("未找到完全匹配，以下为粗略匹配","No exact match. Approximate matches are shown below."):empty?tr("未找到匹配结果","No matching results"):""):"";feedback.classList.toggle("show",Boolean(feedback.textContent));feedback.classList.toggle("empty",Boolean(empty));}
  const listActionHoverTimers=new WeakMap(),listActionMotionTimers=new WeakMap();
  function runListActionMotion(button){
    if(!button)return;clearTimeout(listActionMotionTimers.get(button));
    restartCssMotion(button,"list-motion-run");
    listActionMotionTimers.set(button,setTimeout(()=>button.classList.remove("list-motion-run"),680));
  }
  document.addEventListener("pointerover",event=>{
    const button=event.target.closest?.(".track-action,.queue-drag-handle");if(!button||button.contains(event.relatedTarget))return;
    clearTimeout(listActionHoverTimers.get(button));listActionHoverTimers.set(button,setTimeout(()=>runListActionMotion(button),300));
  });
  document.addEventListener("pointerout",event=>{
    const button=event.target.closest?.(".track-action,.queue-drag-handle");if(!button||button.contains(event.relatedTarget))return;
    clearTimeout(listActionHoverTimers.get(button));
  });
  document.addEventListener("click",event=>{const button=event.target.closest?.(".track-action,.queue-drag-handle");if(button)runListActionMotion(button);},true);
  function syncLibraryEmptyState(emptyState,visibleCount,hasSearch){
    const show=!hasSearch&&visibleCount===0;
    emptyState.style.display=show?"block":"none";
    if(!show)return;
    const text=playlist.length===0
      ? tr("还没有音乐<br>点击上方按钮导入，或直接把歌曲/文件夹拖进窗口<br>封面会自动从 MP3/FLAC/M4A 中识别","Your library is empty.<br>Import music from Library or drop files or folders here.<br>Artwork is read from MP3, FLAC, or M4A files.")
      : libraryCollectionMode==="liked"
        ? tr("还没有喜欢的歌曲","No liked songs yet")
        : tr("这个歌单还没有歌曲","This playlist is empty");
    const message=emptyState.querySelector("p");if(message)message.innerHTML=text;
  }
  function render(filterText){
    libraryRenderCommits++;
    GP.performance.libraryRenderCommits=libraryRenderCommits;
    const q = (filterText||"").trim();
    const listEl = $("#trackList"), emptyState = $("#emptyState"), panel=$(".library-panel");
    panel?.classList.toggle("library-grid",libraryGridView);
    listEl.querySelectorAll(".track-item").forEach(n => n.remove());
    const visibleIndices=collectionTrackIndices();
    syncLibraryEmptyState(emptyState,visibleIndices.length,q.length>0);
    if(librarySortMode==="artist")visibleIndices.sort((a,b)=>playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN",{sensitivity:"base"})||playlist[a].title.localeCompare(playlist[b].title,"zh-CN"));
    if(librarySortMode==="title")visibleIndices.sort((a,b)=>playlist[a].title.localeCompare(playlist[b].title,"zh-CN",{sensitivity:"base"})||playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN"));
    const playCounts=typeof getLibraryPlayCounts==="function"?getLibraryPlayCounts():new Map();
    const result=rankedLibrarySearch(visibleIndices,q),rows=result.indices.map((idx,rank)=>trackRowHTML(playlist[idx],idx,{rank:rank+1,playCount:playCounts.get(playlist[idx].id)||0,playlistRemove:activePlaylistId()!==null}));
    updateSearchFeedback(result.similar,q,result.empty);
    if(rows.length)listEl.insertAdjacentHTML("beforeend",rows.join(""));
    wireRows(listEl);
    syncPlaylistUI(true);
    renderMiniQueue();
  }
  async function renderLibraryIncrementally(filterText,chunkSize=12){
    libraryRenderCommits++;GP.performance.libraryRenderCommits=libraryRenderCommits;
    const q=(filterText||"").trim(),listEl=$("#trackList"),emptyState=$("#emptyState"),panel=$(".library-panel");
    panel?.classList.toggle("library-grid",libraryGridView);
    listEl.querySelectorAll(".track-item").forEach(node=>node.remove());
    const visibleIndices=collectionTrackIndices();
    syncLibraryEmptyState(emptyState,visibleIndices.length,q.length>0);
    if(librarySortMode==="artist")visibleIndices.sort((a,b)=>playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN",{sensitivity:"base"})||playlist[a].title.localeCompare(playlist[b].title,"zh-CN"));
    if(librarySortMode==="title")visibleIndices.sort((a,b)=>playlist[a].title.localeCompare(playlist[b].title,"zh-CN",{sensitivity:"base"})||playlist[a].artist.localeCompare(playlist[b].artist,"zh-CN"));
    const playCounts=typeof getLibraryPlayCounts==="function"?getLibraryPlayCounts():new Map();
    const result=rankedLibrarySearch(visibleIndices,q),filtered=result.indices;updateSearchFeedback(result.similar,q,result.empty);
    for(let offset=0;offset<filtered.length;offset+=chunkSize){
      const rows=filtered.slice(offset,offset+chunkSize).map((idx,rank)=>trackRowHTML(playlist[idx],idx,{rank:offset+rank+1,playCount:playCounts.get(playlist[idx].id)||0,playlistRemove:activePlaylistId()!==null}));
      if(rows.length)listEl.insertAdjacentHTML("beforeend",rows.join(""));
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    wireRows(listEl);
    syncPlaylistUI(true);
  }
  let lastPlaybackIndicatorIndex=-1;
  function syncCurrentTrackPlaybackIndicator(){
    const touched=new Set([lastPlaybackIndicatorIndex,currentIndex]);
    touched.forEach(idx=>{
      if(idx<0)return;
      document.querySelectorAll(`#trackList .track-item[data-idx="${idx}"],#miniQueueList .track-item[data-idx="${idx}"]`).forEach(row=>{
        row.classList.toggle("playing",idx===currentIndex);
      });
    });
    lastPlaybackIndicatorIndex=currentIndex;
  }
  const SORT_LABELS={original:["排序：原始顺序","Sort: Original"],artist:["排序：歌手 A–Z","Sort: Artist A–Z"],title:["排序：歌名 A–Z","Sort: Title A–Z"]};
  function syncSortUI(){ const labels=SORT_LABELS[librarySortMode]||SORT_LABELS.original;$("#sortBtnText").textContent=tr(labels[0],labels[1]); $$("#sortPop button").forEach(button=>button.classList.toggle("active",button.dataset.sort===librarySortMode)); }
  $("#sortBtn").addEventListener("click",e=>{e.stopPropagation();setMotionPopover($("#sortPop"),!$("#sortPop").classList.contains("show"));});
  $("#sortPop").addEventListener("click",e=>{const button=e.target.closest("button");if(!button)return;librarySortMode=button.dataset.sort;syncSortUI();render(searchInputSafe());setMotionPopover($("#sortPop"),false);});
  $("#libraryViewBtn").addEventListener("click",e=>{e.stopPropagation();libraryGridView=!libraryGridView;$("#libraryViewBtn").setAttribute("aria-pressed",String(libraryGridView));$(".library-panel")?.classList.toggle("library-grid",libraryGridView);render(searchInputSafe());});
  document.addEventListener("click",e=>{if(!e.target.closest("#sortWrap"))setMotionPopover($("#sortPop"),false);});
  let miniQueueDefaultSignature="",miniQueuePlayingIndex=-1,queuePositionPending=false,queuePositionRequestToken=0,queueAlignOnNextPlayback=false,queueMotionTarget=null,queueMotionTimer=0;
  function animateQueuePosition(body,targetTop,instantPosition){
    const maximum=Math.max(0,body.scrollHeight-body.clientHeight),target=Math.max(0,Math.min(maximum,targetTop)),distance=target-body.scrollTop;
    if(instantPosition||Math.abs(distance)<1){clearTimeout(queueMotionTimer);queueMotionTimer=0;queueMotionTarget=null;body.scrollTop=target;}
    else{
      /* Pause and Play can request the same alignment while one native smooth
         scroll is still running. Reissuing it makes Edge cancel and restore
         the previous user-scroll anchor, so one target owns the full motion. */
      if(queueMotionTimer&&queueMotionTarget!==null&&Math.abs(queueMotionTarget-target)<1)return;
      clearTimeout(queueMotionTimer);queueMotionTarget=target;
      body.scrollTo({top:target,behavior:"smooth"});
      queueMotionTimer=setTimeout(()=>{queueMotionTimer=0;queueMotionTarget=null;},900);
    }
    scheduleScrollEdgeUpdate(body);
  }
  function queueListTop(body,list){
    const bodyRect=body.getBoundingClientRect(),listRect=list.getBoundingClientRect();
    const scaleY=body.offsetHeight>0?bodyRect.height/body.offsetHeight:1;
    return body.scrollTop+(listRect.top-bodyRect.top)/Math.max(.01,scaleY);
  }
  function positionCurrentQueueRow(instantPosition=false,attempt=0,requestToken=0){
    if(currentIndex<0)return;
    if(attempt===0)requestToken=++queuePositionRequestToken;
    requestAnimationFrame(()=>{
      if(requestToken!==queuePositionRequestToken)return;
      const body=$("#queueBody"),list=$("#miniQueueList"),row=list?.querySelector(`.queue-default-item[data-idx="${currentIndex}"]`);
      if(!body)return;
      if(!row){queuePositionPending=true;if(attempt<40)setTimeout(()=>positionCurrentQueueRow(instantPosition,attempt+1,requestToken),50);return;}
      if(body.style.display==="none"||body.offsetParent===null){queuePositionPending=true;return;}
      const bodyRect=body.getBoundingClientRect(),rowRect=row.getBoundingClientRect(),scaleY=body.offsetHeight>0?bodyRect.height/body.offsetHeight:1;
      const rowHeight=Math.max(1,rowRect.height/Math.max(.01,scaleY)),rowTop=body.scrollTop+(rowRect.top-bodyRect.top)/Math.max(.01,scaleY),targetTop=Math.max(0,rowTop-rowHeight);
      animateQueuePosition(body,targetTop,instantPosition);
      queuePositionPending=false;queueAlignOnNextPlayback=false;
    });
  }
  function renderMiniQueue(options={}){
    if(typeof syncTraditionalPiP==="function")queueMicrotask(syncTraditionalPiP);
    const instantPosition=options.instantPosition===true;
    const el = $("#miniQueueList");
    for(let i=playQueue.length-1;i>=0;i--){
      if(playlist.findIndex(track => track.id === playQueue[i]) === -1) playQueue.splice(i,1);
    }
    if(manualQueueActive&&playQueue.length===0)manualQueueActive=false;
    const summaryTitle=$(".queue-summary strong");
    if(!manualQueueActive){
      summaryTitle.textContent=tr("歌单顺序","Library Order");
      $("#queueCount").textContent=tr(`${playlist.length} 首歌`,`${playlist.length} songs`);
      $("#clearQueueBtn").style.display="none";
      const signature=`${uiLanguage}:${playlist.length}:${hashString(playlist.map(track=>`${track.id}|${track.title}|${track.artist}|${track.duration||0}`).join("\u0001"))}`;
      const existingRows=el.querySelectorAll(".queue-default-item");
      if(miniQueueDefaultSignature===signature&&existingRows.length===playlist.length){
        if(miniQueuePlayingIndex!==currentIndex){
          el.querySelector(`.queue-default-item[data-idx="${miniQueuePlayingIndex}"]`)?.classList.remove("playing");
          el.querySelector(`.queue-default-item[data-idx="${currentIndex}"]`)?.classList.add("playing");
          miniQueuePlayingIndex=currentIndex;
        }
        positionCurrentQueueRow(instantPosition);return;
      }
      el.innerHTML="";miniQueueDefaultSignature=signature;miniQueuePlayingIndex=currentIndex;
      if(playlist.length===0){el.innerHTML=`<div class="empty-state" style="padding:24px 10px;"><p>${tr("歌单是空的，先去「歌单」页导入音乐吧","Your library is empty. Import music from Library.")}</p></div>`;return;}
      const defaultRows=[];
      for(let idx=0;idx<playlist.length;idx++){
        const t=playlist[idx];
        const thumb=t.thumbUrl||t.coverUrl;
        const cover=thumb?`<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">`:`<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
        defaultRows.push(`<div class="track-item queue-default-item ripple-target${idx===currentIndex?' playing':''}" data-idx="${idx}">${cover}<div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div><div class="track-dur">${t.duration?fmtTime(t.duration):"--:--"}</div></div>`);
      }
      if(el.dataset.defaultQueueWired!=="1"){el.dataset.defaultQueueWired="1";el.addEventListener("click",event=>{const item=event.target.closest(".queue-default-item");if(item&&el.contains(item))playAt(+item.dataset.idx);});}
      if(options.incremental===true){
        const expectedSignature=signature;
        return (async()=>{
          for(let offset=0;offset<defaultRows.length;offset+=16){
            if(miniQueueDefaultSignature!==expectedSignature)return;
            el.insertAdjacentHTML("beforeend",defaultRows.slice(offset,offset+16).join(""));
            await new Promise(resolve=>requestAnimationFrame(resolve));
          }
          positionCurrentQueueRow(instantPosition);
        })();
      }
      el.insertAdjacentHTML("beforeend",defaultRows.join(""));
      positionCurrentQueueRow(instantPosition);return;
    }
    miniQueueDefaultSignature="";miniQueuePlayingIndex=-1;el.innerHTML="";
    summaryTitle.textContent=tr("手动播放列表","Manual Queue");
    $("#queueCount").textContent=tr(`${playQueue.length} 首等待`,`${playQueue.length} queued`);
    $("#clearQueueBtn").style.display="block";$("#clearQueueBtn").disabled=false;
    const queueCanReorder=playMode!=="shuffle";el.classList.toggle("queue-shuffle-mode",!queueCanReorder);
    playQueue.forEach((trackId, queuePos) => {
      const idx = playlist.findIndex(track => track.id === trackId);
      if(idx === -1) return;
      const t = playlist[idx];
      const thumb=t.thumbUrl||t.coverUrl;
      const cover = thumb ? `<img src="${thumb}" class="track-thumb" loading="lazy" decoding="async">` :
        `<div class="track-thumb"><svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg></div>`;
      el.insertAdjacentHTML("beforeend", `
        <div class="track-item queue-item${queueCanReorder?"":" queue-shuffle-item"}" data-qpos="${queuePos}" data-track-id="${trackId}" data-idx="${idx}">
          ${cover}
          <div class="track-info"><div class="t-title">${escapeHtml(t.title)}</div><div class="t-artist">${escapeHtml(t.artist)}</div></div>
          <div class="track-dur">${t.duration ? fmtTime(t.duration) : "--:--"}</div>
          <button class="track-action track-remove queue-remove ripple-target" data-qpos="${queuePos}" title="从播放队列移除" aria-label="从播放队列移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          <button class="queue-drag-handle" data-qpos="${queuePos}" title="拖拽排序" aria-label="拖拽排序" ${queueCanReorder?"":'disabled aria-hidden="true"'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path class="drag-line drag-line-top" d="M5 8h14"/><path class="drag-line drag-line-middle" d="M5 12h14"/><path class="drag-line drag-line-bottom" d="M5 16h14"/></svg></button>
        </div>`);
    });
    el.querySelectorAll(".queue-item").forEach(item => {
      item.addEventListener("click", e => { if(queueSuppressClick || e.target.closest("button")) return; playQueuedAt(+item.dataset.qpos); });
    });
    el.querySelectorAll(".queue-remove").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); removeQueuedAt(+btn.dataset.qpos); });
    });
    el.querySelectorAll(".queue-drag-handle").forEach(handle => {
      handle.addEventListener("pointerdown",e=>{
        if(playMode==="shuffle")return;
        if(e.pointerType==="mouse"&&e.button!==0)return;
        e.preventDefault();e.stopPropagation();queueDragFrom=+handle.dataset.qpos;
        const rows=$$("#miniQueueList .queue-item");
        const sourceRect=rows[queueDragFrom]?.getBoundingClientRect(),bodyRect=$("#queueBody").getBoundingClientRect();
        queueDragState={
          pointerId:e.pointerId,from:queueDragFrom,startX:e.clientX,startY:e.clientY,lastY:e.clientY,
          active:false,insertionPos:queueDragFrom,
          rowCenters:rows.map(row=>{const rect=row.getBoundingClientRect();return rect.top+rect.height/2;}),
          rowHeight:rows[queueDragFrom]?.offsetHeight||52,sourceTop:sourceRect?.top||e.clientY,sourceHeight:sourceRect?.height||52,
          boundaryTop:rows[0]?.getBoundingClientRect().top||bodyRect.top,boundaryBottom:bodyRect.bottom
        };
        if(handle.setPointerCapture)handle.setPointerCapture(e.pointerId);
      });
    });
  }

  function clearQueueShiftVisuals(){
    $$("#miniQueueList .queue-item").forEach(row => row.classList.remove("queue-shift-up","queue-shift-down","dragging","drag-before","drag-after"));
    $("#miniQueueList").style.removeProperty("--queue-shift-distance");
  }
  function clearQueueDragVisuals(state){
    clearQueueShiftVisuals();
    $("#miniQueueList").classList.remove("queue-dragging");
    $$("#miniQueueList .queue-item").forEach(row=>{row.classList.remove("queue-lifted","queue-drag-source");row.style.removeProperty("--queue-drag-y");});
    if(state&&state.ghost){state.ghost.remove();state.ghost=null;}
  }
  function calculateQueueInsertion(state,clientY){
    const firstAfter=state.rowCenters.findIndex(center=>clientY<center);
    return firstAfter===-1?state.rowCenters.length:firstAfter;
  }
  function clampQueueDragClientY(state,clientY){
    const minimum=state.startY+state.boundaryTop-state.sourceTop,maximum=state.startY+state.boundaryBottom-state.sourceHeight-state.sourceTop;
    return Math.max(minimum,Math.min(Math.max(minimum,maximum),clientY));
  }
  function paintQueueDrag(){
    queueDragFrame=0;
    const state = queueDragState;
    if(!state||!state.active)return;
    const list = $("#miniQueueList");
    list.classList.add("queue-dragging");
    const source = list.querySelector(`.queue-item[data-qpos="${state.from}"]`);
    const boundedY=clampQueueDragClientY(state,state.lastY);state.insertionPos=calculateQueueInsertion(state,boundedY);
    clearQueueShiftVisuals();
    if(source&&!state.ghost){
      const rect=source.getBoundingClientRect();
      const ghost=source.cloneNode(true);
      ghost.removeAttribute("data-qpos");ghost.classList.remove("queue-lifted","queue-drag-source","queue-shift-up","queue-shift-down");ghost.classList.add("queue-drag-ghost");
      ghost.querySelectorAll("button").forEach(button=>button.setAttribute("tabindex","-1"));
      const shellScale=Math.max(.1,parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"))||1);
      const ghostWidth=rect.width/shellScale,ghostHeight=rect.height/shellScale;
      Object.assign(ghost.style,{left:`${rect.left-(ghostWidth-rect.width)/2}px`,top:`${rect.top-(ghostHeight-rect.height)/2}px`,width:`${ghostWidth}px`,height:`${ghostHeight}px`});
      document.body.appendChild(ghost);state.ghost=ghost;state.ghostBaseScale=shellScale;
    }
    if(source){source.classList.add("queue-drag-source");list.style.setProperty("--queue-shift-distance",`${state.rowHeight}px`);}
    if(state.ghost)state.ghost.style.transform=`translate3d(0,${boundedY-state.startY}px,0) scale(${(state.ghostBaseScale||1)*1.035})`;
    const insertion=state.insertionPos;
    $$("#miniQueueList .queue-item").forEach(row=>{const pos=+row.dataset.qpos;if(state.from<insertion&&pos>state.from&&pos<insertion)row.classList.add("queue-shift-up");if(state.from>insertion&&pos>=insertion&&pos<state.from)row.classList.add("queue-shift-down");});
  }
  document.addEventListener("pointermove", e => {
    const state = queueDragState;
    if(!state || state.pointerId !== e.pointerId) return;
    if(!state.active && Math.hypot(e.clientX-state.startX,e.clientY-state.startY) < 6) return;
    state.active = true;state.lastY=e.clientY;
    if(!queueDragFrame)queueDragFrame=requestAnimationFrame(paintQueueDrag);
    e.preventDefault();
  }, {passive:false});
  document.addEventListener("pointerup", e => {
    const state = queueDragState;
    if(!state || state.pointerId !== e.pointerId) return;
    if(queueDragFrame){cancelAnimationFrame(queueDragFrame);queueDragFrame=0;}
    queueDragState = null; queueDragFrom = null;
    if(!state.active){clearQueueDragVisuals(state);return;}
    e.preventDefault();
    queueSuppressClick = true;
    const ghostRect=state.ghost?.getBoundingClientRect()||null;
    moveQueuedTrack(state.from,calculateQueueInsertion(state,clampQueueDragClientY(state,e.clientY)),ghostRect);
    clearQueueDragVisuals(state);
    setTimeout(() => { queueSuppressClick = false; },0);
  });
  document.addEventListener("pointercancel", e => {
    if(!queueDragState || queueDragState.pointerId !== e.pointerId) return;
    if(queueDragFrame){cancelAnimationFrame(queueDragFrame);queueDragFrame=0;}
    const state=queueDragState;queueDragState = null; queueDragFrom = null; clearQueueDragVisuals(state);
  });

  function enqueueTrack(idx, placement){
    const track = playlist[idx];
    if(!track) return;
    const identity=neuralTrackId(track);
    const existingPos=playQueue.findIndex(trackId=>{
      const queued=playlist.find(item=>item.id===trackId);
      return queued&&(queued.id===track.id||neuralTrackId(queued)===identity);
    });
    if(existingPos!==-1){
      clearLibraryActionResidue();
      showToast(tr(`「${track.title}」已经在播放队列中`,`“${track.title}” is already in the queue`));
      return;
    }
    manualQueueActive=true;
    if(placement === "next") playQueue.unshift(track.id);
    else playQueue.push(track.id);
    recordBehaviorEvent("queue_add",track,{placement:placement||"end",movedExisting:false});
    renderMiniQueue();
    clearLibraryActionResidue();
    showToast(placement==="next"?tr(`已将「${track.title}」设为下一首`,`“${track.title}” will play next`):tr(`已将「${track.title}」加入播放列表`,`Added “${track.title}” to the queue`));
  }
  function clearLibraryActionResidue(){
    const library=$("#trackList");if(!library)return;
    library.querySelectorAll(".gp-press-held,.gp-press-release,.glow-pulse,.list-motion-run").forEach(element=>element.classList.remove("gp-press-held","gp-press-release","glow-pulse","list-motion-run"));
    if(library.contains(document.activeElement))document.activeElement.blur();
  }
  function releaseQueuePlaybackContext(){
    playingQueuedTrack=false;queueResumeIndex=null;
    if(pendingSelectionSource==="queue")pendingSelectionSource="sequential";
  }
  function removeQueuedAt(queuePos){
    if(queuePos < 0 || queuePos >= playQueue.length) return;
    const trackId=playQueue[queuePos],track=playlist.find(item=>item.id===trackId);
    playQueue.splice(queuePos,1);
    if(playQueue.length===0){manualQueueActive=false;releaseQueuePlaybackContext();}
    renderMiniQueue();
    showToast(track?tr(`已从播放队列移除「${track.title}」`,`Removed “${track.title}” from the queue`):tr("已从播放队列移除歌曲","Song removed from the queue"));
  }
  function clearPlayQueue(){
    const removedCount=playQueue.length;
    playQueue.length = 0;
    manualQueueActive=false;
    releaseQueuePlaybackContext();
    transitionQueueContent(()=>renderMiniQueue({instantPosition:true}));
    if(removedCount)showToast(tr(`已清空播放队列（${removedCount} 首）`,`Queue cleared (${removedCount} songs)`));
  }
  function moveQueuedTrack(from, insertionPos, ghostRect=null){
    if(from < 0 || from >= playQueue.length) return;
    const trackId = playQueue.splice(from,1)[0];
    if(from < insertionPos) insertionPos--;
    insertionPos = Math.max(0, Math.min(playQueue.length, insertionPos));
    playQueue.splice(insertionPos,0,trackId);
    renderMiniQueue();
    const dropped=$("#miniQueueList").querySelector(`.queue-item[data-qpos="${insertionPos}"]`);
    if(dropped&&ghostRect){
      const target=dropped.getBoundingClientRect(),dx=ghostRect.left-target.left,dy=ghostRect.top-target.top;
      dropped.animate([{transform:`translate3d(${dx}px,${dy}px,0) scale(1.035)`},{transform:"translate3d(0,0,0) scale(1)"}],{duration:240,easing:"cubic-bezier(.2,.82,.2,1)"});
    }
  }
  function takeNextQueuedIndex(){
    if(!manualQueueActive)return null;
    while(playQueue.length){
      const queuePos=playMode==="shuffle"?Math.floor(Math.random()*playQueue.length):0;
      const trackId = playQueue.splice(queuePos,1)[0];
      const idx = playlist.findIndex(track => track.id === trackId);
      if(idx !== -1){if(playQueue.length===0)manualQueueActive=false;renderMiniQueue();return idx;}
    }
    manualQueueActive=false;
    renderMiniQueue();
    return null;
  }
  function beginQueuedPlayback(){
    if(!playingQueuedTrack&&queueResumeIndex===null)queueResumeIndex=currentIndex;
    playingQueuedTrack=true;
  }
  function resumeAfterQueue(){
    if(!playingQueuedTrack)return false;
    const finalQueuedIndex=currentIndex;
    playingQueuedTrack=false;queueResumeIndex=null;
    if(finalQueuedIndex<0||finalQueuedIndex>=playlist.length)return false;
    showToast(tr("手动播放队列已播放完毕，继续播放歌曲库","Manual Queue finished. Continuing with the Library."));
    if(playMode==="repeatOne"){pendingSelectionSource="sequential";loadTrack(finalQueuedIndex,true);return true;}
    if(playMode==="shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(finalQueuedIndex),true);return true;}
    pendingSelectionSource="sequential";
    loadTrack((finalQueuedIndex+1)%playlist.length,true);return true;
  }
  function playQueuedAt(queuePos){
    if(queuePos < 0 || queuePos >= playQueue.length) return;
    const trackId = playQueue.splice(queuePos,1)[0];
    const idx = playlist.findIndex(track => track.id === trackId);
    if(playQueue.length===0)manualQueueActive=false;renderMiniQueue();
    if(idx !== -1){beginQueuedPlayback();playAt(idx,"queue");}
  }
  $("#clearQueueBtn").addEventListener("click", clearPlayQueue);

  function removeTrack(idx){
    const removedTrack = playlist[idx];
    if(!removedTrack) return;
    flushHistory();
    if(idx === currentIndex){
      playbackIntentToken++;pendingPlayToken=0;wantsPlayback=false;decks.forEach(deck=>deck.pause());audio.src="";isPlaying=false;currentIndex=-1;
      $("#discRotor").classList.remove("spinning","paused");resetDiscRotationTimeline();$("#diskReader").classList.remove("engaged");
      setNowPlayingTitle(tr("未选择歌曲","No Song Selected")); $("#nowArtist").textContent = tr("拖入或导入音乐开始播放","Drop or import music to begin");
      syncNowFormatTag(null);
      seekProgress = 0; drawWaveform();
      updatePlayIcon(); updateArtDisplay(); updateAmbient();
    } else if(idx < currentIndex){ currentIndex--; }
    if(overrideQueue){ overrideQueue = overrideQueue.filter(i => i !== idx).map(i => i > idx ? i-1 : i); if(!overrideQueue.length) overrideQueue = null; }
    for(let i=playQueue.length-1;i>=0;i--){ if(playQueue[i] === removedTrack.id) playQueue.splice(i,1); }
    if(playQueue.length===0){manualQueueActive=false;releaseQueuePlaybackContext();}
    const removedKey=playlistTrackKey(removedTrack);
    if(userPlaylistsCache&&removedKey!==null&&removedKey!==undefined){
      let touched=false;
      userPlaylistsCache.lists.forEach(list=>{const before=list.trackKeys.length;list.trackKeys=list.trackKeys.filter(key=>key!==removedKey);if(list.trackKeys.length!==before){touched=true;list.updatedAt=Date.now();}});
      if(touched){saveUserPlaylists();if(libraryCollectionMode!=="all")render(searchInputSafe());}
    }
    reservedSongIdentities.delete(songIdentity(removedTrack.artist,removedTrack.title));
    if(removedTrack.contentKey)reservedAudioFingerprints.delete(removedTrack.contentKey);
    if(removedTrack.coverUrl) URL.revokeObjectURL(removedTrack.coverUrl);
    if(removedTrack.thumbUrl) URL.revokeObjectURL(removedTrack.thumbUrl);
    URL.revokeObjectURL(removedTrack.url);
    playlist.splice(idx,1);
    invalidateHistoryTrackIndex();
    render(searchInputSafe());
    showToast(tr(`已从歌单移除「${removedTrack.title}」`,`Removed “${removedTrack.title}” from the library`));
  }

