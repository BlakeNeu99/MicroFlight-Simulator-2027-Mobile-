# Architecture — MicroFlight Simulator 2027 (Mobile)

## System Overview
High-performance cross-platform engine mimicking Vulkan/Metal command-buffer design, but shipping as WebGL2 for zero-install mobile preview. Modular systems: **Core**, **Physics**, **Rendering**, **Input**, **Audio**, **Network**.

```
┌─────────────────────────────────────────────────────┐
│                     MicroFlightApp                  │
│  Time (fixed-step)  Weather  Streaming  Culling      │
│  FlightModel (BET)  Renderer  Input  Audio            │
└──────────┬──────────────────────────────────────────┘
           │ requestAnimationFrame 16.6ms
           ▼
┌─────────────────────────────────────────────────────┐
│ Renderer (Vulkan-style)                             │
│ beginFrame → drawSky → drawTerrain → drawClouds     │
│ → drawAircraft → endFrame(FXAA)                     │
│ FBO: color RGBA + depth16 → FXAA resolve             │
└─────────────────────────────────────────────────────┘
```

## Core
- **Math3D**: Vec3, Quat, Mat4, column-major, zero alloc in hot path (re-use `out` param). `Quat.rotateVector`, `Mat4.perspective/lookAt`.
- **Time**: accumulator fixed-step `1/120`, `maxSubSteps 4`, interpolation alpha, fps smoothing 30 samples.
- **Config**: centralized budgets — `fov 68°`, `near 0.1 far 80 km`, `lodDistances [500,2000,8000,20000,50000]`, `tileSize 256`, `maxConcurrent 6`, `cache 128 MB`, `frameBudget 16.6 ms`.

## Physics
- **Atmosphere**: ISA (T0 288.15, lapse 0.0065, R 287), `getDensity`, `speedOfSound`; WeatherField with microbursts/thermals.
- **BladeElementTheory**: 27 elements, wingIncidence 2.8°, compute per element local `vLocal = vel + ω×r - wind`, AoA, Cl/Cd (linear→stall exp), ground effect, `dyn 0.5 ρ V²`, lift⊥drag∥, `torque r×F`. Prop thrust `ηP/V`, p-factor.
- **FlightModel**: semi-implicit Euler, ground plane y=3.2, friction, angular damping `0.12+0.004*|v|`, quaternion integration `q+=0.5 q ω dt`, telemetry (IAS via `sqrt(ρ/1.225)`, VS, AoA via `acos(fwd·vHat)`, gForce, slip, stall).

## Rendering
- **Renderer**: WebGL2 `high-performance`, `desynchronized`, depth+cull, FXAA FBO, `createProgram` explicit, VAOs for terrain (180² grid, 64k indices), quad, aircraft (capsule loft + wing extrusions, 2k tris). UBOs simulated via uniforms (`uViewProj`, `uCameraPos`, `uSunDir`). `computeLOD`, `frustumCull`, `invertMatrix` for cloud inverse VP.
- **Shaders**: GLSL 300 es, precision highp, 5 shaders (terrain/cloud/aircraft/sky/fxaa). Terrain vertex fBm 5 octaves + ridge, fragment palette + slope + PBR ambient + haze. Cloud raymarch 24 steps. Aircraft PBR GGX. Sky gradient + sun disk. FXAA luma edge.
- **TerrainStreamingEngine**: quadtree 4500 m world tile, desired 4+2 ring, priority sort, queue 6 concurrent latency 90–320 ms, LRU 560, hitRate, memoryMB.
- **OcclusionCulling**: screenSize `radius/dist*1200`, frustum far, lodBias dynamic `±0.04` per frame.

## Input
Touch `touchstart/move/end` rect normalized, left stick (pitch/roll) deadzone 0.06, right throttle, bottom rudder bar, mouse+wheel, keyboard (WASD, QE, Shift/Ctrl, G/F/Space), gamepad 4 axes, haptics.

## Audio
WebAudio saw 58–153 Hz engine + triangle bandpass wind 1.2 kHz, low-pass 820 Hz, master 0.42.

## Network
`NetworkStreamingSystem` HTTP/2 tile queue, LRU, bandwidth estimate, procedural fallback heightmap.

## Build
Vite 5.4, `host 0.0.0.0 port 5173 allowedHosts:true`, COOP/COEP, `target esnext`, `tsc --noEmit` gate, `outDir dist`, source maps.

## Performance Budget
DrawCall <8, triangle <9k, BET <2.5 ms/100 frames (~0.025 ms/frame), streaming bandwidth adaptive, frameTime feedback loop ensures thermal stability on A17/8 Gen3.

