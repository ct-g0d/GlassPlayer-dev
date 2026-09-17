  /* ================= listening history tracking ================= */
  let historyStoreCache=null,historyStoreRevision=0,visibleHistoryRefreshTimer=0,lastVisibleHistoryRefreshAt=0;
  let historyPersistenceTimer=0,historyPersistenceIdle=0,historyStoreDirty=false;
  function loadHistoryStore(){
    if(historyStoreCache)return historyStoreCache;
    try{ historyStoreCache=JSON.parse(GPBrowserStorage.getLocal("glassPlayerHistory")) || {songs:{},daily:{}}; }
    catch(e){ historyStoreCache={songs:{},daily:{}}; }
    return historyStoreCache;
  }
  function persistHistoryStoreNow(store=historyStoreCache){
    clearTimeout(historyPersistenceTimer);historyPersistenceTimer=0;
    if(historyPersistenceIdle&&"cancelIdleCallback" in window)cancelIdleCallback(historyPersistenceIdle);
    historyPersistenceIdle=0;
    if(!store||!historyStoreDirty)return;
    try{GPBrowserStorage.setLocal("glassPlayerHistory",JSON.stringify(store));historyStoreDirty=false;}catch(e){}
  }
  function scheduleHistoryPersistence(){
    if(historyPersistenceTimer||historyPersistenceIdle)return;
    historyPersistenceTimer=setTimeout(()=>{
      historyPersistenceTimer=0;
      if("requestIdleCallback" in window)historyPersistenceIdle=requestIdleCallback(()=>{historyPersistenceIdle=0;persistHistoryStoreNow();},{timeout:5000});
      else persistHistoryStoreNow();
    },24000);
  }
  function saveHistoryStore(store,immediate=false){
    historyStoreCache=store;historyStoreRevision+=1;historyRenderedSignatures.clear();
    historyStoreDirty=true;
    if(immediate)persistHistoryStoreNow(store);else scheduleHistoryPersistence();
    scheduleVisibleHistoryRefresh();
  }

  function spectrumHistoryKey(track){return track?.spectrumId||track?.audioEssenceKey||trackKey(track);}
  function bindHistoryIdentityBeforeMetadataChange(track){
    const store=loadHistoryStore(),stable=spectrumHistoryKey(track),legacy=trackKey(track);if(stable===legacy||!store.songs[legacy])return;
    if(store.songs[stable])mergeHistoryEntries(store.songs[stable],store.songs[legacy]);else store.songs[stable]=store.songs[legacy];delete store.songs[legacy];
    ensureSongEntry(store,stable,track);saveHistoryStore(store);
  }
  function normalizeHistoryToken(value){return String(value||"").normalize("NFKC").toLocaleLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g,"").replace(/[\s\p{P}\p{S}]+/gu,"");}
  function historyIdentityCandidates(track){
    const parsed=parseName(track?.name||track?.file?.name||""),versions=track?.metadataVersions||{};
    const artists=new Set([track?.artist,...(track?.identityLinks?.artistAliases||[]),versions.before?.metadata?.artist,versions.after?.metadata?.artist]);
    const titles=new Set([track?.title,parsed?.title,...(track?.identityLinks?.titleAliases||[]),versions.before?.metadata?.title,versions.after?.metadata?.title]);
    return {artists:new Set([...artists].map(normalizeHistoryToken).filter(Boolean)),titles:new Set([...titles].map(normalizeHistoryToken).filter(Boolean))};
  }
  function findHistoryEntryKey(store,track){
    const stable=spectrumHistoryKey(track),legacy=trackKey(track);if(store.songs[stable])return stable;if(store.songs[legacy])return legacy;
    const legacyIds=new Set([stable,track?.spectrumId,track?.audioEssenceKey,track?.contentKey,...(track?.legacyContentKeys||[])].filter(Boolean));
    for(const [key,entry] of Object.entries(store.songs||{})){
      const identity=entry.identity||{};if([identity.spectrumId,identity.audioEssenceKey,entry.spectrumId,...(identity.legacyContentKeys||[])].some(id=>legacyIds.has(id)))return key;
    }
    const candidates=historyIdentityCandidates(track);
    for(const [key,entry] of Object.entries(store.songs||{})){
      const artistTokens=[entry.artist,...(entry.identity?.artistAliases||[])].map(normalizeHistoryToken).filter(Boolean);
      const titleTokens=[entry.title,...(entry.identity?.titleAliases||[])].map(normalizeHistoryToken).filter(Boolean);
      if(titleTokens.some(title=>candidates.titles.has(title))&&artistTokens.some(artist=>candidates.artists.has(artist)))return key;
    }
    return null;
  }
  function mergeHistoryEntries(target,source){
    if(!source||target===source)return target;
    target.playCount=(target.playCount||0)+(source.playCount||0);target.totalSeconds=(target.totalSeconds||0)+(source.totalSeconds||0);
    target.daily=target.daily||{};Object.entries(source.daily||{}).forEach(([day,seconds])=>target.daily[day]=(target.daily[day]||0)+(Number(seconds)||0));
    target.dailyPlays=target.dailyPlays||{};Object.entries(source.dailyPlays||{}).forEach(([day,count])=>target.dailyPlays[day]=(target.dailyPlays[day]||0)+(Number(count)||0));
    const datedPlays=Object.values(target.dailyPlays).reduce((sum,count)=>sum+(Number(count)||0),0);
    target.legacyUndatedPlayCount=Math.max(0,(Number(target.playCount)||0)-datedPlays);
    target.identity=target.identity||{};const sourceIdentity=source.identity||{};
    target.identity.artistAliases=Array.from(new Set([...(target.identity.artistAliases||[]),...(sourceIdentity.artistAliases||[]),source.artist].filter(Boolean)));
    target.identity.titleAliases=Array.from(new Set([...(target.identity.titleAliases||[]),...(sourceIdentity.titleAliases||[]),source.title].filter(Boolean)));
    target.identity.genreSnapshots=Array.from(new Set([...(target.identity.genreSnapshots||[]),...(sourceIdentity.genreSnapshots||[]),source.genre].filter(Boolean)));
    target.identity.spectrumId=target.identity.spectrumId||sourceIdentity.spectrumId||source.spectrumId||null;
    return target;
  }

  function ensureSongEntry(store, key, t){
    const legacyKey=trackKey(t);
    if(key!==legacyKey&&store.songs[legacyKey]){
      if(store.songs[key])mergeHistoryEntries(store.songs[key],store.songs[legacyKey]);else store.songs[key]=store.songs[legacyKey];
      delete store.songs[legacyKey];
    }
    if(!store.songs[key]) store.songs[key] = {artist:t.artist, title:t.title, playCount:0, totalSeconds:0, daily:{},dailyPlays:{}};
    const entry = store.songs[key];
    if(!entry.daily){
      // Legacy totals have no trustworthy date. Never fabricate activity for today.
      entry.daily = {};
      entry.legacyUndatedSeconds = Number(entry.totalSeconds)||0;
    }
    entry.dailyPlays=entry.dailyPlays||{};
    if(!Number.isFinite(Number(entry.legacyUndatedPlayCount))){
      const datedPlays=Object.values(entry.dailyPlays).reduce((sum,count)=>sum+(Number(count)||0),0);
      entry.legacyUndatedPlayCount=Math.max(0,(Number(entry.playCount)||0)-datedPlays);
    }
    const hasDatedPlays=Object.values(entry.dailyPlays).some(count=>(Number(count)||0)>0);
    if(!hasDatedPlays&&!entry.legacyDailySeconds&&Object.keys(entry.daily).length)entry.legacyDailySeconds={...entry.daily};
    entry.identity=entry.identity||{spectrumId:t.spectrumId||t.audioEssenceKey||null,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreSnapshots:[]};
    entry.identity.spectrumId=t.spectrumId||t.audioEssenceKey||entry.identity.spectrumId||null;
    entry.identity.artistAliases=Array.from(new Set([...(entry.identity.artistAliases||[]),entry.artist,t.artist].filter(Boolean)));
    const versions=t.metadataVersions||{};
    entry.identity.titleAliases=Array.from(new Set([...(entry.identity.titleAliases||[]),entry.title,t.title,...(t.identityLinks?.titleAliases||[]),versions.before?.metadata?.title,versions.after?.metadata?.title].filter(Boolean)));
    entry.identity.genreSnapshots=Array.from(new Set([...(entry.identity.genreSnapshots||[]),t.genre].filter(Boolean)));
    entry.artist=t.artist;entry.title=t.title;entry.album=t.album||entry.album||null;entry.genre=t.genre||entry.genre||null;entry.duration=Number(t.duration)||Number(entry.duration)||0;
    return entry;
  }
  function syncHistoryMetadataForPlaylist(){
    const store=loadHistoryStore();let changed=false;
    playlist.forEach(t=>{
      const key=spectrumHistoryKey(t),sourceKey=findHistoryEntryKey(store,t);if(!sourceKey)return;
      const before=JSON.stringify(store.songs[key]||store.songs[sourceKey]);
      if(sourceKey!==key){if(store.songs[key])mergeHistoryEntries(store.songs[key],store.songs[sourceKey]);else store.songs[key]=store.songs[sourceKey];delete store.songs[sourceKey];changed=true;}
      const entry=ensureSongEntry(store,key,t);
      entry.artist=t.artist;entry.title=t.title;entry.album=t.album||null;entry.genre=t.genre||null;
      if(before!==JSON.stringify(entry))changed=true;
    });
    if(changed)saveHistoryStore(store);
  }
  function flushHistory(forcePersist=false){
    if(!listeningKey) return;
    const delta = Math.max(0, audio.currentTime - lastTimeMark);
    lastTimeMark = audio.currentTime;
    if(delta <= 0 || delta > 5) return; // guard against seeks/jumps
    const store = loadHistoryStore();
    const t = playlist[currentIndex];
    if(!t) return;
    const entry = ensureSongEntry(store, listeningKey, t);
    const day = todayKey();
    entry.daily[day] = (entry.daily[day]||0) + delta;
    entry.totalSeconds = (entry.totalSeconds||0) + delta;
    store.daily[day] = (store.daily[day]||0) + delta;
    store.hourly=store.hourly||{};store.hourly[day]=store.hourly[day]||{};
    const hour=String(new Date().getHours()).padStart(2,"0");
    store.hourly[day][hour]=(store.hourly[day][hour]||0)+delta;
    saveHistoryStore(store,forcePersist);
  }
  function incrementPlayCount(){
    if(!listeningKey) return;
    const store = loadHistoryStore();
    const t = playlist[currentIndex];
    if(!t) return;
    const entry = ensureSongEntry(store, listeningKey, t);
    entry.playCount += 1;
    const day=todayKey();
    entry.dailyPlays[day]=(entry.dailyPlays[day]||0)+1;
    saveHistoryStore(store);
  }
  function sumSongInRange(entry, days, now){
    if(!entry.daily) return days===Infinity?(entry.totalSeconds||0):0;
    if(days === Infinity) return Object.values(entry.daily).reduce((a,b)=>a+b,0);
    let sum = 0;
    for(let i=0;i<days;i++){ const d = new Date(now); d.setDate(d.getDate()-i); sum += entry.daily[todayKey(d)] || 0; }
    return sum;
  }
  function sumPlayCountInRange(entry,days,now,duration=0){
    const daily=entry.dailyPlays||{};
    const datedTotal=Object.values(daily).reduce((sum,count)=>sum+(Number(count)||0),0);
    const legacySnapshot=entry.legacyDailySeconds;
    const legacyDaily=legacySnapshot&&Object.keys(legacySnapshot).length?legacySnapshot:(datedTotal?{}:(entry.daily||{}));
    const legacySecondsTotal=Object.values(legacyDaily).reduce((sum,seconds)=>sum+(Number(seconds)||0),0);
    const inferLegacy=seconds=>{
      const listened=Math.max(0,Number(seconds)||0);
      if(!listened)return 0;
      if(duration>0)return Math.max(1,Math.floor(listened/(duration*.75)));
      return 1;
    };
    if(days===Infinity)return Math.max(Number(entry.playCount)||0,datedTotal+inferLegacy(legacySecondsTotal));
    let datedInRange=0;
    for(let i=0;i<days;i++){const d=new Date(now);d.setDate(d.getDate()-i);datedInRange+=Number(daily[todayKey(d)])||0;}
    const legacy=Math.max(0,Number(entry.legacyUndatedPlayCount)||0);
    if(!legacy)return datedInRange+inferLegacy(Array.from({length:days},(_,i)=>{const d=new Date(now);d.setDate(d.getDate()-i);return Number(legacyDaily[todayKey(d)])||0;}).reduce((sum,seconds)=>sum+seconds,0));
    const allLegacySeconds=Object.values(legacyDaily).reduce((sum,seconds)=>sum+(Number(seconds)||0),0);
    if(!allLegacySeconds)return datedInRange;
    let rangeSeconds=0;
    for(let i=0;i<days;i++){const d=new Date(now);d.setDate(d.getDate()-i);rangeSeconds+=Number(legacyDaily[todayKey(d)])||0;}
    return datedInRange+Math.max(0,Math.min(legacy,Math.round(legacy*rangeSeconds/allLegacySeconds)));
  }
  setInterval(flushHistory, 8000);
  window.addEventListener("beforeunload",()=>{emitListeningCheckpoint("unload");flushHistory(true);persistHistoryStoreNow();});
  window.addEventListener("pagehide",()=>{emitListeningCheckpoint("pagehide");flushHistory(true);persistHistoryStoreNow();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){emitListeningCheckpoint("hidden");flushHistory(true);persistHistoryStoreNow();}else resetBehaviorMediaClock();});

  $("#rangeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    $$("#rangeSeg button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    requestAnimationFrame(()=>updateGlider($("#rangeSeg"),true));
    scheduleHistoryRender();
  });

  function historyDay(offset=0){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-offset);return d;}
  function sumDailyOffsets(daily,start,count){let total=0;for(let i=start;i<start+count;i++)total+=Number(daily?.[todayKey(historyDay(i))])||0;return total;}
  function calendarHistoryRange(kind,offset=0){
    const now=new Date(),start=new Date(now),end=new Date(now);start.setHours(0,0,0,0);end.setHours(0,0,0,0);
    if(kind==="day"){start.setDate(start.getDate()-offset);end.setTime(start.getTime());end.setDate(end.getDate()+1);}
    else if(kind==="week"){
      const mondayDelta=(start.getDay()+6)%7;start.setDate(start.getDate()-mondayDelta-offset*7);end.setTime(start.getTime());end.setDate(end.getDate()+7);
    }else if(kind==="month"){
      start.setDate(1);start.setMonth(start.getMonth()-offset);end.setTime(start.getTime());end.setMonth(end.getMonth()+1);
    }else if(kind==="year"){
      start.setMonth(0,1);start.setFullYear(start.getFullYear()-offset);end.setTime(start.getTime());end.setFullYear(end.getFullYear()+1);
    }else return null;
    return {start,end};
  }
  function dayKeyInRange(key,range){if(!range)return true;const stamp=new Date(`${key}T12:00:00`).getTime();return stamp>=range.start.getTime()&&stamp<range.end.getTime();}
  function sumDailyRange(daily,range){return Object.entries(daily||{}).reduce((sum,[key,value])=>sum+(dayKeyInRange(key,range)?Number(value)||0:0),0);}
  function sumSongRange(entry,range){return sumDailyRange(entry?.daily,range);}
  function sumPlayCountRange(entry,range,duration=0){
    if(!range)return sumPlayCountInRange(entry,Infinity,new Date(),duration);
    const dated=Object.entries(entry?.dailyPlays||{}).reduce((sum,[key,value])=>sum+(dayKeyInRange(key,range)?Number(value)||0:0),0);
    const legacySeconds=sumDailyRange(entry?.legacyDailySeconds||(!Object.keys(entry?.dailyPlays||{}).length?entry?.daily:{}),range);
    return dated+(legacySeconds>0?(duration>0?Math.max(1,Math.floor(legacySeconds/(duration*.75))):1):0);
  }
  function getLibraryPlayCounts(){
    const store=loadHistoryStore(),counts=new Map();
    playlist.forEach(track=>{
      const key=findHistoryEntryKey(store,track),entry=key?store.songs[key]:null;
      counts.set(track.id,entry?sumPlayCountRange(entry,null,Number(track.duration)||Number(entry.duration)||0):0);
    });
    return counts;
  }
  let historyTrackIndex=null;
  function invalidateHistoryTrackIndex(){historyTrackIndex=null;historyRenderedSignatures.clear();}
  function getHistoryTrackIndex(){
    if(historyTrackIndex)return historyTrackIndex;
    const byKey=new Map(),byAlias=new Map(),coverByKey=new Map();
    playlist.forEach(track=>{
      const stable=spectrumHistoryKey(track),legacy=trackKey(track),cover=track.thumbUrl||track.coverUrl||null,candidates=historyIdentityCandidates(track);
      byKey.set(stable,track);byKey.set(legacy,track);
      if(cover){coverByKey.set(stable,cover);coverByKey.set(legacy,cover);}
      for(const artist of candidates.artists)for(const title of candidates.titles){
        const aliasKey=artist+"||"+title;
        if(!byAlias.has(aliasKey))byAlias.set(aliasKey,track);
        if(cover&&!coverByKey.has(aliasKey))coverByKey.set(aliasKey,cover);
      }
    });
    historyTrackIndex={byKey,byAlias,coverByKey};return historyTrackIndex;
  }
  function currentTrackForHistory(key,entry){
    const index=getHistoryTrackIndex(),direct=index.byKey.get(key);if(direct)return direct;
    const artists=new Set([entry?.artist,...(entry?.identity?.artistAliases||[])].map(normalizeHistoryToken).filter(Boolean));
    const titles=new Set([entry?.title,...(entry?.identity?.titleAliases||[])].map(normalizeHistoryToken).filter(Boolean));
    for(const artist of artists)for(const title of titles){const match=index.byAlias.get(artist+"||"+title);if(match)return match;}
    return null;
  }
  function setBatchedScrollHTML(element,html){
    if(!element)return;element.dataset.gpSseBatch="1";element.innerHTML=html;
    requestAnimationFrame(()=>{delete element.dataset.gpSseBatch;scheduleScrollEdgeUpdate(element);});
  }
  function renderHistoryComparison(store,range,currentRange,current){
    const el=$("#historyCompare");if(!el)return;
    if(!currentRange){el.textContent=tr("持续积累中","Growing with every listen");el.className="history-compare flat";return;}
    const previous=sumDailyRange(store.daily,calendarHistoryRange(range,1)),diff=current-previous;
    if(Math.abs(diff)<1){el.textContent=tr("与上一周期持平","No change from the previous period");el.className="history-compare flat";return;}
    const up=diff>0,period=uiLanguage==="zh"?({day:"昨天",week:"上一周",month:"上一个月",year:"去年"}[range]):({day:"yesterday",week:"the previous week",month:"the previous month",year:"last year"}[range]);
    el.className=`history-compare ${up?"up":"down"}`;
    el.innerHTML=`<span class="compare-arrow">${up?"▲":"▼"}</span>${tr(`相比${period}${up?"增加":"减少"} ${fmtDuration(Math.abs(diff))}`,`${fmtDuration(Math.abs(diff))} ${up?"more":"less"} than ${period}`)}`;
  }
  function renderHistoryRanking(store,range){
    const candidates=Object.entries(store.songs||{}).map(([historyKey,s])=>{const track=currentTrackForHistory(historyKey,s);return {...s,historyKey,track,rangeSeconds:sumSongRange(s,range)};}).filter(s=>s.rangeSeconds>0).sort((a,b)=>b.rangeSeconds-a.rangeSeconds),ranked=candidates.slice(0,50);
    const topSong=$("#historyStatTopSong");
    if(topSong)topSong.textContent=ranked[0]?.title||"—";
    const topList=$("#topList");if(!ranked.length){setBatchedScrollHTML(topList,`<div class="empty-state"><p>${tr("这个时间段还没有听歌记录","No listening history for this range")}</p></div>`);return;}
    const historyIndex=getHistoryTrackIndex(),fallback=`<svg class="single-alpha-icon rounded-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="3"/><path d="M9 17V5l12-2v12"/><circle cx="18" cy="16" r="3"/></svg>`;
    const coverFor=s=>{const normalized=normalizeHistoryToken(s.artist)+"||"+normalizeHistoryToken(s.title);return historyIndex.coverByKey.get(s.historyKey)||historyIndex.coverByKey.get(normalized)||s.track?.thumbUrl||s.track?.coverUrl||null;};
    const top3=ranked.slice(0,3),ranks4to10=ranked.slice(3,10),ranks11to50=ranked.slice(10,50),maxSec=ranked[0].rangeSeconds||1,podiumOrder=[top3[1],top3[0],top3[2]];
    const podium=`<div class="podium">${podiumOrder.map(s=>{if(!s)return `<div class="podium-item podium-empty"></div>`;const rank=s===top3[0]?1:s===top3[1]?2:3,size=rank===1?128:96,cover=coverFor(s);return `<div class="podium-item rank${rank}"><div class="podium-cover-wrap">${cover?`<img src="${cover}" class="podium-cover" style="width:${size}px;height:${size}px" loading="lazy" decoding="async">`:`<div class="podium-cover-fallback" style="width:${size}px;height:${size}px">${fallback}</div>`}<div class="podium-medal">${rank}</div></div><div class="podium-name">${escapeHtml(s.title)}</div><div class="podium-artist">${escapeHtml(s.artist)}</div><div class="podium-time">${fmtDuration(s.rangeSeconds)}</div></div>`;}).join("")}</div>`;
    const rankRows=(items,startRank)=>items.map((s,i)=>{const cover=coverFor(s);return `<div class="top-row"><div class="top-rank">${startRank+i}</div><div class="top-row-main">${cover?`<img src="${cover}" class="track-thumb" loading="lazy" decoding="async">`:`<div class="track-thumb">${fallback}</div>`}<div class="top-info"><div class="t-title">${escapeHtml(s.title)}</div><div class="t-artist">${escapeHtml(s.artist)}</div></div></div><div class="top-row-metrics"><div class="top-bar-wrap"><div class="top-bar-fill" style="width:${(s.rangeSeconds/maxSec*100).toFixed(0)}%"></div></div><div class="top-meta"><span>${fmtDuration(s.rangeSeconds)}</span></div></div></div>`;}).join("");
    const rankHeading=`<div class="history-ranks-heading"><span>${tr("歌曲","Song")}</span><span>${tr("时长","Duration")}</span></div>`;
    const leftMarkup=`<div class="history-ranking-kicker">${tr("Top 10","Top 10")}</div>${podium}`;
    const leftRows=rankRows(ranks4to10,4),rightRows=rankRows(ranks11to50,11);
    const leftRanksMarkup=`${rankHeading}<div class="history-rank-rows">${leftRows||`<div class="history-ranking-caption">${tr("暂无更多歌曲","No more songs in this range")}</div>`}</div>`;
    const rightRanksMarkup=`<div class="history-ranking-kicker">${tr("11–50","11–50")}</div>${rankHeading}<div class="history-rank-rows">${rightRows||`<div class="history-ranking-caption">${tr("暂无更多歌曲","No more songs in this range")}</div>`}</div>`;
    setBatchedScrollHTML(topList,`<div class="history-ranking-grid"><div class="history-ranking-left" id="historyRankingLeft" data-gp-sse><section class="history-top10" id="historyTop3">${leftMarkup}</section><section class="history-left-ranks" id="historyRanks4to10">${leftRanksMarkup}</section></div><section class="history-ranks-list" id="historyRanks11to50" data-gp-sse>${rightRanksMarkup}</section></div>`);
  }
  function chooseNeuralWindow(store){
    const candidates=[7,14,21,30,45],thresholds={7:[1200,2],14:[1800,3],21:[2400,4],30:[3000,5],45:[3600,6]};
    let fallback={days:45,total:0,active:0,confident:false};
    for(const days of candidates){
      const total=sumDailyOffsets(store.daily,0,days),active=Array.from({length:days},(_,i)=>Number(store.daily?.[todayKey(historyDay(i))])||0).filter(Boolean).length,[minimumSeconds,minimumDays]=thresholds[days];
      const result={days,total,active,confident:total>=minimumSeconds&&active>=minimumDays};
      fallback=result;if(result.confident)return result;
    }
    return fallback;
  }
  function recentAffinity(entry,days){
    const halfLife=Math.max(3.5,days*.28),daily=entry?.daily||{};let weightedSeconds=0,weightedPlays=0,recentSeconds=0,olderSeconds=0;
    for(let offset=0;offset<days;offset++){
      const key=todayKey(historyDay(offset)),seconds=Number(daily[key])||0,weight=Math.pow(.5,offset/halfLife);
      weightedSeconds+=seconds*weight;weightedPlays+=(Number(entry?.dailyPlays?.[key])||0)*weight;
      if(offset<Math.max(3,Math.ceil(days*.34)))recentSeconds+=seconds;else olderSeconds+=seconds;
    }
    const recentSpan=Math.max(3,Math.ceil(days*.34)),olderSpan=Math.max(1,days-recentSpan);
    const momentum=Math.max(.72,Math.min(1.45,(recentSeconds/recentSpan+30)/(olderSeconds/olderSpan+30)));
    return (weightedSeconds+weightedPlays*75)*momentum;
  }
  function topAggregate(items,keyFn){const totals=new Map();items.forEach(item=>{const key=keyFn(item);if(key)totals.set(key,(totals.get(key)||0)+item.recentScore);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||null;}
  function renderRecentFavorites(store){
    const win=chooseNeuralWindow(store),items=Object.entries(store.songs||{}).map(([key,s])=>{const track=currentTrackForHistory(key,s),rangeSeconds=sumSongInRange(s,win.days,new Date());return {...s,key,track,rangeSeconds,recentScore:recentAffinity(s,win.days)};}).filter(s=>s.rangeSeconds>0&&s.recentScore>0);
    const song=[...items].sort((a,b)=>b.recentScore-a.recentScore)[0],artist=topAggregate(items,s=>s.track?.artist||s.artist),album=topAggregate(items,s=>s.track?.album||s.album),genre=topAggregate(items,s=>s.track?.genre||s.genre);
    const buckets={morning:0,noon:0,afternoon:0,evening:0,late:0};let hourTotal=0,activeHourDays=0;
    for(let i=0;i<win.days;i++){const hours=store.hourly?.[todayKey(historyDay(i))];if(!hours)continue;activeHourDays++;Object.entries(hours).forEach(([h,sec])=>{const key=listeningPeriodForHour(+h);buckets[key]+=Number(sec)||0;hourTotal+=Number(sec)||0;});}
    const periodRows=Object.entries(buckets).sort((a,b)=>b[1]-a[1]);
    const periodLabels={morning:tr("清晨","Early Morning"),noon:tr("午间","Midday"),afternoon:tr("下午","Afternoon"),evening:tr("晚间","Evening"),late:tr("深夜","Late Night")};
    const periodDescriptors={morning:tr("晨光清醒","Clear Mornings"),noon:tr("午间舒展","Easy Midday"),afternoon:tr("下午专注","Focused Afternoons"),evening:tr("晚间沉浸","Immersive Evenings"),late:tr("深夜独处","Late-night Solitude")};
    const timeGenre=neuralModel?.preference?.timeGenre||{};
    const preferredGenre=slot=>Object.entries(timeGenre[slot]||{}).filter(([,score])=>Number(score)>0).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
    const qualifiedPeriods=periodRows.filter(([,seconds])=>seconds>=Math.max(600,hourTotal*.12)).slice(0,3);
    const habitReady=Boolean(qualifiedPeriods.length&&hourTotal>=1800&&activeHourDays>=3);
    const habitParts=habitReady?qualifiedPeriods.map(([slot])=>{const genre=preferredGenre(slot);return {period:periodDescriptors[slot]||periodLabels[slot],genre};}):[];
    const confidenceText=habitReady?(win.confident?tr("Resonance Boost 已形成稳定结论","Resonance Boost found a stable pattern"):tr("样本较少，结论会随收听继续调整","Limited evidence — this will refine as you listen")):"";
    const card=(label,value)=>`<article class="favorite-card"><div class="favorite-label">${label}</div><div class="favorite-answer"><strong>${escapeHtml(value||tr("等待更多收听记录","Waiting for more listening"))}</strong></div></article>`;
    const habitMarkup=habitReady?habitParts.map(part=>`<span class="habit-part"><strong>${escapeHtml(part.period)}</strong>${part.genre?`<span>${escapeHtml(part.genre)}</span>`:""}</span>`).join(""):`<span class="habit-learning">${tr("仍在学习你的听歌时段","Still learning your listening rhythm")}</span>`;
    setBatchedScrollHTML($("#favoritesGrid"),`<div class="favorite-matrix">${card(tr("最爱歌曲","Favorite Song"),song?.title)}${card(tr("最爱艺人","Favorite Artist"),artist?.[0])}${card(tr("最爱专辑","Favorite Album"),album?.[0])}${card(tr("最爱风格","Favorite Genre"),genre?.[0])}</div><article class="favorite-habit-panel"><div class="habit-heading"><div class="favorite-label">${tr("听歌习惯","Listening Rhythm")}</div>${confidenceText?`<div class="favorite-confidence">${confidenceText}</div>`:""}</div><div class="favorite-answer habit-parts">${habitMarkup}</div></article>`);
  }
  function artistTopForOffsets(store,start,count){
    const totals=new Map();Object.values(store.songs||{}).forEach(s=>{const sec=sumDailyOffsets(s.daily,start,count);if(sec>0)totals.set(s.artist||tr("未知艺人","Unknown Artist"),(totals.get(s.artist)||0)+sec);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function artistTopForMonth(store,date){
    const prefix=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-`,totals=new Map();Object.values(store.songs||{}).forEach(s=>{let sec=0;Object.entries(s.daily||{}).forEach(([day,value])=>{if(day.startsWith(prefix))sec+=Number(value)||0;});if(sec>0)totals.set(s.artist||tr("未知艺人","Unknown Artist"),(totals.get(s.artist)||0)+sec);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function artistTopForCalendarRange(store,range){
    const totals=new Map();Object.values(store.songs||{}).forEach(entry=>{const seconds=sumSongRange(entry,range),artist=entry.artist||tr("未知艺人","Unknown Artist");if(seconds>0)totals.set(artist,(totals.get(artist)||0)+seconds);});return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||[tr("暂无","None"),0];
  }
  function periodBars(rows){const max=Math.max(1,...rows.map(r=>r.value));return `<div class="period-bars">${rows.map(r=>`<div class="period-row" data-chart-tip="${escapeHtml(`${r.label} · ${r.name} · ${fmtDuration(r.value)}`)}"><span class="period-label">${escapeHtml(r.label)}</span><span class="period-name">${escapeHtml(r.name)}</span><span class="period-track"><span class="period-fill" style="display:block;width:${(r.value/max*100).toFixed(1)}%"></span></span></div>`).join("")}</div>`;}
  function chooseInsightWindow(store){
    const candidates=[4,6,8,12,16];let fallback={weeks:4,activeWeeks:0,activeDays:0,total:0,confident:false};
    for(const weeks of candidates){const total=sumDailyOffsets(store.daily,0,weeks*7),activeDays=Array.from({length:weeks*7},(_,i)=>Number(store.daily?.[todayKey(historyDay(i))])||0).filter(Boolean).length,activeWeeks=Array.from({length:weeks},(_,i)=>sumDailyOffsets(store.daily,i*7,7)).filter(Boolean).length,result={weeks,activeWeeks,activeDays,total,confident:total>=7200&&activeDays>=6&&activeWeeks>=Math.min(3,Math.ceil(weeks*.42))};fallback=result;if(result.confident)return result;}
    return fallback;
  }
  function topHistoryDimension(store,start,count,field){
    const totals=new Map();Object.entries(store.songs||{}).forEach(([key,s])=>{const seconds=sumDailyOffsets(s.daily,start,count),track=currentTrackForHistory(key,s),value=field==="album"?(track?.album||s.album):field==="genre"?(track?.genre||s.genre):field==="song"?(track?.title||s.title):(track?.artist||s.artist);if(seconds>0&&value)totals.set(value,(totals.get(value)||0)+seconds);});
    return [...totals.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
  }
  function buildListeningInsights(store){
    const win=chooseInsightWindow(store),days=win.weeks*7,insights=[],weekly=Array.from({length:win.weeks},(_,i)=>artistTopForOffsets(store,i*7,7)),artistWeeks=new Map();weekly.forEach(([name,value])=>{if(value>0)artistWeeks.set(name,(artistWeeks.get(name)||0)+1);});
    const dominant=[...artistWeeks.entries()].sort((a,b)=>b[1]-a[1])[0],album=topHistoryDimension(store,0,days,"album"),song=topHistoryDimension(store,0,days,"song");
    if(dominant)insights.push(tr(`在可信的 <strong>${win.weeks} 周</strong>观察窗口中，<strong>${escapeHtml(dominant[0])}</strong> 有 <strong>${dominant[1]} 周</strong>成为最爱艺人。`,`Across a reliable <strong>${win.weeks}-week</strong> window, <strong>${escapeHtml(dominant[0])}</strong> was your favorite artist for <strong>${dominant[1]} weeks</strong>.`));
    if(album)insights.push(tr(`这段观察期听得最久的专辑是 <strong>${escapeHtml(album[0])}</strong>，累计 <strong>${fmtDuration(album[1])}</strong>。`,`Your most-listened album in this window was <strong>${escapeHtml(album[0])}</strong> at <strong>${fmtDuration(album[1])}</strong>.`));
    if(song)insights.push(tr(`单曲 <strong>${escapeHtml(song[0])}</strong>获得了最高收听时长：<strong>${fmtDuration(song[1])}</strong>。`,`The song <strong>${escapeHtml(song[0])}</strong> led listening time with <strong>${fmtDuration(song[1])}</strong>.`));
    const previous=sumDailyOffsets(store.daily,days,days);if(win.total>0&&previous>0){const diff=win.total-previous,percent=Math.round(Math.abs(diff)/Math.max(1,previous)*100);insights.push(tr(`总听歌时长较前一个同等窗口<strong>${diff>=0?"增加":"减少"} ${percent}%</strong>，当前为 <strong>${fmtDuration(win.total)}</strong>。`,`Total listening time <strong>${diff>=0?"rose":"fell"} ${percent}%</strong> versus the previous equal window, reaching <strong>${fmtDuration(win.total)}</strong>.`));}
    const weekdays=new Map();for(let i=0;i<days;i++){const d=historyDay(i),seconds=Number(store.daily?.[todayKey(d)])||0;if(seconds){const label=d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{weekday:"long"});weekdays.set(label,(weekdays.get(label)||0)+seconds);}}const topDay=[...weekdays.entries()].sort((a,b)=>b[1]-a[1])[0];if(topDay)insights.push(tr(`<strong>${escapeHtml(topDay[0])}</strong>最容易进入听歌状态，累计 <strong>${fmtDuration(topDay[1])}</strong>。`,`You listened most often on <strong>${escapeHtml(topDay[0])}</strong>, totaling <strong>${fmtDuration(topDay[1])}</strong>.`));
    if(!insights.length)insights.push(tr("数据仍不足以形成可信洞察；Resonance Boost 会继续在本地积累证据。","There is not enough evidence for reliable insights yet; Resonance Boost will keep learning locally."));
    return insights.slice(0,5);
  }
  function renderListeningData(store){
    const recent=Array.from({length:10},(_,i)=>{const offset=9-i,d=historyDay(offset);return {label:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"numeric",day:"numeric"}),tip:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short",day:"numeric",weekday:"short"}),value:Number(store.daily?.[todayKey(d)])||0};}),max=Math.max(1,...recent.map(d=>d.value)),W=720,H=170,padX=30,padTop=20,padBottom=30;
    const points=recent.map((d,i)=>({x:padX+i*(W-padX*2)/9,y:H-padBottom-(d.value/max)*(H-padTop-padBottom),...d}));
    const curvePath=monotoneCurvePath(points,.62);
    const areaPath=`${curvePath} L ${W-padX} ${H-padBottom} L ${padX} ${H-padBottom} Z`;
    const svg=`<svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="historyAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[0,.5,1].map(n=>`<line class="chart-grid" x1="${padX}" y1="${padTop+n*(H-padTop-padBottom)}" x2="${W-padX}" y2="${padTop+n*(H-padTop-padBottom)}"/>`).join("")}<path class="chart-area" d="${areaPath}"/><path class="chart-line" d="${curvePath}"/>${points.map(p=>`<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4.5" data-chart-tip="${escapeHtml(`${p.tip} · ${fmtDuration(p.value)}`)}"/><text class="chart-label" x="${p.x}" y="${H-8}">${escapeHtml(p.label)}</text>`).join("")}</svg>`;
    const weeks=Array.from({length:12},(_,i)=>{const age=11-i,[name,value]=artistTopForCalendarRange(store,calendarHistoryRange("week",age));return {label:age===0?tr("本周","This week"):tr(`${age}周前`,`${age}w ago`),name,value};});
    const months=Array.from({length:12},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(11-i));const [name,value]=artistTopForMonth(store,d);return {label:d.toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short"}),name,value};});
    const insights=buildListeningInsights(store);
    setBatchedScrollHTML($("#dataDashboard"),`<section class="data-card wide"><h3>${tr("过去十天听歌时间","Listening Time · Last Ten Days")}</h3><div class="data-sub">${tr("悬停数据点查看日期与详细时长","Hover a point for the date and listening time")}</div>${svg}</section><section class="data-card"><h3>${tr("过去十二周最爱艺人","Favorite Artists · Twelve Weeks")}</h3><div class="data-sub">${tr("每周以听歌时长计算","Calculated from weekly listening time")}</div>${periodBars(weeks)}</section><section class="data-card"><h3>${tr("过去十二个月最爱艺人","Favorite Artists · Twelve Months")}</h3><div class="data-sub">${tr("悬停条形查看月份、艺人和时长","Hover a bar for month, artist and time")}</div>${periodBars(months)}</section><section class="data-card wide"><div class="neural-insights">${insights.map(text=>`<div class="neural-insight">${text}</div>`).join("")}</div></section>`);
  }
  /* ============ annual report (7.4.0 典藏更新) ============
     History Service owns yearly aggregation; History View renders it.
     The report year rolls forward automatically: Dec 31 (year Y) through
     Jan 14 (year Y+1) opens year Y and presents it once per session.
     Completed years stay viewable and downloadable all year. Downloads are
     standalone interactive HTML (inline style plus <details> expanders and
     title tooltips; blob: covers are omitted by design). */
  const ANNUAL_WINDOW_END_DAY=14;
  function annualReportWindow(now=new Date()){
    const month=now.getMonth(),date=now.getDate(),year=now.getFullYear();
    if(month===11&&date===31)return {open:true,year};
    if(month===0&&date<=ANNUAL_WINDOW_END_DAY)return {open:true,year:year-1};
    return {open:false,year:year-1};
  }
  function annualAvailableYears(store){
    const years=new Set(),collect=key=>{const year=Number(String(key||"").slice(0,4));if(Number.isInteger(year)&&year>=2000&&year<=9999)years.add(year);};
    Object.keys(store.daily||{}).forEach(collect);
    Object.values(store.songs||{}).forEach(entry=>Object.keys(entry?.daily||{}).forEach(collect));
    return [...years].sort((a,b)=>b-a);
  }
  function buildAnnualReport(store,year){
    const range={start:new Date(year,0,1),end:new Date(year+1,0,1)};
    const total=sumDailyRange(store.daily,range);
    const songs=Object.entries(store.songs||{}).map(([key,entry])=>({key,entry,track:currentTrackForHistory(key,entry),seconds:sumSongRange(entry,range),plays:sumPlayCountRange(entry,range,Number(entry.duration)||0)})).filter(item=>item.seconds>0).sort((a,b)=>b.seconds-a.seconds||b.plays-a.plays);
    const totalPlays=songs.reduce((sum,item)=>sum+item.plays,0);
    const artists=new Map(),albums=new Map(),genres=new Map();
    songs.forEach(item=>{
      const artist=item.track?.artist||item.entry.artist,album=item.track?.album||item.entry.album,genre=item.track?.genre||item.entry.genre;
      if(artist)artists.set(artist,(artists.get(artist)||0)+item.seconds);
      if(album)albums.set(album,(albums.get(album)||0)+item.seconds);
      if(genre)genres.set(genre,(genres.get(genre)||0)+item.seconds);
    });
    const topRows=list=>[...list.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const monthly=Array.from({length:12},(_,month)=>{
      const seconds=sumDailyRange(store.daily,{start:new Date(year,month,1),end:new Date(year,month+1,1)});
      const [name]=artistTopForMonth(store,new Date(year,month,1));
      return {label:new Date(year,month,1).toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short"}),name:seconds>0?name:tr("—","—"),value:seconds};
    });
    const activeDays=Object.entries(store.daily||{}).filter(([key,value])=>String(key).startsWith(`${year}-`)&&(Number(value)||0)>0).length;
    let bestDay=null;
    Object.entries(store.daily||{}).forEach(([key,value])=>{if(String(key).startsWith(`${year}-`)&&(Number(value)||0)>0&&(!bestDay||Number(value)>bestDay.value))bestDay={key,value:Number(value)};});
    const hourTotals=Array.from({length:24},()=>0);
    Object.entries(store.hourly||{}).forEach(([day,hours])=>{if(!String(day).startsWith(`${year}-`))return;Object.entries(hours||{}).forEach(([hour,seconds])=>{const slot=Number(hour);if(slot>=0&&slot<24)hourTotals[slot]+=Number(seconds)||0;});});
    const peakHour=hourTotals.indexOf(Math.max(...hourTotals,0));
    return {year,total,totalPlays,activeDays,bestDay,songs:songs.slice(0,10),topSong:songs[0]||null,artists:topRows(artists),albums:topRows(albums),genres:topRows(genres),monthly,peakHour:hourTotals[peakHour]>0?peakHour:null};
  }
  let annualReportYear=null,annualAutoOpenedFor=0;
  function renderAnnualTabs(years,target,win){
    const host=$("#annualYearTabs");if(!host)return;
    host.innerHTML=years.map(year=>`<button type="button" class="${year===target?"active":""}" data-annual-year="${year}">${year}${win.open&&year===win.year?` · ${tr("新","New")}`:""}</button>`).join("");
  }
  function renderAnnualBody(store,year){
    const host=$("#annualReportBody");if(!host)return;
    const report=buildAnnualReport(store,year);
    $("#annualReportTitle").textContent=tr(`${year} 年度报告`,`${year} Annual Report`);
    if(report.total<=0){setBatchedScrollHTML(host,`<div class="empty-state"><p>${tr(`${year} 年还没有听歌记录`,`No listening history for ${year}`)}</p></div>`);return;}
    const card=(label,value)=>`<article class="favorite-card annual-stat"><div class="favorite-label">${label}</div><div class="favorite-answer"><strong>${value}</strong></div></article>`;
    const top=report.topSong;
    const topSongValue=top?`${escapeHtml(top.track?.title||top.entry.title)} · ${escapeHtml(top.track?.artist||top.entry.artist)}<span>${fmtDuration(top.seconds)}</span>`:"—";
    const bestDayValue=report.bestDay?`${escapeHtml(report.bestDay.key)} · ${fmtDuration(report.bestDay.value)}`:"—";
    const peakValue=report.peakHour===null?tr("—","—"):tr(`${report.peakHour}:00 最活跃`,`Most active at ${report.peakHour}:00`);
    const rankRows=report.songs.map((item,rank)=>{
      const cover=item.track?.thumbUrl||item.track?.coverUrl;
      const thumb=cover?`<img src="${cover}" class="track-thumb" loading="lazy" decoding="async">`:`<div class="track-thumb"><span>${escapeHtml((item.track?.title||item.entry.title||"?").trim().slice(0,1))}</span></div>`;
      return `<div class="top-row"><div class="top-rank">${rank+1}</div><div class="top-row-main">${thumb}<div class="top-info"><div class="t-title">${escapeHtml(item.track?.title||item.entry.title)}</div><div class="t-artist">${escapeHtml(item.track?.artist||item.entry.artist)}</div></div></div><div class="top-row-metrics"><div class="top-bar-wrap"><div class="top-bar-fill" style="width:${(item.seconds/Math.max(1,report.songs[0].seconds)*100).toFixed(0)}%"></div></div><div class="top-meta"><span>${fmtDuration(item.seconds)} · ${item.plays}${tr("次"," plays")}</span></div></div></div>`;
    }).join("");
    const dimCard=(label,rows)=>`<section class="data-card"><h3>${label}</h3>${periodBars(rows.map(([name,value])=>({label:"",name,value})))}</section>`;
    host.innerHTML=`<div class="annual-summary">${card(tr("年度听歌","Listening Time"),fmtDuration(report.total))}${card(tr("年度播放","Plays"),`${report.totalPlays}${tr("次","")}`)}${card(tr("活跃天数","Active Days"),`${report.activeDays}${tr("天","")}`)}${card(tr("年度之歌","Top Song"),topSongValue)}</div>`
      +`<section class="data-card wide"><h3>${tr("月度听歌时间","Monthly Listening")}</h3><div class="data-sub">${tr("条形为当月时长，悬停查看当月最爱艺人","Bars show monthly time; hover for the monthly top artist")}</div>${periodBars(report.monthly)}</section>`
      +`<section class="data-card wide"><h3>${tr("年度 Top 10","Yearly Top 10")}</h3>${rankRows}</section>`
      +`<div class="annual-dims">${dimCard(tr("最爱艺人","Favorite Artists"),report.artists)}${dimCard(tr("最爱专辑","Favorite Albums"),report.albums)}${dimCard(tr("最爱风格","Favorite Genres"),report.genres)}</div>`
      +`<section class="data-card wide"><div class="neural-insights"><div class="neural-insight">${tr(`单日最高 <strong>${escapeHtml(bestDayValue)}</strong>。`,`Peak day: <strong>${escapeHtml(bestDayValue)}</strong>.`)}${report.peakHour===null?"":tr(`你通常在 <strong>${report.peakHour}:00</strong> 进入听歌状态。`,`You usually settle in around <strong>${report.peakHour}:00</strong>.`)}</div></div></section>`;
  }
  function openAnnualReport(year){
    const store=loadHistoryStore(),win=annualReportWindow();
    const years=annualAvailableYears(store);
    if(win.open&&!years.includes(win.year))years.unshift(win.year);
    const target=years.includes(year)?year:(win.open?win.year:years[0]);
    if(target===undefined){showToast(tr("还没有听歌记录","No listening history yet"));return;}
    annualReportYear=target;
    renderAnnualTabs(years,target,win);
    renderAnnualBody(store,target);
    $("#annualReportModal").classList.add("show");
    setTimeout(()=>{try{scheduleScrollEdgeUpdate($("#annualReportBody"));}catch(error){}},260);
  }
  function closeAnnualReport(){$("#annualReportModal").classList.remove("show");}
  function maybeAutoOpenAnnualReport(){
    const win=annualReportWindow();
    if(!win.open||annualAutoOpenedFor===win.year)return;
    if(!$(".view[data-view=\"history\"]")?.classList.contains("active"))return;
    annualAutoOpenedFor=win.year;openAnnualReport(win.year);
  }
  function syncAnnualButton(){
    const button=$("#annualReportBtn");if(!button)return;
    const win=annualReportWindow();
    button.textContent=tr("年度报告","Annual Report");
    button.classList.toggle("fresh",win.open);
    button.title=win.open?tr(`${win.year} 年度报告已开放，1 月 14 日截止`,`${win.year} report is open until January 14`):tr("查看往年报告","Browse past yearly reports");
  }
  function buildAnnualReportHTML(report){
    const esc=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const style=`*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 500px at 50% -8%,#2a2417 0%,#141318 46%,#0e0d12 100%);color:#f2ecdf;font-family:system-ui,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;min-height:100vh}header.cover{max-width:880px;margin:0 auto;padding:64px 40px 10px;text-align:center}.kicker{letter-spacing:.42em;font-size:12px;color:#c9a45c;font-weight:600}.year{font-family:Georgia,"Songti SC","SimSun",serif;font-size:120px;line-height:1;margin:10px 0 4px;background:linear-gradient(180deg,#f6e7c4 20%,#d9ab55 62%,#9a7430 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.rule{width:120px;height:2px;margin:18px auto;background:linear-gradient(90deg,transparent,#c9a45c,transparent)}.gen{color:#8f8a7c;font-size:13px}.hero{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:880px;margin:26px auto 0;padding:0 40px}.hero .cell{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:20px 10px;text-align:center;box-shadow:0 18px 44px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08)}.hero .k{font-size:12px;letter-spacing:.2em;color:#a49d8b}.hero .v{font-family:Georgia,"Songti SC",serif;font-size:34px;margin-top:8px;color:#f6e7c4}main{max-width:880px;margin:0 auto;padding:26px 40px 10px}section.card{background:rgba(255,255,255,.038);border:1px solid rgba(255,255,255,.09);border-radius:20px;padding:26px 28px;margin:0 0 18px;box-shadow:0 18px 44px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.07)}h2{margin:0 0 4px;font-size:15px;letter-spacing:.28em;color:#c9a45c;font-weight:600}h2 small{display:block;letter-spacing:.06em;color:#6f6a5c;font-size:12px;margin-top:6px;font-weight:400}.topsong{display:flex;align-items:baseline;gap:18px;margin-top:14px}.topsong .no{font-family:Georgia,serif;font-size:54px;color:#c9a45c;line-height:1}.topsong .t{font-size:24px;font-weight:700}.topsong .a{color:#a49d8b;margin-top:4px}.topsong .m{margin-left:auto;text-align:right;color:#a49d8b;font-size:13px;white-space:nowrap}.row{display:grid;grid-template-columns:52px 1fr auto;gap:14px;align-items:center;padding:11px 2px;border-top:1px solid rgba(255,255,255,.07)}.row:first-of-type{border-top:0}.row .no{font-family:Georgia,serif;font-size:26px;color:#8f8a7c}.row:nth-of-type(1) .no,.row:nth-of-type(2) .no,.row:nth-of-type(3) .no{color:#e3bd72}.row .t{font-weight:600}.row .a{color:#8f8a7c;font-size:13px;margin-top:2px}.row .m{color:#a49d8b;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}.bar{display:grid;grid-template-columns:70px 1fr 96px;gap:12px;align-items:center;margin:9px 0;font-size:13px}.bar .track{height:8px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden}.bar .fill{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#8a6a2e,#e3bd72)}.bar .num{text-align:right;color:#a49d8b;font-variant-numeric:tabular-nums}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}h4{margin:2px 0 8px;font-size:13px;letter-spacing:.2em;color:#c9a45c}details{margin-top:14px}summary{cursor:pointer;color:#a49d8b;font-size:13px}svg.chart{display:block;width:100%;height:auto;margin-top:10px}.dot{fill:#e3bd72;stroke:#141318;stroke-width:2}.axis{fill:#8f8a7c;font-size:12px}.rhythm{margin-top:6px;color:#cfc8b4;font-size:14px;line-height:2}footer{max-width:880px;margin:0 auto;padding:14px 40px 56px;color:#6f6a5c;font-size:12px;text-align:center}@media(prefers-color-scheme:light){body{background:radial-gradient(1200px 500px at 50% -8%,#f7ecd4 0%,#f3efe6 46%,#ece7d9 100%);color:#2b2620}header .gen{color:#8a7a52}section.card,.hero .cell{background:rgba(255,255,255,.72);border-color:rgba(120,90,30,.16);box-shadow:0 14px 34px rgba(120,90,30,.12)}.hero .v,.topsong .t{color:#4a3a17}.kicker,h2,h4,.row:nth-of-type(1) .no,.row:nth-of-type(2) .no,.row:nth-of-type(3) .no,.topsong .no{color:#8a6a2e}.row{border-color:rgba(120,90,30,.14)}.row .a,.row .m,.bar .num,.topsong .m,.topsong .a,.rhythm{color:#6f6553}.bar .track{background:rgba(120,90,30,.14)}footer{color:#8a7a52}}`;
    const W=760,H=230,padX=10,padB=32,padT=18;
    const maxMonth=Math.max(1,...report.monthly.map(row=>row.value));
    const pts=report.monthly.map((row,i)=>({x:padX+i*(W-padX*2)/11,y:H-padB-(row.value/maxMonth)*(H-padT-padB),...row}));
    const linePath="M"+pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
    const areaPath=`${linePath} L${(W-padX).toFixed(1)},${H-padB} L${padX.toFixed(1)},${H-padB} Z`;
    const chart=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="annualGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3bd72" stop-opacity=".85"/><stop offset="1" stop-color="#e3bd72" stop-opacity=".04"/></linearGradient></defs><path d="${areaPath}" fill="url(#annualGold)"/><path d="${linePath}" fill="none" stroke="#e3bd72" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${pts.map(p=>`<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"><title>${esc(p.label)} · ${esc(p.name)} · ${esc(fmtDuration(p.value))}</title></circle><text class="axis" x="${p.x.toFixed(1)}" y="${H-10}" text-anchor="middle">${esc(p.label)}</text>`).join("")}</svg>`;
    const topRows=report.songs.map((item,rank)=>`<div class="row"><span class="no">${String(rank+1).padStart(2,"0")}</span><span><span class="t">${esc(item.track?.title||item.entry.title)}</span><div class="a">${esc(item.track?.artist||item.entry.artist)}</div></span><span class="m">${esc(fmtDuration(item.seconds))} · ${item.plays} 次</span></div>`).join("");
    const dim=(title,list)=>`<div><h4>${title}</h4>${list.map(([name,value])=>`<div class="bar" title="${esc(fmtDuration(value))}"><span></span><span>${esc(name)}</span><span class="num">${esc(fmtDuration(value))}</span></div>`).join("")||'<div class="a">—</div>'}</div>`;
    const top=report.topSong;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glass Player ${report.year} 年度报告</title><style>${style}</style></head><body>`
      +`<header class="cover"><div class="kicker">GLASS PLAYER · ANNUAL REPORT</div><div class="year">${report.year}</div><div class="rule"></div><div class="gen">本地生成 · ${esc(new Date().toLocaleDateString())}</div></header>`
      +`<div class="hero"><div class="cell"><div class="k">年度听歌</div><div class="v">${esc(fmtDuration(report.total))}</div></div><div class="cell"><div class="k">年度播放</div><div class="v">${report.totalPlays}</div></div><div class="cell"><div class="k">活跃天数</div><div class="v">${report.activeDays}</div></div></div>`
      +`<main><section class="card"><h2>年度之歌<small>TOP SONG OF THE YEAR</small></h2><div class="topsong"><span class="no">01</span><span><span class="t">${esc(top?.track?.title||top?.entry.title||"—")}</span><div class="a">${esc(top?.track?.artist||top?.entry.artist||"")}</div></span><span class="m">${top?esc(fmtDuration(top.seconds))+" · "+top.plays+" 次":""}</span></div></section>`
      +`<section class="card"><h2>月度曲线<small>MONTHLY LISTENING</small></h2>${chart}</section>`
      +`<section class="card"><h2>年度 TOP 10<small>YEARLY TOP SONGS</small></h2><details open><summary>展开 / 收起</summary>${topRows}</details></section>`
      +`<section class="card"><h2>最爱版图<small>FAVORITES</small></h2><div class="cols">${dim("艺人 ARTISTS",report.artists)}${dim("专辑 ALBUMS",report.albums)}${dim("风格 GENRES",report.genres)}</div><div class="rhythm">单日最高 ${esc(report.bestDay?`${report.bestDay.key} · ${fmtDuration(report.bestDay.value)}`:"—")}。${report.peakHour===null?"":`你通常在 ${report.peakHour}:00 进入听歌状态。`}</div></section></main>`
      +`<footer>由 Glass Player 在本地生成，未上传任何数据 · Generated locally, nothing uploaded.</footer></body></html>`;
  }
  function downloadAnnualReport(year){
    const store=loadHistoryStore(),report=buildAnnualReport(store,year);
    if(report.total<=0){showToast(tr("这一年还没有听歌记录","No listening history for this year"));return;}
    const blob=new Blob(["﻿",buildAnnualReportHTML(report)],{type:"text/html;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=`Glass Player Annual Report ${year}.html`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
    showToast(tr("年度报告已导出","Annual report exported"));
  }
  $("#annualReportBtn").addEventListener("click",()=>openAnnualReport());
  $("#annualCloseBtn").addEventListener("click",closeAnnualReport);
  $("#annualDownloadBtn").addEventListener("click",()=>{if(annualReportYear!==null&&annualReportYear!==undefined)downloadAnnualReport(annualReportYear);});
  $("#annualReportModal").addEventListener("click",event=>{if(event.target===$("#annualReportModal"))closeAnnualReport();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#annualReportModal")?.classList.contains("show"))closeAnnualReport();});
  $("#annualYearTabs").addEventListener("click",event=>{const button=event.target.closest("[data-annual-year]");if(button)openAnnualReport(Number(button.dataset.annualYear));});
  const historyRenderedSignatures=new Map();
  function renderHistory(){
    /* Metadata migration already runs after import and manual rescan. Repeating
       the full identity reconciliation on every tab click blocked first paint. */
    const store=loadHistoryStore(),mode=$("#historyModeSeg button.active")?.dataset.historyMode||"time";
    lastVisibleHistoryRefreshAt=Date.now();
    syncAnnualButton();
    $$(".history-pane").forEach(p=>p.classList.toggle("active",p.id===({time:"historyTimePane",favorites:"historyFavoritesPane",data:"historyDataPane"}[mode])));
    const activeRange=$("#rangeSeg button.active")?.dataset.r||"day";
    const signature=`${historyStoreRevision}|${uiLanguage}|${playlist.length}|${activeRange}`;
    if(historyRenderedSignatures.get(mode)===signature)return;
    historyRenderedSignatures.set(mode,signature);
    if(mode==="favorites"){renderRecentFavorites(store);return;}if(mode==="data"){renderListeningData(store);return;}
    const range=activeRange,dateRange=calendarHistoryRange(range),total=sumDailyRange(store.daily,dateRange);
    $("#statNumber").textContent=fmtDuration(total);
    $("#historyStatTopSong").textContent="—";
    if(total<=0){const compare=$("#historyCompare"),topList=$("#topList");compare.textContent=tr("当前无听歌数据","No listening data for this period");compare.className="history-compare flat";setBatchedScrollHTML(topList,`<div class="empty-state"><p>${tr("当前无听歌数据","No listening data for this period")}</p></div>`);return;}
    renderHistoryComparison(store,range,dateRange,total);renderHistoryRanking(store,dateRange);
  }
  let historyModeRenderFrame=0,historyIdleRender=0,historyFallbackTimer=0;
  function cancelScheduledHistoryRender(){
    if(historyModeRenderFrame){cancelAnimationFrame(historyModeRenderFrame);historyModeRenderFrame=0;}
    if(historyIdleRender&&"cancelIdleCallback" in window){cancelIdleCallback(historyIdleRender);historyIdleRender=0;}
    if(historyFallbackTimer){clearTimeout(historyFallbackTimer);historyFallbackTimer=0;}
  }
  function scheduleHistoryRender(){
    cancelScheduledHistoryRender();
    historyModeRenderFrame=requestAnimationFrame(()=>{
      historyModeRenderFrame=0;
      const run=()=>{historyIdleRender=0;historyFallbackTimer=0;renderHistory();requestAnimationFrame(refreshScrollEdgeFrames);};
      if("requestIdleCallback" in window)historyIdleRender=requestIdleCallback(run,{timeout:180});
      else historyFallbackTimer=setTimeout(run,24);
    });
  }
  function scheduleVisibleHistoryRefresh(){
    const historyView=$(".view[data-view=\"history\"]");
    if(!historyView?.classList.contains("active"))return;
    clearTimeout(visibleHistoryRefreshTimer);
    const delay=Math.max(250,30000-(Date.now()-lastVisibleHistoryRefreshAt));
    visibleHistoryRefreshTimer=setTimeout(()=>{
      visibleHistoryRefreshTimer=0;
      if($(".view[data-view=\"history\"]")?.classList.contains("active"))scheduleHistoryRender();
    },delay);
  }
  $("#historyModeSeg").addEventListener("click",e=>{
    const btn=e.target.closest("button");if(!btn)return;
    $$("#historyModeSeg button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
    const mode=btn.dataset.historyMode,targetId={time:"historyTimePane",favorites:"historyFavoritesPane",data:"historyDataPane"}[mode];
    requestAnimationFrame(()=>updateGlider($("#historyModeSeg"),true));
    const host=$("#historyModeSeg");
    transitionMotionSector(host,()=>$(".history-pane.active"),()=>{
      let target=null;
      $$(".history-pane").forEach(p=>{const active=p.id===targetId;p.classList.toggle("active",active);if(active)target=p;});
      /* Render while the old pane is already invisible, before the new pane
         begins its entry. A superseded rapid click leaves rendering to the
         final queued target instead of flashing intermediate statistics. */
      if($("#historyModeSeg button.active")?.dataset.historyMode===mode){
        cancelScheduledHistoryRender();renderHistory();
      }
      requestAnimationFrame(refreshScrollEdgeFrames);return target;
    },true);
  });
  document.addEventListener("pointerover",e=>{const target=e.target.closest?.("[data-chart-tip]");if(!target)return;const tip=$("#chartTooltip");tip.textContent=target.dataset.chartTip;tip.classList.add("show");});
  let chartTooltipFrame=0,chartTooltipPoint=null;
  document.addEventListener("pointermove",e=>{const tip=$("#chartTooltip");if(!tip.classList.contains("show"))return;chartTooltipPoint={x:e.clientX,y:e.clientY};if(chartTooltipFrame)return;chartTooltipFrame=requestAnimationFrame(()=>{chartTooltipFrame=0;if(!chartTooltipPoint||!tip.classList.contains("show"))return;tip.style.left=`${Math.min(innerWidth-tip.offsetWidth-12,chartTooltipPoint.x+14)}px`;tip.style.top=`${Math.min(innerHeight-tip.offsetHeight-12,chartTooltipPoint.y+14)}px`;});});
  document.addEventListener("pointerout",e=>{if(e.target.closest?.("[data-chart-tip]"))$("#chartTooltip").classList.remove("show");});

  /* ================= seek bar + track peak/format analysis ================= */
  let seekProgress = 0;
  function loadWaveformFor(t){
    drawWaveform();
    updateTrackInfoCard(t);
  }
  function drawWaveform(){
    if(!audio.duration){ $("#seek").value = 0; $("#seek").style.setProperty("--seek-pct","0%"); return; }
    const pct = seekProgress*100;
    $("#seek").value = Math.round(seekProgress*1000);
    $("#seek").style.setProperty("--seek-pct", pct+"%");
  }
  let seekBehaviorStart=null,seekEnvelopeActive=false;
  $("#seek").addEventListener("pointerdown",()=>{seekBehaviorStart=finiteNumber(audio.currentTime,0);settleBehaviorProgress();if(audioCtx&&isPlaying){seekEnvelopeActive=true;smoothAudioParam(masterGain.gain,0,.012);}});
  $("#seek").addEventListener("input", () => {
    if(!audio.duration) return;
    flushHistory();
    const ratio = $("#seek").value/1000;
    audio.currentTime = ratio * audio.duration;
    lastTimeMark = audio.currentTime;
    seekProgress = ratio;
    $("#seek").style.setProperty("--seek-pct", (ratio*100)+"%");
    resetBehaviorMediaClock();
  });
  $("#seek").addEventListener("change",()=>{if(seekBehaviorStart===null)return;const to=finiteNumber(audio.currentTime,0);recordBehaviorEvent("seek",playlist[currentIndex]||null,{from:seekBehaviorStart,to,duration:finiteNumber(audio.duration,0),delta:to-seekBehaviorStart});seekBehaviorStart=null;resetBehaviorMediaClock();if(seekEnvelopeActive&&audioCtx){seekEnvelopeActive=false;smoothAudioParam(masterGain.gain,parseFloat($("#vol").value)||0.7,.02);}});
