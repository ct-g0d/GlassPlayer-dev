  /* /src/storage/indexeddb.js */
  class GPIndexedDBAdapter{
    constructor(options){
      const config=options||{};
      this.name=config.name||"glass-player-gen4";
      this.version=config.version||5;
      this._openPromise=null;
    }
    open(){
      if(this._openPromise)return this._openPromise;
      this._openPromise=new Promise((resolve,reject)=>{
        if(!window.indexedDB){reject(new Error("IndexedDB unavailable"));return;}
        const request=window.indexedDB.open(this.name,this.version);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains("trackFeatures")){
            const store=db.createObjectStore("trackFeatures",{keyPath:"contentKey"});
            store.createIndex("analyzedAt","analyzedAt",{unique:false});
            store.createIndex("schemaVersion","schemaVersion",{unique:false});
          }
          if(!db.objectStoreNames.contains("behaviorEvents")){
            const store=db.createObjectStore("behaviorEvents",{keyPath:"id",autoIncrement:true});
            store.createIndex("contentKey","contentKey",{unique:false});
            store.createIndex("timestamp","timestamp",{unique:false});
            store.createIndex("type","type",{unique:false});
          }
          if(!db.objectStoreNames.contains("userModel"))db.createObjectStore("userModel",{keyPath:"id"});
          if(!db.objectStoreNames.contains("recommendations"))db.createObjectStore("recommendations",{keyPath:"id"});
          if(!db.objectStoreNames.contains("trackCache")){
            const store=db.createObjectStore("trackCache",{keyPath:"contentKey"});
            store.createIndex("cachedAt","cachedAt",{unique:false});
            store.createIndex("fileName","fileName",{unique:false});
            store.createIndex("fileSize","fileSize",{unique:false});
            store.createIndex("fileIdentity","fileIdentity",{unique:false});
            store.createIndex("audioEssenceKey","audioEssenceKey",{unique:false});
            store.createIndex("spectrumId","spectrumId",{unique:false});
            store.createIndex("anchorHead","recognition.anchorHead",{unique:false});
            store.createIndex("anchorMiddle","recognition.anchorMiddle",{unique:false});
            store.createIndex("anchorTail","recognition.anchorTail",{unique:false});
            store.createIndex("flacPcmMd5","recognition.flacPcmMd5",{unique:false});
          }else{
            const store=request.transaction.objectStore("trackCache");
            if(!store.indexNames.contains("fileIdentity"))store.createIndex("fileIdentity","fileIdentity",{unique:false});
            if(!store.indexNames.contains("audioEssenceKey"))store.createIndex("audioEssenceKey","audioEssenceKey",{unique:false});
            if(!store.indexNames.contains("spectrumId"))store.createIndex("spectrumId","spectrumId",{unique:false});
            if(!store.indexNames.contains("anchorHead"))store.createIndex("anchorHead","recognition.anchorHead",{unique:false});
            if(!store.indexNames.contains("anchorMiddle"))store.createIndex("anchorMiddle","recognition.anchorMiddle",{unique:false});
            if(!store.indexNames.contains("anchorTail"))store.createIndex("anchorTail","recognition.anchorTail",{unique:false});
            if(!store.indexNames.contains("flacPcmMd5"))store.createIndex("flacPcmMd5","recognition.flacPcmMd5",{unique:false});
          }
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>{this._openPromise=null;reject(request.error||new Error("IndexedDB open failed"));};
        request.onblocked=()=>{this._openPromise=null;reject(new Error("IndexedDB upgrade blocked"));};
      });
      return this._openPromise;
    }
    async run(storeName,mode,operation){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction(storeName,mode);
        const store=transaction.objectStore(storeName);
        let request;
        try{request=operation(store);}catch(error){reject(error);return;}
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));
        transaction.onabort=()=>reject(transaction.error||new Error("IndexedDB transaction aborted"));
      });
    }
    get(storeName,key){return this.run(storeName,"readonly",store=>store.get(key));}
    getByIndex(storeName,indexName,key){return this.run(storeName,"readonly",store=>store.index(indexName).get(key));}
    getAll(storeName){return this.run(storeName,"readonly",store=>store.getAll());}
    async putMany(storeName,rows){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction(storeName,"readwrite"),store=transaction.objectStore(storeName);
        rows.forEach(row=>store.put(row));
        transaction.oncomplete=()=>resolve(rows.length);
        transaction.onerror=transaction.onabort=()=>reject(transaction.error||new Error("IndexedDB transaction failed"));
      });
    }
    put(storeName,value){return this.run(storeName,"readwrite",store=>store.put(value));}
    delete(storeName,key){return this.run(storeName,"readwrite",store=>store.delete(key));}
    clear(storeName){return this.run(storeName,"readwrite",store=>store.clear());}
  }

  /* /src/core/database.js */
  const GPDatabase={
    adapter:null,
    use(adapter){this.adapter=adapter;return this;},
    requireAdapter(){if(!this.adapter)throw new Error("GP storage adapter is not configured");return this.adapter;},
    getTrackFeatures(contentKey){return this.requireAdapter().get("trackFeatures",contentKey);},
    saveTrackFeatures(record){return this.requireAdapter().put("trackFeatures",record);},
    deleteTrackFeatures(contentKey){return this.requireAdapter().delete("trackFeatures",contentKey);},
    getTrackCache(contentKey){return this.requireAdapter().get("trackCache",contentKey);},
    getTrackCacheByFileIdentity(fileIdentity){return this.requireAdapter().getByIndex("trackCache","fileIdentity",fileIdentity);},
    getTrackCacheByEssenceKey(audioEssenceKey){return this.requireAdapter().getByIndex("trackCache","audioEssenceKey",audioEssenceKey);},
    getTrackCacheBySpectrumId(spectrumId){return this.requireAdapter().getByIndex("trackCache","spectrumId",spectrumId);},
    getTrackCacheByRecognitionIndex(indexName,value){return value?this.requireAdapter().getByIndex("trackCache",indexName,value):Promise.resolve(null);},
    addTrackCache(record){return this.requireAdapter().run("trackCache","readwrite",store=>store.add(record));},
    saveTrackCache(record){return this.requireAdapter().put("trackCache",record);},
    addBehaviorEvent(event){return this.requireAdapter().put("behaviorEvents",event);},
    getBehaviorEvents(){return this.requireAdapter().getAll("behaviorEvents");},
    saveUserModel(model){return this.requireAdapter().put("userModel",model);},
    getUserModel(id){return this.requireAdapter().get("userModel",id||"default");},
    saveRecommendations(record){return this.requireAdapter().put("recommendations",record);},
    getRecommendations(id){return this.requireAdapter().get("recommendations",id||"daily");}
  };
  const GPBrowserStorage=Object.freeze({
    getLocal(key){return localStorage.getItem(key);},
    setLocal(key,value){localStorage.setItem(key,value);},
    removeLocal(key){localStorage.removeItem(key);}
  });

  /* /src/storage/data-vault.js
     The browser's storage stays the live copy, so playing music never touches the disk. data/db holds a saved copy, in the same
     records, written about once an hour (or on leaving the tab, if it's been ten minutes) and only for what has changed. Covers are
     image files shared between tracks. Reading from disk or importing only adds: no record is deleted, and play counts keep the higher. */
  const GPDataVault=(()=>{
    const DB_NAME="glass-player-gen4",DB_VERSION=5,FORMAT="glass-player-export",HOURLY=3600000,LEAVING=600000,BATCH_ROWS=50,BATCH_BYTES=64*1048576;
    const STORES=Object.freeze({trackCache:"contentKey",trackFeatures:"contentKey",behaviorEvents:"id",userModel:"id",recommendations:"id"});
    const HISTORY="glassPlayerHistory",PREFS="glassPlayerPrefs",SIDEBAR="glassPlayerSidebarCollapsed",REVISION="glassPlayerDiskRevision";
    const EXTENSIONS=Object.freeze({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"});
    const onDisk=location.protocol.startsWith("http");
    const adapter=()=>GPDatabase.requireAdapter();
    let lastFlushAt=Date.now(),flushing=null,importing=false,reporter=null,coverRefs=null,savedAt=0,state=onDisk?"ready":"unavailable",notify=()=>{};
    const setState=value=>{state=value;notify(status());};
    const progress=(percent,phase,completed,total)=>reporter?.({percent:Math.min(100,percent),phase,completed,total});
    const nextPaint=()=>new Promise(resolve=>setTimeout(resolve));
    const FINISHED="glassPlayerDataFinished";
    const rowWeight=store=>store==="trackCache"?200:1;   // a track carries its covers, so it takes far longer than any other record: the bar follows the work
    const weigh=counts=>Object.entries(counts).reduce((sum,[store,count])=>sum+count*rowWeight(store),0)||1;
    const status=()=>Object.freeze({state,savedAt});
    const knownRevision=()=>Number(GPBrowserStorage.getLocal(REVISION))||0;
    const stamp=row=>row.updatedAt||row.analyzedAt||row.generatedAt||row.savedAt||row.timestamp||0;
    const toHex=buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
    const hashOf=async data=>toHex(await crypto.subtle.digest("SHA-256",data));
    const docText=rows=>`[\n${rows.map(row=>JSON.stringify(row)).join(",\n")}\n]`;
    async function readDisk(path){
      const response=await fetch(`/db/${path}`);
      if(response.status===404)return null;
      if(!response.ok)throw new Error(`Disk read failed: ${path}`);
      return path.startsWith("covers/")?response.blob():response.json();
    }
    async function writeDisk(path,body,headers){
      const response=await fetch(`/db/${path}`,{method:"PUT",headers:{"X-GP":"1",...headers},body});
      if(!response.ok)throw Object.assign(new Error(`Disk write failed: ${path}`),{status:response.status});
    }
    // Merging two histories never lowers a count, whichever copy is behind
    function mergeHigher(a,b){
      if(typeof a==="number"&&typeof b==="number")return Math.max(a,b);
      if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(a)&&!Array.isArray(b)){
        const merged={...a};
        for(const key of Object.keys(b))merged[key]=key in a?mergeHigher(a[key],b[key]):b[key];
        return merged;
      }
      return b??a;
    }
    const parseLocal=key=>{try{return JSON.parse(GPBrowserStorage.getLocal(key));}catch(error){return null;}};
    function mergeLocal(incoming,replace){
      if(incoming[HISTORY]){
        const merged=mergeHigher(parseLocal(HISTORY),JSON.parse(incoming[HISTORY]));
        GPBrowserStorage.setLocal(HISTORY,JSON.stringify(merged));
      }
      for(const key of [PREFS,SIDEBAR])if(incoming[key]!=null&&(replace||GPBrowserStorage.getLocal(key)==null))GPBrowserStorage.setLocal(key,incoming[key]);
    }
    async function revive(value){
      if(!value||typeof value!=="object")return value;
      if(value.__file)return new Blob([await readDisk(value.__file)],{type:value.type});
      if(value.__blob!==undefined||value.__bytes!==undefined){
        const bytes=Uint8Array.from(atob(value.data),char=>char.charCodeAt(0));
        if(value.__blob!==undefined)return new Blob([bytes],{type:value.__blob});
        return value.__bytes==="ArrayBuffer"?bytes.buffer:new globalThis[value.__bytes](bytes.buffer);
      }
      if(Array.isArray(value))return Promise.all(value.map(revive));
      const out={};
      for(const key of Object.keys(value))out[key]=await revive(value[key]);
      return out;
    }
    // Writes rows in batches, keeping any local record that is as new as the incoming one (replace: the local copy is empty, so anything there is only a start-up default)
    function rowWriter(store,replace){
      const keyPath=STORES[store];
      let local=null,batch=[],bytes=0,written=0;
      const flushBatch=async()=>{
        const rows=[];
        for(const row of batch)rows.push(await revive(row));
        batch=[];bytes=0;
        if(rows.length){await adapter().putMany(store,rows);written+=rows.length;}
      };
      return{
        async add(row,size=0){
          if(row.folderHandle)return;   // a folder's permission belongs to the browser it was granted in
          local??=new Map((await adapter().getAll(store)).map(item=>[item[keyPath],stamp(item)]));
          const known=local.get(row[keyPath]);
          if(!replace&&known!==undefined&&known>=stamp(row))return;
          batch.push(row);bytes+=size;
          if(batch.length>=BATCH_ROWS||bytes>=BATCH_BYTES)await flushBatch();
        },
        async finish(){await flushBatch();return written;}
      };
    }
    async function localIsEmpty(){
      const [tracks,events]=await Promise.all([adapter().getAll("trackCache"),adapter().getAll("behaviorEvents")]);
      const history=parseLocal(HISTORY);
      return !tracks.length&&!events.length&&!Object.keys(history?.songs||{}).length;
    }
    async function pullFromDisk(manifest,replace){
      const total=weigh(manifest.counts||{});
      let done=0,count=0;
      const rowTotal=Object.values(manifest.counts||{}).reduce((sum,value)=>sum+value,0);
      mergeLocal(await readDisk("local.json")||{},replace);
      for(const store of Object.keys(STORES)){
        const writer=rowWriter(store,replace);
        for(const row of await readDisk(`${store}.json`)||[]){
          await writer.add(row);
          done+=rowWeight(store);count++;
          if(!(count%10))progress(done/total*100,"restore",count,rowTotal);
        }
        await writer.finish();
      }
      GPBrowserStorage.setLocal(REVISION,String(manifest.revision));
    }
    // What came back, for the message once the page has reloaded
    async function summary(){
      const [tracks,events]=await Promise.all([adapter().getAll("trackCache"),adapter().getAll("behaviorEvents")]);
      return{tracks:tracks.length,events:events.length,songs:Object.keys(parseLocal(HISTORY)?.songs||{}).length};
    }
    async function markFinished(){sessionStorage.setItem(FINISHED,JSON.stringify(await summary()));}
    function takeFinished(){
      const value=sessionStorage.getItem(FINISHED);
      sessionStorage.removeItem(FINISHED);
      return value?JSON.parse(value):null;
    }
    // A cover already on disk isn't read again: rows point at it by track, kind and size
    async function loadCoverRefs(){
      coverRefs=new Map();
      for(const row of await readDisk("trackCache.json")||[])for(const field of ["coverBlob","thumbBlob"])if(row[field]?.__file)coverRefs.set(`${row.contentKey}:${field}:${row[field].size}`,row[field]);
    }
    async function coverRef(row,field){
      const blob=row[field];
      if(!blob)return blob??null;
      const key=`${row.contentKey}:${field}:${blob.size}`;
      if(coverRefs.has(key))return coverRefs.get(key);
      const bytes=await blob.arrayBuffer(),name=`covers/${await hashOf(bytes)}.${EXTENSIONS[blob.type]||"bin"}`;
      await writeDisk(name,bytes);
      const ref={__file:name,type:blob.type,size:blob.size};
      coverRefs.set(key,ref);
      return ref;
    }
    async function saveToDisk(){
      const manifest=await readDisk("manifest.json");
      const base=manifest?.revision||0;
      if(base&&base!==knownRevision()){setState("conflict");return false;}
      if(!base&&await localIsEmpty())return false;
      if(!coverRefs)await loadCoverRefs();
      const docs={"local.json":JSON.stringify({[HISTORY]:GPBrowserStorage.getLocal(HISTORY),[PREFS]:GPBrowserStorage.getLocal(PREFS),[SIDEBAR]:GPBrowserStorage.getLocal(SIDEBAR)})},counts={};
      for(const store of Object.keys(STORES)){
        const rows=(await adapter().getAll(store)).filter(row=>!row.folderHandle);
        if(store==="trackCache")for(let index=0;index<rows.length;index++){
          const row=rows[index];
          row.coverBlob=await coverRef(row,"coverBlob");row.thumbBlob=await coverRef(row,"thumbBlob");
          if(!(index%10))progress(index/rows.length*100,"disk",index,rows.length);
        }
        docs[`${store}.json`]=docText(rows);counts[store]=rows.length;
      }
      const files={};
      let changed=!base;
      for(const [name,text] of Object.entries(docs)){
        files[name]=await hashOf(new TextEncoder().encode(text));
        if(files[name]===manifest?.files?.[name])continue;
        await writeDisk(name,text);
        changed=true;
      }
      if(!changed)return false;
      const next={format:1,revision:base+1,savedAt:Date.now(),files,counts};
      await writeDisk("manifest.json",JSON.stringify(next,null,2),{"X-GP-Base":String(base)});
      GPBrowserStorage.setLocal(REVISION,String(next.revision));
      savedAt=next.savedAt;
      return true;
    }
    function flush(onProgress){
      if(!onDisk||importing)return Promise.resolve(false);   // an import saves once it has finished
      lastFlushAt=Date.now();
      reporter=typeof onProgress==="function"?onProgress:null;
      return flushing??=saveToDisk().then(saved=>{if(state!=="conflict")setState("ready");return saved;},error=>{console.warn("[GP Data]",error);setState(error.status===409?"conflict":"failed");return false;}).finally(()=>{flushing=null;reporter=null;});
    }
    async function start({beforeReload,onStatus,onProgress}={}){
      notify=onStatus||notify;
      notify(status());
      if(!onDisk)return;
      try{
        const manifest=await readDisk("manifest.json");
        savedAt=manifest?.savedAt||0;
        if(manifest&&manifest.revision!==knownRevision()){
          const replace=await localIsEmpty();
          reporter=replace?onProgress:null;   // a browser that only needs topping up does it quietly
          await pullFromDisk(manifest,replace);
          reporter=null;
          if(replace)await markFinished();
          beforeReload?.();
          location.reload();
          return;
        }
        if(!manifest)setTimeout(flush,60000);
        notify(status());
      }catch(error){console.warn("[GP Data]",error);setState("failed");return;}
      setInterval(flush,HOURLY);
      document.addEventListener("visibilitychange",()=>{if(document.hidden&&Date.now()-lastFlushAt>=LEAVING)flush();});
    }
    const toBase64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
    async function encode(value){
      if(value instanceof Blob)return{__blob:value.type,data:await toBase64(value)};
      if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return{__bytes:value.constructor.name,data:await toBase64(new Blob([value]))};
      if(Array.isArray(value))return Promise.all(value.map(encode));
      if(value===null||typeof value!=="object"||value instanceof Date)return value;
      if(window.FileSystemHandle&&value instanceof FileSystemHandle)return{__handle:value.kind,name:value.name};
      const out={};
      for(const key of Object.keys(value))out[key]=await encode(value[key]);
      return out;
    }
    // One record to a line, in parts, so the size of a library never hits the limit on one string. It's still ordinary JSON
    async function exportFile(onProgress){
      const local={};
      const rowsByStore={};
      for(const store of Object.keys(STORES))rowsByStore[store]=await adapter().getAll(store);
      const total=weigh(Object.fromEntries(Object.entries(rowsByStore).map(([store,rows])=>[store,rows.length])));
      const rowTotal=Object.values(rowsByStore).reduce((sum,rows)=>sum+rows.length,0);
      let done=0,count=0;
      for(const key of [HISTORY,PREFS,SIDEBAR]){const value=GPBrowserStorage.getLocal(key);if(value!=null)local[key]=value;}
      const parts=[`{"format":"${FORMAT}","version":2,"exportedAt":${JSON.stringify(new Date().toISOString())},"localStorage":${JSON.stringify(local)},"indexedDB":{"${DB_NAME}":{"version":${DB_VERSION},"stores":{\n`];
      let firstStore=true;
      for(const store of Object.keys(STORES)){
        parts.push(`${firstStore?"":",\n"}"${store}":[\n`);firstStore=false;
        const rows=rowsByStore[store];
        for(let index=0;index<rows.length;index++){
          parts.push(`${index?",\n":""}${JSON.stringify(await encode(rows[index]))}`);
          done+=rowWeight(store);count++;
          if(!(count%10)){onProgress?.({percent:done/total*100,phase:"export",completed:count,total:rowTotal});await nextPaint();}
        }
        parts.push("\n]");
      }
      parts.push("}}}}\n");
      return new Blob(parts,{type:"application/json"});
    }
    async function* fileLines(file,onChunk){
      const reader=file.stream().pipeThrough(new TextDecoderStream()).getReader();
      let pending=[];   // only each new piece is searched, as an older export is one very long line
      for(;;){
        const {value,done}=await reader.read();
        if(done)break;
        onChunk(value);
        let start=0,end;
        while((end=value.indexOf("\n",start))>=0){
          pending.push(value.slice(start,end));
          yield pending.join("");
          pending=[];
          start=end+1;
        }
        if(start<value.length)pending.push(value.slice(start));
      }
      if(pending.length)yield pending.join("");
    }
    // Takes this format, and the older export that's all on one line. Other apps' data in that file stays out
    async function importFile(file,onProgress){
      importing=true;
      await flushing;
      reporter=onProgress||null;
      try{await readImport(file);await markFinished();}finally{importing=false;reporter=null;}
    }
    async function readImport(file){
      const replace=await localIsEmpty();
      let isFirst=true,writer=null,total=0,recognised=false,oneLine=null,read=0;
      const onChunk=chunk=>{
        oneLine??=!chunk.startsWith(`{"format":"${FORMAT}"`);
        read+=chunk.length;
        progress(read/file.size*(oneLine?40:100),"read");
      };
      for await(const line of fileLines(file,onChunk)){
        if(isFirst){
          isFirst=false;
          if(line.startsWith(`{"format":"${FORMAT}"`)){
            mergeLocal(JSON.parse(`${line}}}}}`).localStorage||{},true);
            recognised=true;
            continue;
          }
          progress(40,"read");
          await nextPaint();
          const data=JSON.parse(line),stores=data.indexedDB?.[DB_NAME]?.stores;
          if(!stores)break;
          const rowCount=Object.keys(STORES).reduce((sum,store)=>sum+(stores[store]?.length||0),0);
          const weight=weigh(Object.fromEntries(Object.keys(STORES).map(store=>[store,stores[store]?.length||0])));
          let done=0,count=0;
          recognised=true;
          mergeLocal(data.localStorage||{},true);
          for(const store of Object.keys(STORES)){
            const rows=rowWriter(store,replace);
            for(const row of stores[store]||[]){
              await rows.add(row,row.coverBlob?.data?.length||0);
              done+=rowWeight(store);count++;
              if(!(count%10))progress(40+done/weight*60,"restore",count,rowCount);
            }
            total+=await rows.finish();
          }
          continue;
        }
        const opening=line.match(/^,?"(\w+)":\[$/);
        if(opening){writer=STORES[opening[1]]?rowWriter(opening[1],replace):null;continue;}
        if(line.startsWith("]")){if(writer)total+=await writer.finish();writer=null;continue;}
        if(writer)await writer.add(JSON.parse(line.endsWith(",")?line.slice(0,-1):line),line.length);
      }
      if(!recognised)throw new Error("Not a Glass Player export");
      return total;
    }
    return Object.freeze({start,flush,status,exportFile,importFile,takeFinished});
  })();
