  GPModules.register("createNeuralService",function createNeuralService(runtime){
    // The legacy Daily Mix closure reads this injected singleton; it does not create or persist a Galaxy service.
    neuralGalaxyService=runtime.galaxy||null;
    return Object.freeze({recordBehavior:runtime.recordBehavior,generateDailyMix:runtime.generateDailyMix,getUserModel:runtime.getUserModel});
  });
