  GPModules.register("createStore",function createStore({initialState,bus,actions}){
    let state=structuredClone(initialState);const listeners=new Set(),selectorListeners=new Set();
    const snapshot=()=>Object.freeze(structuredClone(state));
    function notify(previous){const next=snapshot();listeners.forEach(listener=>listener(next,Object.freeze(structuredClone(previous))));selectorListeners.forEach(entry=>{const value=entry.selector(next);if(!Object.is(value,entry.last)){const old=entry.last;entry.last=value;entry.listener(value,old);}});}
    function dispatch(action){const previous=state;if(action?.type===actions.types.REPLACE)state=structuredClone(action.state);else if(action?.type===actions.types.PATCH){state=structuredClone(state);let target=state;for(let i=0;i<action.path.length-1;i++)target=target[action.path[i]];target[action.path.at(-1)]=structuredClone(action.value);}else throw new Error(`Unknown action: ${action?.type}`);notify(previous);return action;}
    function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
    function subscribeSelector(selector,listener){const entry={selector,listener,last:selector(snapshot())};selectorListeners.add(entry);return()=>selectorListeners.delete(entry);}
    function replaceStateForMigration(next){dispatch(actions.replace(next));}
    return Object.freeze({getState:snapshot,dispatch,subscribe,subscribeSelector,replaceStateForMigration});
  });
