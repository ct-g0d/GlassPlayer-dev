  /* ================= GP Gen 4 architecture / Harmonic Lake =================
     The single-file build keeps the exact 3.5.3 UI runtime. These contracts are
     deliberately adapter-based so the same Core/UI code can move to Electron
     Lake later by replacing storage/indexeddb with storage/sqlite only. */
  const GP_FEATURE_SCHEMA_VERSION = 4;
  const GP_TRACK_CACHE_SCHEMA_VERSION = 7;
  const GP_RECOGNITION_SCHEMA_VERSION = 2;
  const GP_SPECTRUM_ALGORITHM_VERSION = "2.1.0";
  const GP_FUSION_ENGINE_VERSION = "4.1";
  const GP_SPECTRUM_ENGINE_VERSION = "2.3";
  const GP_NEURAL_ENGINE_VERSION = "2.2";
  const GP_MOTION_TARGET_FPS = 120;
  const GP_MOTION_FRAME_MS = 1000 / GP_MOTION_TARGET_FPS;
  const GP_PIP_TARGET_FPS = 30;
  const GP_PIP_FRAME_MS = 1000 / GP_PIP_TARGET_FPS;
  const GP_MOTION_CONTRACT = Object.freeze({
    refreshRateCeiling:GP_MOTION_TARGET_FPS,
    scheduler:"requestAnimationFrame",
    fixedFrameTimers:false
  });
