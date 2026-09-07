  GP.i18n = (() => {
  const UI_EN={
    "播放器":"Player","歌单":"Library","歌曲库":"Library","听歌历史":"Listening History","设置":"Settings","更新日志":"Changelog",
    "播放队列":"Queue","音效":"Sound","每日推荐":"Daily Mix","清空":"Clear","接下来播放":"Up Next",
    "添加文件":"Add Files","添加文件夹":"Add Folder","搜索歌曲或歌手":"Search songs or artists","筛选":"Filter","全部歌曲":"All songs","已播放":"Played","未播放":"Unplayed","视图":"View","切换列表和网格视图":"Switch between list and grid views","列表 / Grid":"List / Grid","未标注专辑":"No Album","序号":"No.","封面 + 歌名/歌手":"Artwork + Song/Artist","专辑":"Album","操作":"Actions",
    "排序：原始顺序":"Sort: Original","原始顺序":"Original order","歌手 A–Z":"Artist A–Z","歌名 A–Z":"Title A–Z",
    "今天":"Today","本周":"This Week","本月":"This Month","本年":"This Year","全部":"All","听歌时间":"Listening Time","最近最爱":"Recent Favorites","听歌数据":"Listening Data","播放次数":"Plays","最常听歌曲":"Most Played Song","昨日对比":"Compared with Yesterday","听歌时长排行 Top 10":"Top 10 Listening Time","Top 3":"Top 3","较大封面与听歌数据":"Larger covers with listening data","第 4–10 名列表":"Ranks 4–10","歌曲":"Song","时长 / 播放次数":"Duration / Plays","暂无更多歌曲":"No more songs in this range",
    "听歌时长排行 Top 50":"Top 50 Listening Time","选定时间段内的听歌时长":"Listening time in selected range",
    "外观":"Appearance","界面语言":"Interface Language","外观模式":"Appearance Mode","浅色":"Light","深色":"Dark","自动":"Auto","音频":"Audio","音乐库":"Music Library","数据":"Data","高级":"Advanced","关于":"About","设置分类":"Settings Categories","音效面板":"Sound panel","本地数据":"Local Data","本地保存":"Saved locally","音效与空间音频":"Sound and Spatial Audio",
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
    "松开鼠标以添加音乐":"Release to add music","睡眠定时":"Snooze","选择字体":"Choose Font","听歌记录":"Listening History","音乐银河":"Music Galaxy","当前版本 7.3.0":"Current Version 7.3.0","版本 7.3.0":"Ver. 7.3.0","HOTFIX BUILD":"HOTFIX BUILD","导出日志":"Export Log","打开悬浮播放器":"Open Floating Player","返回设置":"Back to Settings","清除搜索":"Clear Search","收起侧边栏":"Collapse Sidebar","展开侧边栏":"Expand Sidebar","未找到完全匹配，以下为粗略匹配":"No exact match. Approximate matches are shown below.","未找到匹配结果":"No matching results",
    "音乐库数据":"Library Data","重新扫描歌曲库":"Rescan Music Library","重新读取当前导入歌曲的 Genre、文件名信息、时长与封面；保留 Spectrum ID、MFCC、Energy、BPM 和收听历史。":"Reread Genre, filename metadata, duration and artwork from imported songs while preserving Spectrum ID, MFCC, Energy, BPM and listening history.",
    "重新扫描歌曲库？":"Rescan Music Library?","将从当前导入的音频文件重新读取 Genre、文件名信息、时长和封面，并覆盖缓存中的旧 metadata。Spectrum ID、MFCC、Energy、BPM 与收听历史不会改变。":"The current audio files will be reread for Genre, filename metadata, duration and artwork, replacing stale cached metadata. Spectrum ID, MFCC, Energy, BPM and listening history will remain unchanged.","取消":"Cancel","开始扫描":"Start Scan",
    "精选字体":"Curated Fonts","未知艺人":"Unknown Artist","未知":"Unknown","计算中…":"Calculating…","解码中…":"Decoding…","单声道":"Mono","立体声":"Stereo","版本列表":"Version List",
    "Poly Sync 40 补偿：补低频并压低人声凸起的中频":"Poly Sync 40 compensation: restore bass and reduce forward vocal mids",
    "Bose QC35 补偿：收低频、补中高频空气感":"Bose QC35 compensation: reduce bass and add upper-mid/high air",
    "Bose QC Earbuds 2024 补偿：收窄 150-400Hz 并提亮高频":"Bose QC Earbuds 2024 compensation: tighten 150–400 Hz and brighten treble"
  };
  Object.assign(UI_EN,{
    "选择 Glass Player 的界面语言。":"Choose the Glass Player interface language.","在浅色、深色或根据时间自动切换。":"Switch between Light, Dark or an automatic schedule.","选择界面使用的 Accent 颜色。":"Choose the Accent color used by the interface.","灵动光晕、封面取色或封面虚化。":"Ambient Glow, Cover Color or Blurred Cover.","让 UI 主题色跟随当前歌曲封面，并自动保持文字对比度。":"Match the UI accent to the current cover while preserving text contrast.","选择唱片旋转或静态封面展示。":"Choose a rotating disc or a static cover.","在相邻歌曲之间平滑过渡。":"Transition smoothly between adjacent songs.","均衡器、设备预设、空间音频和响度均衡仍由播放器右侧的“音效”面板统一控制，避免建立第二套音频状态。":"Equalizer, device presets, Spatial Audio and loudness balance remain in the Player Sound panel so there is one audio state.","本地数据":"Local Data","播放历史、偏好和音频分析缓存保存在当前设备的本地存储中；本次版本不改变数据结构。":"Listening history, preferences and audio-analysis caches stay in local storage; this release does not change the data schema.","本地保存":"Saved locally","Apple 字体会按 SF Pro Display、SF Pro Text、PingFang 和 SF Mono 的角色分配显示。":"Apple typography assigns SF Pro Display, SF Pro Text, PingFang and SF Mono by text role.","调整界面字体的大小。":"Adjust the interface font size.","在可读性和信息密度之间调整。":"Balance readability and information density.","音效与空间音频":"Sound and Spatial Audio","音效面板":"Sound panel",
    "空间音效":"Spatial Audio","空间音效开关":"Spatial Audio toggle","了解空间音效":"About Spatial Audio","声音":"Sound","设备":"Devices",
    "自动响度均衡":"Automatic loudness balance","了解响度均衡":"About Loudness Balance",
    "桌面音响":"Desktop Speakers","监听音箱":"Studio Monitors","宽阔舞台":"Wide Stage",
    "环绕音":"Orbit","前置双耳":"Front Binaural","现场大厅":"Live Hall","影院":"Cinema","梦境":"Dreamscape"
  });
  Object.assign(UI_EN,{"无法打开悬浮播放器":"Unable to open Floating Player","当前浏览器或页面环境暂不支持传统视频画中画。":"The current browser or page environment does not support traditional video Picture-in-Picture.","知道了":"Got it"});
  const UI_RU={
    "播放器":"Плеер","歌单":"Медиатека","歌曲库":"Медиатека","听歌历史":"История прослушивания","设置":"Настройки","更新日志":"Журнал изменений",
    "播放队列":"Очередь","音效":"Звук","每日推荐":"Микс дня","清空":"Очистить","接下来播放":"Далее",
    "添加文件":"Добавить файлы","添加文件夹":"Добавить папку","搜索歌曲或歌手":"Поиск песен или исполнителей","筛选":"Фильтр","全部歌曲":"Все песни","已播放":"Прослушанные","未播放":"Непрослушанные","视图":"Вид","切换列表和网格视图":"Переключить список и сетку","列表 / Grid":"Список / сетка","未标注专辑":"Без альбома","序号":"№","封面 + 歌名/歌手":"Обложка + песня/исполнитель","专辑":"Альбом","操作":"Действия",
    "排序：原始顺序":"Сортировка: исходный порядок","原始顺序":"Исходный порядок","歌手 A–Z":"Исполнитель А–Я","歌名 A–Z":"Название А–Я",
    "今天":"Сегодня","本周":"Эта неделя","本月":"Этот месяц","本年":"Этот год","全部":"Все","听歌时间":"Время прослушивания","最近最爱":"Недавние любимые","听歌数据":"Данные прослушивания","播放次数":"Прослушивания","最常听歌曲":"Самая прослушиваемая песня","昨日对比":"Сравнение со вчера","听歌时长排行 Top 10":"Топ-10 по времени прослушивания","Top 3":"Топ-3","较大封面与听歌数据":"Крупные обложки и данные прослушивания","第 4–10 名列表":"Места 4–10","歌曲":"Песня","时长 / 播放次数":"Длительность / прослушивания","暂无更多歌曲":"Больше песен нет",
    "听歌时长排行 Top 50":"Топ-50 по времени прослушивания","选定时间段内的听歌时长":"Время прослушивания за выбранный период",
    "外观":"Внешний вид","界面语言":"Язык интерфейса","外观模式":"Режим оформления","浅色":"Светлая","深色":"Тёмная","自动":"Авто","音频":"Аудио","音乐库":"Медиатека","数据":"Данные","高级":"Дополнительно","关于":"О программе","设置分类":"Разделы настроек","音效面板":"Панель звука","本地数据":"Локальные данные","本地保存":"Сохранено локально","音效与空间音频":"Звук и пространственное аудио",
    "主题色":"Цвет акцента","背景效果":"Эффект фона","灵动光晕":"Динамическое свечение","封面取色":"Цвет обложки","封面虚化":"Размытая обложка",
    "播放行为":"Воспроизведение","专辑封面显示方式":"Отображение обложки","随唱片旋转":"Вращать с диском","静态展示":"Статичная обложка","交叉淡入淡出":"Плавное сведение","时长":"Длительность",
    "文字":"Типографика","字体":"Шрифт","字体大小":"Размер шрифта","字体粗细":"Насыщенность шрифта","细":"Светлый","粗":"Жирный",
    "均衡器 EQ":"Эквалайзер","预设":"Пресеты","手动调节":"Ручная настройка","原始":"Плоский","低音增强":"Усиление басов","人声增强":"Вокал","高音明亮":"Яркие высокие","自定义":"Вручную",
    "暂停":"Пауза","关闭":"Выкл.","播完暂停":"Остановить после песни","播放速度":"Скорость","未选择歌曲":"Песня не выбрана","拖入或导入音乐开始播放":"Перетащите или импортируйте музыку",
    "歌单顺序":"Порядок медиатеки","手动播放列表":"Ручная очередь","从播放队列移除":"Удалить из очереди","拖拽排序":"Перетащите для сортировки","下一首播放":"Воспроизвести следующей","加入播放队列":"Добавить в очередь","从歌单移除":"Удалить из медиатеки","生成推荐歌单":"Создать микс","播放推荐":"Воспроизвести микс","播放推荐歌单":"Воспроизвести микс дня",
    "Aa 你好，世界 Glass Player 123":"Aa Привет, мир — Glass Player 123","New York（衬线）":"New York (с засечками)","Apple 系统字体":"Системный шрифт Apple","中文":"Китайский","UI 主题色跟随当前歌曲封面":"Акцент по текущей обложке",
    "比特率":"Битрейт","播放":"Воспроизвести","播客":"Подкаст","播完这首后暂停":"Остановить после этой песни","取消定时":"Отменить таймер","采样率":"Частота дискретизации","声道":"Каналы","格式":"Формат","文件信息":"Информация о файле","响度":"Громкость","风格":"Жанр","能量":"Энергия","分析中…":"Анализ…","未检测到":"Не обнаружено","电子":"Электронная","古典":"Классика","歌曲名称 A–Z":"Название песни А–Я","歌手名称 A–Z":"Имя исполнителя А–Я","顺序播放":"Последовательно",
    "界面配色":"Цвет интерфейса","还没有音乐":"Музыки пока нет","松开鼠标以添加音乐":"Отпустите кнопку мыши, чтобы добавить музыку","睡眠定时":"Таймер сна","选择字体":"Выбор шрифта","听歌记录":"История прослушивания","音乐银河":"Музыкальная галактика","当前版本 7.3.0":"Текущая версия 7.3.0","版本 7.3.0":"Версия 7.3.0","导出日志":"Экспорт журнала","打开悬浮播放器":"Открыть плавающий плеер","返回设置":"Назад к настройкам","清除搜索":"Очистить поиск","收起侧边栏":"Свернуть боковую панель","展开侧边栏":"Развернуть боковую панель","未找到完全匹配，以下为粗略匹配":"Точного совпадения нет. Показаны близкие результаты","未找到匹配结果":"Совпадений нет","无法打开悬浮播放器":"Не удалось открыть плавающий плеер","当前浏览器或页面环境暂不支持传统视频画中画。":"Текущий браузер или окружение страницы не поддерживает классический режим «картинка в картинке».","知道了":"Понятно",
    "音乐库数据":"Данные медиатеки","重新扫描歌曲库":"Повторно сканировать медиатеку","重新扫描歌曲库？":"Повторно сканировать медиатеку?","取消":"Отмена","开始扫描":"Начать сканирование","精选字体":"Подборка шрифтов","未知艺人":"Неизвестный исполнитель","未知":"Неизвестно","计算中…":"Вычисление…","解码中…":"Декодирование…","单声道":"Моно","立体声":"Стерео","版本列表":"Список версий",
    "选择 Glass Player 的界面语言。":"Выберите язык интерфейса Glass Player.","在浅色、深色或根据时间自动切换。":"Выберите светлую, тёмную тему или автоматический режим.","选择界面使用的 Accent 颜色。":"Выберите цвет акцента интерфейса.","灵动光晕、封面取色或封面虚化。":"Динамическое свечение, цвет или размытие обложки.","调整界面字体的大小。":"Настройте размер шрифта интерфейса.","在可读性和信息密度之间调整。":"Баланс читаемости и плотности информации.","音效与空间音频":"Звук и пространственное аудио","空间音效":"Пространственный звук","自动响度均衡":"Автоматический баланс громкости","了解响度均衡":"О балансе громкости","桌面音响":"Настольные колонки","监听音箱":"Студийные мониторы","宽阔舞台":"Широкая сцена","环绕音":"Орбита","前置双耳":"Фронтальный бинауральный","现场大厅":"Живой зал","影院":"Кинотеатр","梦境":"Сновидение"
  };
  Object.assign(UI_EN,{
    "探索音乐关系":"Explore musical relationships","每颗星代表一首歌，相近的星共享音乐特征":"Each star represents a song; nearby stars share musical traits.","星点代表歌曲":"Stars represent songs","星团代表音乐风格":"Clusters represent musical genres","悬停查看歌曲":"Hover to identify","点击固定信息":"Click to pin details","导入歌曲后即可探索音乐银河":"Import music to explore your Music Galaxy","已展示 {shown} / {total} 首可分析歌曲":"Showing {shown} of {total} analyzable songs","已展示 {count} 个歌曲点":"Showing {count} song points","歌曲名称":"Song Title","歌手":"Artist","风格":"Genre","节奏 {tempo}":"Tempo {tempo}","音乐银河歌曲分布图":"Music Galaxy song map"
  });
  Object.assign(UI_RU,{
    "探索音乐关系":"Исследуйте музыкальные связи","每颗星代表一首歌，相近的星共享音乐特征":"Каждая звезда — это песня; близкие звёзды имеют общие музыкальные черты.","星点代表歌曲":"Звёзды обозначают песни","星团代表音乐风格":"Скопления обозначают музыкальные жанры","悬停查看歌曲":"Наведите курсор, чтобы узнать песню","点击固定信息":"Нажмите, чтобы закрепить сведения","导入歌曲后即可探索音乐银河":"Импортируйте музыку, чтобы исследовать музыкальную галактику","已展示 {shown} / {total} 首可分析歌曲":"Показано {shown} из {total} анализируемых песен","已展示 {count} 个歌曲点":"Показано {count} точек-песен","歌曲名称":"Название песни","歌手":"Исполнитель","风格":"Жанр","节奏 {tempo}":"Темп {tempo}","音乐银河歌曲分布图":"Карта песен музыкальной галактики"
  });
  const i18nTextOriginal=new WeakMap();
  const i18nAttrOriginal=new WeakMap();
  function translatedValue(key){if(uiLanguage==="zh")return key;const dictionary=uiLanguage==="ru"?UI_RU:UI_EN;return dictionary[key]||UI_EN[key]||key;}
  function tr(zh,en){return uiLanguage==="zh"?zh:uiLanguage==="ru"?(UI_RU[zh]||en):en;}
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
    document.documentElement.lang=uiLanguage==="en"?"en":uiLanguage==="ru"?"ru":"zh-CN";
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
    if(typeof syncTraditionalPiP==="function")syncTraditionalPiP(true);
    if(currentIndex===-1){setNowPlayingTitle(tr("未选择歌曲","No Song Selected"));$("#nowArtist").textContent=tr("拖入或导入音乐开始播放","Drop or import music to begin");}
  }
    function getLanguage(){return uiLanguage;}
    function setLanguage(value){uiLanguage=value==="en"?"en":value==="ru"?"ru":"zh";applyLanguage();}
    return Object.freeze({tr,translateTree,applyLanguage,getLanguage,setLanguage});
  })();
  const tr=(...args)=>GP.i18n.tr(...args);
  const applyLanguage=(...args)=>GP.i18n.applyLanguage(...args);
