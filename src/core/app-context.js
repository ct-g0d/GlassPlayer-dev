  GPModules.register("createAppContext",function createAppContext(parts){
    return Object.freeze({store:parts.store,bus:parts.bus,actions:parts.actions,selectors:parts.selectors,contracts:parts.contracts,adapters:Object.freeze({...parts.adapters}),engines:Object.freeze({...parts.engines}),services:Object.freeze({...parts.services})});
  });
