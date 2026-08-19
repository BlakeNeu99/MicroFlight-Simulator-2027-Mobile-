/** Global engine configuration — tuned for mobile silicon thermal envelope */
export const EngineConfig = {
  targetFPS: 60,
  fixedTimeStep: 1/120, // physics substeps 120Hz
  maxSubSteps: 4,
  rendering: {
    fov: 68 * Math.PI/180,
    near: 0.1,
    far: 80000,
    shadowMapSize: 1024, // mobile-friendly
    lodDistances: [500, 2000, 8000, 20000, 50000],
    occlusionCulling: true,
    msaa: false, // use FXAA on mobile
  },
  streaming: {
    tileSize: 256,
    maxConcurrentRequests: 6,
    cacheSizeMB: 128,
    prefetchRadius: 2,
  },
  physics: {
    bladeElementsPerWing: 12, // 24 total + fuselage + tail
    airDensitySeaLevel: 1.225,
    gravity: 9.81,
  },
  performance: {
    enableThermalThrottling: true,
    frameBudgetMs: 16.6,
    lowPowerFrameScale: 0.85,
  }
} as const;

export const AircraftSpecs = {
  'MF-27 Sparrow': {
    mass: 1200, // kg
    wingSpan: 10.2,
    wingArea: 16.2,
    chordRoot: 1.8,
    chordTip: 1.0,
    wingTwistDeg: -2.5,
    dihedralDeg: 3,
    cruiseSpeed: 68, // m/s
    stallSpeedClean: 28,
    maxSpeed: 92,
    enginePower: 180 * 745.7, // watts (180 hp)
    propDiameter: 1.9,
    controlSurfaces: { aileron: 22, elevator: 25, rudder: 28, flaps: 35 },
    inertia: { x: 1800, y: 3200, z: 4200 }
  }
} as const;
