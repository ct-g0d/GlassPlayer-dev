  GP.i18n = (() => {
  const UI_EN={
    "播放器":"Player","歌单":"Library","歌曲库":"Library","听歌历史":"Listening History","设置":"Settings","更新日志":"Changelog",
    "播放队列":"Queue","音效":"Sound","每日推荐":"Daily Mix","清空":"Clear","接下来播放":"Up Next",
    "添加文件":"Add Files","添加文件夹":"Add Folder","搜索歌曲或歌手":"Search songs or artists","筛选":"Filter","全部歌曲":"All songs","已播放":"Played","未播放":"Unplayed","视图":"View","切换列表和网格视图":"Switch between list and grid views","列表 / Grid":"List / Grid","未标注专辑":"No Album","序号":"No.","封面 + 歌名/歌手":"Artwork + Song/Artist","专辑":"Album","操作":"Actions",
    "排序：原始顺序":"Sort: Original","原始顺序":"Original order","歌手 A–Z":"Artist A–Z","歌名 A–Z":"Title A–Z",
    "今天":"Today","本周":"This Week","本月":"This Month","本年":"This Year","全部":"All","听歌时间":"Listening Time","最近最爱":"Recent Favorites","听歌数据":"Listening Data","播放次数":"Plays","最常听歌曲":"Most Played Song","最爱艺人":"Favorite Artist","昨日对比":"Compared with Yesterday","听歌时长排行 Top 10":"Top 10 Listening Time","Top 3":"Top 3","较大封面与听歌数据":"Larger covers with listening data","第 4–10 名列表":"Ranks 4–10","歌曲":"Song","时长 / 播放次数":"Duration / Plays","暂无更多歌曲":"No more songs in this range",
    "听歌时长排行 Top 50":"Top 50 Listening Time","选定时间段内的听歌时长":"Listening time in selected range",
    "外观":"Appearance","界面语言":"Interface Language","外观模式":"Appearance Mode","浅色":"Light","深色":"Dark","系统时间":"System Time","音频":"Audio","音乐库":"Music Library","数据":"Data","高级":"Advanced","关于":"About","设置分类":"Settings Categories","音效面板":"Sound panel","本地数据":"Local Data","本地保存":"Saved locally","音效与空间音频":"Sound and Spatial Audio",
    "主题色":"Accent Color","背景效果":"Background Effect","灵动光晕":"Ambient Glow","封面取色":"Cover Color","封面虚化":"Blurred Cover",
    "播放行为":"Playback","专辑封面显示方式":"Album Art Display","随唱片旋转":"Rotate with Disc","静态展示":"Static Cover",
    "交叉淡入淡出":"Crossfade","时长":"Duration",
    "文字":"Typography","字体":"Font","字体大小":"Font Size","字体粗细":"Font Weight","细":"Light","粗":"Bold",
    "均衡器 EQ":"Equalizer","预设":"Presets","手动调节":"Manual Control","原始":"Flat","低音增强":"Bass Boost","人声增强":"Vocal Boost","高音明亮":"Bright Treble","自定义":"Manual",
    "显示器音响":"Monitor Speakers","显示器音响靠墙补偿：削减低频和低中频闷感，补回人声清晰度与空气感":"Wall-proximity compensation for monitor speakers: reduces bass and low-mid muddiness while restoring vocal clarity and air.",
    "暂停":"Pause","关闭":"Off","播完暂停":"Stop After Song","播放速度":"Speed","未选择歌曲":"No Song Selected","拖入或导入音乐开始播放":"Drop or import music to begin",
    "歌单顺序":"Library Order","手动播放列表":"Manual Queue","从播放队列移除":"Remove from queue","拖拽排序":"Drag to reorder",
    "下一首播放":"Play Next","加入播放队列":"Add to Queue","从歌单移除":"Remove from Library","生成推荐歌单":"Generate Mix","播放推荐":"Play Mix","播放推荐歌单":"Play Daily Mix",
    "0 分钟":"0 minutes","0 首等待":"0 queued","0 首歌":"0 songs","15 分钟后":"After 15 minutes","30 分钟后":"After 30 minutes","45 分钟后":"After 45 minutes","60 分钟后":"After 60 minutes",
    "Aa 你好，世界 Glass Player 123":"Aa Hello, World — Glass Player 123","New York（衬线）":"New York (Serif)","Apple 系统字体":"Apple System Font","Microsoft 系统字体":"Microsoft System Font","中文":"Chinese",
    "UI 主题色跟随当前歌曲封面":"Match UI accent to current cover","按你的跳过/听完习惯 + 语言/风格自动调权重":"Weighted by skips, completions, language and genre",
    "比特率":"Bitrate","播放":"Play","播客":"Podcast","播完这首后暂停":"Stop after this song","取消定时":"Cancel Timer","采样率":"Sample Rate","声道":"Channels","格式":"Format","文件信息":"File Information","响度":"Loudness","风格":"Genre","能量":"Energy","分析中…":"Analyzing…","未检测到":"Not detected",
    "电子":"Electronic","古典":"Classical","歌曲名称 A–Z":"Song Title A–Z","歌手名称 A–Z":"Artist Name A–Z","顺序播放":"Sequential",
    "界面配色":"Interface Color","开启后会自动识别当前浅色/深色模式，从封面提取主色并调整饱和度与明度，确保按钮和文字始终清晰可读，不会出现看不清的配色。":"Extracts a readable accent from the current cover and adapts it for light or dark mode.",
    "灵动光晕：使用主题色的流动光斑；封面取色：从当前歌曲封面提取主色作为背景色块；封面虚化：将封面放大模糊铺满背景，类似 Apple Music 动态背景。":"Ambient Glow uses animated accent blobs; Cover Color extracts a dominant color; Blurred Cover fills the background with a softened album image.",
    "可变字体会获得最平滑的粗细变化；普通字体会自动匹配最接近的字重。":"Variable fonts provide the smoothest weight changes; standard fonts use the closest available weight.",
    "还没有音乐":"No music yet","点击上方按钮导入，或直接把歌曲/文件夹拖进窗口":"Import above, or drop songs and folders into the window","封面会自动从 MP3/FLAC/M4A 中识别":"Artwork is read automatically from MP3, FLAC and M4A files",
    "歌曲文件不会保存到磁盘外，刷新页面需要重新导入；听歌记录会保留。":"Audio files never leave your device. Reimport after refresh; listening history is retained.",
    "松开鼠标以添加音乐":"Release to add music","睡眠定时":"Snooze","选择字体":"Choose Font","听歌记录":"Listening History","当前版本 7.6.3 — HOTFIX BUILD":"Current Version 7.6.3 — HOTFIX BUILD","版本 7.6.3 — HOTFIX BUILD":"Ver. 7.6.3 — HOTFIX BUILD","当前版本 7.6.2 — REBRAND UPDATE":"Current Version 7.6.2 — REBRAND UPDATE","版本 7.6.2 — REBRAND UPDATE":"Ver. 7.6.2 — REBRAND UPDATE","当前版本 7.5.0 — Replay Atlas":"Current Version 7.5.0 — Replay Atlas","版本 7.5.0 — Replay Atlas":"Ver. 7.5.0 — Replay Atlas","REPLAY ATLAS":"REPLAY ATLAS","HOTFIX BUILD":"HOTFIX BUILD","KINETIC GLASS":"KINETIC GLASS","REBRAND UPDATE":"REBRAND UPDATE","导出日志":"Export Log","打开悬浮播放器":"Open Floating Player","返回设置":"Back to Settings","清除搜索":"Clear Search","收起侧边栏":"Collapse Sidebar","展开侧边栏":"Expand Sidebar","未找到完全匹配，以下为粗略匹配":"No exact match. Approximate matches are shown below.","未找到匹配结果":"No matching results",
    "音乐库数据":"Library Data","重新扫描歌曲库":"Rescan Music Library","重新读取当前导入歌曲的 Genre、文件名信息、时长与封面；保留 Spectrum ID、MFCC、Energy、BPM 和收听历史。":"Reread Genre, filename metadata, duration and artwork from imported songs while preserving Spectrum ID, MFCC, Energy, BPM and listening history.",
    "重新扫描歌曲库？":"Rescan Music Library?","将从当前导入的音频文件重新读取 Genre、文件名信息、时长和封面，并覆盖缓存中的旧 metadata。Spectrum ID、MFCC、Energy、BPM 与收听历史不会改变。":"The current audio files will be reread for Genre, filename metadata, duration and artwork, replacing stale cached metadata. Spectrum ID, MFCC, Energy, BPM and listening history will remain unchanged.","取消":"Cancel","开始扫描":"Start Scan",
    "精选字体":"Curated Fonts","未知艺人":"Unknown Artist","未知":"Unknown","计算中…":"Calculating…","解码中…":"Decoding…","单声道":"Mono","立体声":"Stereo","版本列表":"Version List",
    "Poly Sync 40 补偿：补低频并压低人声凸起的中频":"Poly Sync 40 compensation: restore bass and reduce forward vocal mids",
    "Bose QC35 补偿：收低频、补中高频空气感":"Bose QC35 compensation: reduce bass and add upper-mid/high air",
    "Bose QC Earbuds 2024 补偿：收窄 150-400Hz 并提亮高频":"Bose QC Earbuds 2024 compensation: tighten 150–400 Hz and brighten treble"
  };
  Object.assign(UI_EN,{
    "选择 Glass Player 的界面语言。":"Choose the Glass Player interface language.","在浅色、深色或根据日出日落自动切换。":"Switch between Light, Dark or follow sunrise and sunset.","选择界面使用的 Accent 颜色。":"Choose the Accent color used by the interface.","灵动光晕、封面取色或封面虚化。":"Ambient Glow, Cover Color or Blurred Cover.","让 UI 主题色跟随当前歌曲封面，并自动保持文字对比度。":"Match the UI accent to the current cover while preserving text contrast.","选择唱片旋转或静态封面展示。":"Choose a rotating disc or a static cover.","在相邻歌曲之间平滑过渡。":"Transition smoothly between adjacent songs.","均衡器、设备预设、空间音频和响度均衡仍由播放器右侧的“音效”面板统一控制，避免建立第二套音频状态。":"Equalizer, device presets, Spatial Audio and loudness balance remain in the Player Sound panel so there is one audio state.","本地数据":"Local Data","播放历史、偏好和音频分析缓存保存在当前设备的本地存储中；本次版本不改变数据结构。":"Listening history, preferences and audio-analysis caches stay in local storage; this release does not change the data schema.","本地保存":"Saved locally","Apple 字体会按 SF Pro Display、SF Pro Text、PingFang 和 SF Mono 的角色分配显示。":"Apple typography assigns SF Pro Display, SF Pro Text, PingFang and SF Mono by text role.","调整界面字体的大小。":"Adjust the interface font size.","在可读性和信息密度之间调整。":"Balance readability and information density.","音效与空间音频":"Sound and Spatial Audio","音效面板":"Sound panel",
    "空间音效":"Spatial Audio","空间音效开关":"Spatial Audio toggle","了解空间音效":"About Spatial Audio","声音":"Sound","设备":"Devices",
    "自动响度均衡":"Automatic loudness balance","了解响度均衡":"About Loudness Balance",
    "桌面音响":"Desktop Speakers","监听音箱":"Studio Monitors","宽阔舞台":"Wide Stage",
    "环绕音":"Orbit","前置双耳":"Front Binaural","现场大厅":"Live Hall","影院":"Cinema","梦境":"Dreamscape"
  });
  Object.assign(UI_EN,{"无法打开悬浮播放器":"Unable to open Floating Player","当前浏览器或页面环境暂不支持传统视频画中画。":"The current browser or page environment does not support traditional video Picture-in-Picture.","知道了":"Got it"});
  Object.assign(UI_EN,{"常规":"Regular","中等":"Medium","半粗":"Semibold","特粗":"Heavy","运行身份":"Runtime identity","架构":"Architecture","引擎":"Engines","数据安全":"Cache safety","本地单一运行时；设置不新增状态，音频分析与听歌历史继续使用现有缓存边界。":"One local runtime; Settings adds no state, and audio analysis and listening history keep their existing cache boundaries.","默认音乐文件夹":"Default Music Folder","选择文件夹":"Choose Folder","选择后仅在本次导入；打开 HTML 时不会自动导入。":"Importing happens only when you choose a folder; opening the HTML file no longer imports it automatically.","已保存默认文件夹；本次已完成导入。":"Default folder saved; its music was imported this time.","默认文件夹已选择；本次找到 {count} 个音频文件。":"Default folder selected; found {count} audio files this time.","默认文件夹中没有找到音频文件。":"No audio files were found in the default folder.","当前浏览器不支持自动记住文件夹；请每次使用添加文件夹。":"This browser cannot remember folders automatically; use Add Folder each time."});
  
  


  Object.assign(UI_EN,{"版本 7.8.0":"Ver. 7.8.0","当前版本 7.8.0 — ENCORE UPDATE":"Current Version 7.8.0 — ENCORE UPDATE","版本 7.8.0 — ENCORE UPDATE":"Ver. 7.8.0 — ENCORE UPDATE","ENCORE UPDATE":"ENCORE UPDATE","FINAL PRESSING":"FINAL PRESSING"});
  Object.assign(UI_EN,{"版本 7.7.0":"Ver. 7.7.0","当前版本 7.7.0 — LOCALIZATION UPDATE":"Current Version 7.7.0 — LOCALIZATION UPDATE","版本 7.7.0 — LOCALIZATION UPDATE":"Ver. 7.7.0 — LOCALIZATION UPDATE","LOCALIZATION UPDATE":"LOCALIZATION UPDATE"});
  Object.assign(UI_EN,{"导出与导入":"Export and Import","约每小时保存一次":"Saves about hourly","磁盘数据库":"Disk Database","约每小时保存一次到 data/db，只写入有变化的内容。":"Saved to data/db about once an hour, writing only what changed.","导出数据":"Export Data","把听歌历史、偏好、分析缓存和封面保存为一个文件。":"Save your listening history, preferences, analysis cache and covers as one file.","导出":"Export","导入数据":"Import Data","从导出的文件恢复。只会添加和更新，不会删除现有记录；偏好会被文件中的设置替换。":"Restore from an exported file. It only adds and updates, never deletes records. Preferences are replaced by the ones in the file.","导入":"Import"});
  Object.assign(UI_EN,{"无损":"Lossless","播放全部":"Play All","新建歌单":"New Playlist","新建歌单…":"New Playlist…","新建歌单名称":"New playlist name","重命名":"Rename","删除歌单":"Delete playlist","未命名歌单":"Untitled Playlist","歌单：全部歌曲":"Playlists: All Songs","还没有自建歌单，先去歌单里新建一个吧":"No custom playlists yet — create one from Playlists","下载报告":"Download Report","高刷新率流动视觉":"Fluid 120Hz Motion","平滑连续播放":"Seamless Continuous Playback","按键播控":"Keyboard Controls","重置界面偏好":"Reset Interface Preferences","恢复默认":"Restore Defaults","已恢复默认设置":"Settings restored to defaults"});
  const i18nTextOriginal=new WeakMap();
  const i18nAttrOriginal=new WeakMap();
  function translatedValue(key){if(uiLanguage==="zh")return key;return UI_EN[key]||key;}
  function tr(zh,en){return uiLanguage==="zh"?zh:en;}
  function translateTree(root){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){return /\S/.test(node.nodeValue||"")&&!["SCRIPT","STYLE"].includes(node.parentElement?.tagName)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{if(!i18nTextOriginal.has(node))i18nTextOriginal.set(node,node.nodeValue);const original=i18nTextOriginal.get(node),key=original.trim(),replacement=translatedValue(key);if(uiLanguage!=="zh"&&replacement)node.nodeValue=original.replace(key,replacement);else node.nodeValue=original;});
    root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach(el=>{
      if(!i18nAttrOriginal.has(el))i18nAttrOriginal.set(el,{placeholder:el.getAttribute("placeholder"),title:el.getAttribute("title"),aria:el.getAttribute("aria-label")});
      const values=i18nAttrOriginal.get(el);[["placeholder",values.placeholder],["title",values.title],["aria-label",values.aria]].forEach(([attr,value])=>{if(value!==null)el.setAttribute(attr,uiLanguage==="zh"?value:translatedValue(value));});
    });
  }
  function applyLanguage(){
    document.documentElement.lang=uiLanguage==="en"?"en":"zh-CN";
    $$("#languageSeg button").forEach(button=>button.classList.toggle("active",button.dataset.lang===uiLanguage));
    if(typeof render==="function")render(searchInputSafe());
    if(typeof syncSortUI==="function")syncSortUI();
    if(typeof renderMiniQueue==="function")renderMiniQueue();
    GP.changelog?.render?.();
    if(typeof renderHistory==="function")renderHistory();
    if(typeof updateTrackInfoCard==="function"&&currentIndex>=0)updateTrackInfoCard(playlist[currentIndex]);
    GP.i18n.translateTree(document.body);
    if(typeof setEQPresetLabel==="function")setEQPresetLabel(eqPresetKey);
    if(typeof renderSpatialInfo==="function")renderSpatialInfo();
    if(typeof renderLoudnessInfo==="function")renderLoudnessInfo();
    if(typeof syncTraditionalPiP==="function")syncTraditionalPiP(true);
    if(currentIndex===-1){setNowPlayingTitle(tr("未选择歌曲","No Song Selected"));$("#nowArtist").textContent=tr("拖入或导入音乐开始播放","Drop or import music to begin");}
    if(typeof syncTypographyLanguage==="function")syncTypographyLanguage();
    if(typeof syncTypographyPreviewLayout==="function")syncTypographyPreviewLayout();
    if(typeof renderAboutRuntimeInfo==="function")renderAboutRuntimeInfo();
    if(typeof syncEQGeometry==="function")syncEQGeometry();
    if(typeof syncSpatialModeGeometry==="function")syncSpatialModeGeometry();
    if(typeof syncTitleLanguage==="function")syncTitleLanguage();
  }
    function getLanguage(){return uiLanguage;}
    function setLanguage(value){uiLanguage=value==="en"?"en":"zh";applyLanguage();}
    return Object.freeze({tr,translateTree,applyLanguage,getLanguage,setLanguage});
  })();
  const tr=(...args)=>GP.i18n.tr(...args);
  const applyLanguage=(...args)=>GP.i18n.applyLanguage(...args);
