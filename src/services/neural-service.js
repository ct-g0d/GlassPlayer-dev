  GPModules.register("createNeuralService",function createNeuralService(runtime){
    // Daily Mix uses cached acoustic features plus the offline Genre Relations graph only.
    return Object.freeze({recordBehavior:runtime.recordBehavior,generateDailyMix:runtime.generateDailyMix,getUserModel:runtime.getUserModel});
  });
