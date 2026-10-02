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
    if(days === Infinity) return Object.values(entry.daily).reduce((a,b)=>a+b,0)+(Number(entry.legacyUndatedSeconds)||0);
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
  function sumSongRange(entry,range){return range?sumDailyRange(entry?.daily,range):sumSongInRange(entry,Infinity);}
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
    const candidates=Object.entries(store.songs||{}).map(([historyKey,s])=>{const track=currentTrackForHistory(historyKey,s);return {...s,historyKey,track,title:track?.title||s.title,artist:track?.artist||s.artist,rangeSeconds:sumSongRange(s,range)};}).filter(s=>s.rangeSeconds>0).sort((a,b)=>b.rangeSeconds-a.rangeSeconds),ranked=candidates.slice(0,50);
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
   /* ============ annual report (7.5.0 Replay Atlas) ============
     History Service owns yearly aggregation; History View renders it.
     The report year rolls forward automatically: Dec 31 (year Y) through
     Jan 14 (year Y+1) opens year Y and presents it once per session.
     Completed years stay viewable and downloadable all year. Downloads are
      standalone interactive HTML (inline style, chapters and scroll motion;
      blob: covers are omitted by design). */
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
    const days=Object.entries(store.daily||{}).filter(([key,value])=>String(key).startsWith(`${year}-`)&&(Number(value)||0)>0);
    const weekdayTotals=Array.from({length:7},()=>0),seasonTotals=new Map([["winter",0],["spring",0],["summer",0],["autumn",0]]);
    const seasonForMonth=month=>month<2||month===11?"winter":month<5?"spring":month<8?"summer":"autumn";
    days.forEach(([key,value])=>{const date=new Date(`${key}T12:00:00`),month=date.getMonth();weekdayTotals[date.getDay()]+=Number(value)||0;seasonTotals.set(seasonForMonth(month),(seasonTotals.get(seasonForMonth(month))||0)+(Number(value)||0));});
    const monthly=Array.from({length:12},(_,month)=>{
      const seconds=sumDailyRange(store.daily,{start:new Date(year,month,1),end:new Date(year,month+1,1)});
      const [name]=artistTopForMonth(store,new Date(year,month,1));
      return {label:new Date(year,month,1).toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{month:"short"}),name:seconds>0?name:tr("—","—"),value:seconds};
    });
    const activeDays=days.length;
    let bestDay=null;
    Object.entries(store.daily||{}).forEach(([key,value])=>{if(String(key).startsWith(`${year}-`)&&(Number(value)||0)>0&&(!bestDay||Number(value)>bestDay.value))bestDay={key,value:Number(value)};});
    const hourTotals=Array.from({length:24},()=>0);
    Object.entries(store.hourly||{}).forEach(([day,hours])=>{if(!String(day).startsWith(`${year}-`))return;Object.entries(hours||{}).forEach(([hour,seconds])=>{const slot=Number(hour);if(slot>=0&&slot<24)hourTotals[slot]+=Number(seconds)||0;});});
    const peakHour=hourTotals.indexOf(Math.max(...hourTotals,0));
    const hourBands=Array.from({length:6},(_,band)=>({label:`${String(band*4).padStart(2,"0")}–${String(band*4+3).padStart(2,"0")}`,value:hourTotals.slice(band*4,band*4+4).reduce((sum,value)=>sum+value,0)}));
    const weekdayNames=Array.from({length:7},(_,day)=>new Date(2024,0,day+7).toLocaleDateString(uiLanguage==="zh"?"zh-CN":"en-US",{weekday:"long"}));
    const weekdays=weekdayNames.map((label,day)=>({label,value:weekdayTotals[day]}));
    const seasons=[...seasonTotals.entries()].map(([key,value])=>({key,label:tr({winter:"冬季",spring:"春季",summer:"夏季",autumn:"秋季"}[key],{winter:"Winter",spring:"Spring",summer:"Summer",autumn:"Autumn"}[key]),value}));
    const formatTotals=new Map(),losslessFormats=new Set(["FLAC","ALAC","WAV","AIFF"]);
    songs.forEach(item=>{const format=String(item.track?.format||item.entry.format||"").toUpperCase();if(format)formatTotals.set(format,(formatTotals.get(format)||0)+item.seconds);});
    const audioProfile={formats:[...formatTotals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5),losslessSeconds:[...formatTotals.entries()].filter(([format])=>losslessFormats.has(format)).reduce((sum,[,value])=>sum+value,0),sampleRateTracks:songs.filter(item=>Number(item.track?.sampleRate||item.entry.sampleRate)>=48000).length};
    const artistEvolution=monthly.map(row=>({label:row.label,name:row.name,value:row.value})).filter(row=>row.value>0&&row.name&&row.name!=="—");
    return {year,total,totalPlays,activeDays,bestDay,songs:songs.slice(0,12),topSong:songs[0]||null,topArtist:topRows(artists)[0]||null,topAlbum:topRows(albums)[0]||null,artists:topRows(artists),albums:topRows(albums),genres:topRows(genres),monthly,weekdays,seasons,hourBands,peakHour:hourTotals[peakHour]>0?peakHour:null,peakWeekday:weekdays.slice().sort((a,b)=>b.value-a.value)[0]||null,peakSeason:seasons.slice().sort((a,b)=>b.value-a.value)[0]||null,artistEvolution,audioProfile,uniqueSongs:songs.length};
  }
  let annualReportYear=null,annualAutoOpenedFor=0;
  function renderAnnualTabs(years,target,win){
    const host=$("#annualYearTabs");if(!host)return;
    host.innerHTML=years.map(year=>`<button type="button" class="${year===target?"active":""}" data-annual-year="${year}">${year}${win.open&&year===win.year?` · ${tr("新","New")}`:""}</button>`).join("");
  }
  function annualBarRows(rows,max=Math.max(1,...rows.map(row=>row.value))){return rows.map(row=>'<div class="annual-bar-row"><span>'+escapeHtml(row.label||row.name||row.key||'—')+'</span><i><b style="width:'+((row.value/max*100).toFixed(1))+'%"></b></i><em>'+fmtDuration(row.value)+'</em></div>').join('');}
  function attachAnnualReportMotion(host){
    host._annualMotionCleanup?.();
    host.classList.remove('is-ready');
    const sections=[...host.querySelectorAll('[data-annual-depth]')];
    const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)entry.target.classList.add('is-visible');}),{root:host,threshold:.12});
    sections.forEach(section=>reveal.observe(section));
    let frame=0;
    const sync=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const box=host.getBoundingClientRect();sections.forEach(section=>{const rect=section.getBoundingClientRect(),center=rect.top+rect.height/2,delta=(box.top+box.height/2-center)/Math.max(1,box.height);section.style.setProperty('--annual-shift',(Math.max(-1,Math.min(1,delta))*Number(section.dataset.annualDepth||0))+'em');});});};
    host.addEventListener('scroll',sync,{passive:true});
    addEventListener('resize',sync,{passive:true});
    host._annualMotionCleanup=()=>{reveal.disconnect();host.removeEventListener('scroll',sync);removeEventListener('resize',sync);if(frame)cancelAnimationFrame(frame);};
    requestAnimationFrame(()=>{host.classList.add('is-ready');sync();});
  }
  function renderAnnualBody(store,year){
    const host=$('#annualReportBody');if(!host)return;
    const report=buildAnnualReport(store,year);
    $('#annualReportTitle').textContent=tr(year+' 年度报告',year+' Annual Report');
    if(report.total<=0){host._annualMotionCleanup?.();host._annualMotionCleanup=null;setBatchedScrollHTML(host,'<div class="empty-state"><p>'+tr(year+' 年还没有听歌记录','No listening history for '+year)+'</p></div>');return;}
    const card=(label,value,detail)=>'<article class="annual-kpi"><span>'+label+'</span><strong>'+value+'</strong>'+(detail?'<small>'+detail+'</small>':'')+'</article>';
    const top=report.topSong,bestDayValue=report.bestDay?escapeHtml(report.bestDay.key)+' · '+fmtDuration(report.bestDay.value):'—';
    const peakValue=report.peakHour===null?tr('—','—'):tr(report.peakHour+':00 最活跃','Most active at '+report.peakHour+':00');
    const rankRows=report.songs.map((item,rank)=>{const cover=item.track?.thumbUrl||item.track?.coverUrl;const thumb=cover?'<img src="'+cover+'" class="track-thumb" loading="lazy" decoding="async">':'<div class="track-thumb"><span>'+escapeHtml((item.track?.title||item.entry.title||'?').trim().slice(0,1))+'</span></div>';return '<div class="top-row"><div class="top-rank">'+(rank+1)+'</div><div class="top-row-main">'+thumb+'<div class="top-info"><div class="t-title">'+escapeHtml(item.track?.title||item.entry.title)+'</div><div class="t-artist">'+escapeHtml(item.track?.artist||item.entry.artist)+'</div></div></div><div class="top-row-metrics"><div class="top-bar-wrap"><div class="top-bar-fill" style="width:'+((item.seconds/Math.max(1,report.songs[0].seconds)*100).toFixed(0))+'%"></div></div><div class="top-meta"><span>'+fmtDuration(item.seconds)+' · '+item.plays+tr('次',' plays')+'</span></div></div></div>';}).join('');
    const topSongTitle=top?escapeHtml(top.track?.title||top.entry.title):'—',topArtist=report.topArtist?escapeHtml(report.topArtist[0]):'—',topAlbum=report.topAlbum?escapeHtml(report.topAlbum[0]):'—';
    const audioLabel=report.audioProfile.losslessSeconds>0?tr('包含无损播放','Includes lossless listening'):tr('未记录无损格式','No lossless format recorded');
    let html='<div class="annual-report-story">';
    html+='<section class="annual-chapter annual-hero-chapter" data-annual-depth=".12"><div class="annual-kicker">GLASS PLAYER · '+tr('年度回顾','YEAR IN SOUND')+'</div><div class="annual-year">'+year+'</div><p>'+tr('这一年，你把时间交给了声音。','A year of your time, translated into sound.')+'</p><div class="annual-kpis">'+card(tr('听歌时间','Listening time'),fmtDuration(report.total),report.activeDays+tr('个活跃日',' active days'))+card(tr('播放次数','Plays'),report.totalPlays,report.uniqueSongs+tr('首独立歌曲',' unique songs'))+card(tr('年度之歌','Song of the year'),topSongTitle,top?fmtDuration(top.seconds):'—')+card(tr('年度艺人','Artist of the year'),topArtist)+card(tr('年度专辑','Album of the year'),topAlbum)+'</div></section>';
    html+='<section class="annual-chapter annual-feature-chapter" data-annual-depth="-.08"><div class="annual-chapter-index">01</div><div><h4>'+tr('年度之歌','THE SONG THAT STAYED')+'</h4><h2>'+topSongTitle+'</h2><p>'+(top?(escapeHtml(top.track?.artist||top.entry.artist||'')+' · '+fmtDuration(top.seconds)+' · '+top.plays+tr('次',' plays')):'—')+'</p></div><div class="annual-feature-number">01</div></section>';
    html+='<section class="annual-chapter" data-annual-depth=".05"><div class="annual-section-heading"><div><span>'+tr('节奏','RHYTHM')+'</span><h3>'+tr('你的听歌节拍','Your listening rhythm')+'</h3></div><p>'+tr('从日期、时段和季节，看见这一年的习惯。','A year of habits, seen through days, hours and seasons.')+'</p></div><div class="annual-rhythm-grid"><div><h5>'+tr('最活跃星期','Most active weekday')+'</h5><strong>'+escapeHtml(report.peakWeekday?.label||'—')+'</strong>'+annualBarRows(report.weekdays)+'</div><div><h5>'+tr('最常出现的时段','Most active hours')+'</h5><strong>'+peakValue+'</strong>'+annualBarRows(report.hourBands)+'</div><div><h5>'+tr('季节偏好','Seasonal listening')+'</h5><strong>'+escapeHtml(report.peakSeason?.label||'—')+'</strong>'+annualBarRows(report.seasons)+'</div></div></section>';
    html+='<section class="annual-chapter" data-annual-depth="-.06"><div class="annual-section-heading"><div><span>'+tr('时间线','TIMELINE')+'</span><h3>'+tr('十二个月的起伏','Twelve months in motion')+'</h3></div></div><div class="annual-month-grid">'+annualBarRows(report.monthly)+'</div><div class="annual-evolution">'+report.artistEvolution.map(row=>'<span>'+escapeHtml(row.label)+'<b>'+escapeHtml(row.name)+'</b></span>').join('')+'</div></section>';
    html+='<section class="annual-chapter annual-ranking-chapter" data-annual-depth=".1"><div class="annual-section-heading"><div><span>'+tr('排行榜','RANKINGS')+'</span><h3>'+tr('重复播放的那些歌','The songs you returned to')+'</h3></div><p>'+tr('按年度听歌时长排序，显示最多 12 首。','Ranked by listening time, up to 12 songs.')+'</p></div><div class="annual-ranking-list">'+rankRows+'</div></section>';
    const dims=[[tr('最爱艺人','Favorite artists'),report.artists],[tr('最爱专辑','Favorite albums'),report.albums],[tr('最爱风格','Favorite genres'),report.genres]];
    html+='<section class="annual-chapter" data-annual-depth="-.05"><div class="annual-section-heading"><div><span>'+tr('偏好版图','YOUR MAP')+'</span><h3>'+tr('艺人、专辑与风格','Artists, albums and genres')+'</h3></div></div><div class="annual-dims">'+dims.map(pair=>'<div class="annual-dim"><h5>'+pair[0]+'</h5>'+annualBarRows(pair[1].map(row=>({name:row[0],value:row[1]})))+'</div>').join('')+'</div></section>';
    html+='<section class="annual-chapter" data-annual-depth=".07"><div class="annual-section-heading"><div><span>'+tr('音质档案','AUDIO PROFILE')+'</span><h3>'+tr('你听到的声音','The sound you chose')+'</h3></div></div><div class="annual-audio-grid"><div><strong>'+audioLabel+'</strong><span>'+fmtDuration(report.audioProfile.losslessSeconds)+' '+tr('无损时长','lossless time')+'</span></div><div><strong>'+tr('高采样率曲目','High sample-rate tracks')+'</strong><span>'+report.audioProfile.sampleRateTracks+'</span></div><div><strong>'+tr('记录到的格式','Formats recorded')+'</strong><span>'+(report.audioProfile.formats.map(row=>escapeHtml(row[0])).join(' · ')||'—')+'</span></div></div></section>';
    html+='<section class="annual-chapter annual-closing-chapter" data-annual-depth="-.1"><div class="annual-closing-number">'+fmtDuration(report.total)+'</div><h3>'+tr('这一年，感谢你一直在听。','Thanks for listening all year.')+'</h3><p>'+tr('单日最高是 '+bestDayValue+'。所有统计均在本地生成。','Your peak day was '+bestDayValue+'. Every statistic was generated locally.')+'</p><small>'+tr('歌曲文件不会离开设备；本报告只读取现有听歌历史。','Audio files never leave this device; this report reads only existing listening history.')+'</small></section></div>';
    host.innerHTML=html;
    attachAnnualReportMotion(host);
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
    const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmt=seconds=>{const total=Math.round(seconds||0),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60);return hours?hours+'h '+minutes+'m':minutes?minutes+' min':total+' sec';};
    const barRows=rows=>rows.map(row=>'<div class="bar-row"><span>'+esc(row.label||row.name||row.key||'-')+'</span><i><b style="width:'+((row.value/Math.max(1,...rows.map(item=>item.value))*100).toFixed(1))+'%"></b></i><em>'+fmt(row.value)+'</em></div>').join('');
    const top=report.topSong,topTitle=top?.track?.title||top?.entry.title||'-',topArtist=report.topArtist?.[0]||'-',topAlbum=report.topAlbum?.[0]||'-';
    const rows=report.songs.map((item,index)=>'<div class="rank"><strong>'+String(index+1).padStart(2,'0')+'</strong><span><b>'+esc(item.track?.title||item.entry.title)+'</b><small>'+esc(item.track?.artist||item.entry.artist||'')+'</small></span><em>'+fmt(item.seconds)+' · '+item.plays+' plays</em></div>').join('');
    const dims=[['Artists',report.artists],['Albums',report.albums],['Genres',report.genres]].map(pair=>'<div class="dim"><h4>'+pair[0]+'</h4>'+barRows(pair[1].map(row=>({name:row[0],value:row[1]})))+'</div>').join('');
    const style='*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f0e9;color:#1a2630;font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body:before{content:"";position:fixed;inset:0;background:linear-gradient(120deg,#e8edf2 0%,transparent 40%),radial-gradient(70vw 60vh at 100% 0%,#f7d9c4 0,transparent 65%);pointer-events:none;z-index:-1}.progress{position:fixed;left:0;top:0;height:5px;width:100%;background:#17273318;z-index:4}.progress b{display:block;height:100%;width:0;background:#d65c3e;transform-origin:left}.cover{min-height:88vh;display:grid;place-items:center;text-align:left;padding:10vh 7vw;border-bottom:1px solid #1a263020}.cover-inner{width:min(980px,100%)}.kicker{letter-spacing:.22em;text-transform:uppercase;color:#d65c3e;font-size:12px;font-weight:800}.year{margin:20px 0 10px;font-size:clamp(86px,17vw,210px);line-height:.8;letter-spacing:-.1em;color:#172733}.cover p{max-width:620px;margin:28px 0;color:#53626d;font-size:clamp(18px,2.6vw,29px)}main{width:min(1100px,100%);margin:auto;padding:0 6vw 16vh}.chapter{min-height:72vh;display:flex;flex-direction:column;justify-content:center;padding:10vh 0;opacity:0;transform:translate3d(0,45px,0);transition:opacity .7s ease,transform .85s cubic-bezier(.2,.8,.2,1)}.chapter.visible{opacity:1;transform:translate3d(0,var(--shift,0px),0)}.panel{background:#fff;border:1px solid #17273324;border-radius:10px;padding:clamp(28px,5vw,72px);box-shadow:0 22px 50px #17273314}.hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;margin-top:34px;background:#17273324;border:1px solid #17273324}.metric{padding:22px;background:#fff}.metric span,.label{display:block;color:#687783;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:750}.metric b{display:block;margin-top:10px;color:#172733;font-size:clamp(20px,3vw,36px);overflow-wrap:anywhere}.feature{min-height:74vh}.feature .number{font-size:clamp(64px,12vw,140px);line-height:.8;color:#d65c3e22;align-self:flex-end}.eyebrow{color:#d65c3e;letter-spacing:.16em;font-size:12px;text-transform:uppercase;font-weight:800}.feature h2{max-width:13ch;margin:16px 0;font-size:clamp(38px,7vw,92px);line-height:.94;letter-spacing:-.06em;color:#172733}.feature p,.sub{color:#687783}.bars{display:grid;gap:10px}.bar-row{display:grid;grid-template-columns:minmax(90px,1fr) minmax(110px,3fr) 90px;gap:12px;align-items:center;font-size:13px}.bar-row i{height:8px;border-radius:2px;background:#17273314;overflow:hidden}.bar-row b{display:block;height:100%;border-radius:inherit;background:#4f7890}.bar-row em{font-style:normal;text-align:right;color:#687783;font-variant-numeric:tabular-nums}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.grid3>div{padding:22px 0;border-top:2px solid #d65c3e}.grid3 h3,.dim h4{margin:0 0 14px;color:#172733}.grid3 strong{display:block;font-size:24px;margin-bottom:16px}.timeline{display:grid;gap:14px}.evolution{display:flex;gap:8px;flex-wrap:wrap;margin-top:26px}.evolution span{padding:8px 11px;border:1px solid #1727332e;border-radius:2px;color:#53626d}.evolution b{color:#172733;margin-left:6px}.rankings{display:grid;gap:0}.rank{display:grid;grid-template-columns:48px 1fr auto;gap:16px;align-items:center;padding:18px 0;border-bottom:1px solid #17273320}.rank>strong{font-size:26px;color:#d65c3e}.rank b,.rank small{display:block}.rank small{color:#687783}.rank em{font-style:normal;color:#53626d;font-size:13px}.dims{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.dim{padding:22px 0;border-top:2px solid #4f7890}.audio{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#17273324;border:1px solid #17273324}.audio div{padding:24px;background:#fff}.audio b,.audio span{display:block}.audio span{margin-top:10px;color:#687783}.closing{text-align:center;min-height:72vh}.closing .big{font-size:clamp(44px,8vw,96px);line-height:1;color:#d65c3e;letter-spacing:-.06em}.privacy{color:#7b8991;font-size:13px}footer{padding:5vh 6vw 10vh;text-align:center;color:#7b8991;font-size:12px;border-top:1px solid #17273320}@media(max-width:700px){.grid3,.dims,.audio{grid-template-columns:1fr}.bar-row{grid-template-columns:80px 1fr 70px}.rank{grid-template-columns:38px 1fr}.rank em{grid-column:2;text-align:left}.cover{min-height:78vh;padding:8vh 7vw}}@media(prefers-reduced-motion:reduce){.chapter{transition:none;transform:none!important}.chapter.visible{transform:none!important}}';
     let html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glass Player Replay Atlas '+report.year+' Annual Report</title><style>'+style+'</style></head><body><div class="progress"><b></b></div><header class="cover chapter visible" data-depth=".04"><div class="cover-inner"><div class="kicker">Glass Player / Replay Atlas / Year in Sound</div><div class="year">'+report.year+'</div><p>A year of your time, translated into sound.</p><div class="hero-grid"><div class="metric"><span>Listening time</span><b>'+fmt(report.total)+'</b></div><div class="metric"><span>Plays</span><b>'+report.totalPlays+'</b></div><div class="metric"><span>Active days</span><b>'+report.activeDays+'</b></div><div class="metric"><span>Unique songs</span><b>'+report.uniqueSongs+'</b></div><div class="metric"><span>Top artist</span><b>'+esc(topArtist)+'</b></div><div class="metric"><span>Top album</span><b>'+esc(topAlbum)+'</b></div></div></div></header><main>';
    html+='<section class="chapter feature" data-depth="-.08"><div class="panel"><div class="eyebrow">01 / Song of the year</div><h2>'+esc(topTitle)+'</h2><p class="feature p">'+esc(top?.track?.artist||top?.entry.artist||'')+' · '+(top?fmt(top.seconds)+' · '+top.plays+' plays':'-')+'</p><div class="number">01</div></div></section>';
    html+='<section class="chapter" data-depth=".05"><div class="panel"><div class="eyebrow">02 / Your rhythm</div><h2>When sound found you</h2><div class="grid3"><div><h3>Weekday</h3><strong>'+esc(report.peakWeekday?.label||'-')+'</strong><div class="bars">'+barRows(report.weekdays)+'</div></div><div><h3>Hours</h3><strong>'+esc(report.peakHour===null?'-':report.peakHour+':00')+'</strong><div class="bars">'+barRows(report.hourBands)+'</div></div><div><h3>Season</h3><strong>'+esc(report.peakSeason?.label||'-')+'</strong><div class="bars">'+barRows(report.seasons)+'</div></div></div></div></section>';
    html+='<section class="chapter" data-depth="-.05"><div class="panel"><div class="eyebrow">03 / The year in motion</div><h2>Twelve months, one listening story</h2><div class="timeline">'+barRows(report.monthly)+'</div><div class="evolution">'+report.artistEvolution.map(row=>'<span>'+esc(row.label)+' <b>'+esc(row.name)+'</b></span>').join('')+'</div></div></section>';
    html+='<section class="chapter" data-depth=".08"><div class="panel"><div class="eyebrow">04 / Replay list</div><h2>The songs you returned to</h2><p class="sub">Ranked by listening time, up to 12 songs.</p><div class="rankings">'+rows+'</div></div></section>';
    html+='<section class="chapter" data-depth="-.06"><div class="panel"><div class="eyebrow">05 / Your map</div><h2>Artists, albums and genres</h2><div class="dims">'+dims+'</div></div></section>';
    html+='<section class="chapter" data-depth=".05"><div class="panel"><div class="eyebrow">06 / Audio profile</div><h2>The sound you chose</h2><div class="audio"><div><b>Lossless listening</b><span>'+fmt(report.audioProfile.losslessSeconds)+'</span></div><div><b>High sample-rate tracks</b><span>'+report.audioProfile.sampleRateTracks+'</span></div><div><b>Formats recorded</b><span>'+esc(report.audioProfile.formats.map(row=>row[0]).join(' · ')||'-')+'</span></div></div></div></section>';
     html+='<section class="chapter closing" data-depth="-.1"><div class="panel"><div class="big">'+fmt(report.total)+'</div><h2>Thanks for listening all year.</h2><p class="sub">Your peak day was '+esc(report.bestDay?.key||'-')+'. Every statistic was generated locally.</p><p class="privacy">Audio files never leave this device; this report reads existing listening history only.</p></div></section></main><footer>Generated locally by Glass Player Replay Atlas · '+report.year+'</footer><script>(function(){var sections=[].slice.call(document.querySelectorAll(".chapter[data-depth]")),bar=document.querySelector(".progress b"),frame=0;function sync(){if(frame)return;frame=requestAnimationFrame(function(){frame=0;var h=document.documentElement.scrollHeight-innerHeight,scroll=scrollY;bar.style.width=(h?scroll/h*100:0)+"%";sections.forEach(function(s){var r=s.getBoundingClientRect(),p=(innerHeight/2-(r.top+r.height/2))/innerHeight;s.style.setProperty("--shift",(Math.max(-1,Math.min(1,p))*Number(s.dataset.depth||0)*100)+"px");});});}var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add("visible");});},{threshold:.14});sections.forEach(function(s){io.observe(s);});addEventListener("scroll",sync,{passive:true});addEventListener("resize",sync);sync();})();</script></body></html>';
    return html;
  }
  function downloadAnnualReport(year){
    const store=loadHistoryStore(),report=buildAnnualReport(store,year);
    if(report.total<=0){showToast(tr("这一年还没有听歌记录","No listening history for this year"));return;}
    const blob=new Blob(["﻿",buildAnnualReportHTML(report)],{type:"text/html;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
     link.href=url;link.download=`Glass Player Replay Atlas Annual Report ${year}.html`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
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
