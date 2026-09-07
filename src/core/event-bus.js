  GPModules.register("createEventBus",function createEventBus(){
    const listeners=new Map();
    function on(type,listener){if(typeof listener!=="function")throw new TypeError("Event listener must be a function");let set=listeners.get(type);if(!set){set=new Set();listeners.set(type,set);}set.add(listener);return()=>off(type,listener);}
    function off(type,listener){const set=listeners.get(type);if(!set)return;set.delete(listener);if(!set.size)listeners.delete(type);}
    function emit(type,payload){const set=listeners.get(type);if(!set)return;[...set].forEach(listener=>listener(payload));}
    function clear(){listeners.clear();}
    return Object.freeze({on,off,emit,clear});
  });
