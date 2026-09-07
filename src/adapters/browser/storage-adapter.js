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
