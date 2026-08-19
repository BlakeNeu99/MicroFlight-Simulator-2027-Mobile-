import { describe, it, expect } from 'vitest';
import { EngineConfig } from '../src/engine/core/Config';
import { TerrainStreamingEngine } from '../src/engine/rendering/TerrainEngine';
import { OcclusionCullingSystem } from '../src/engine/rendering/OcclusionCulling';
import { Vec3 } from '../src/engine/core/Math3D';

describe('StreamingEngine', ()=>{
  it('generates desired tiles around camera', ()=>{
    const s=new TerrainStreamingEngine();
    s.update(0.016, new Vec3(0,1200,0));
    expect(s.stats.cached).toBeGreaterThan(20);
  });
  it('evicts LRU when over limit', ()=>{
    const s=new TerrainStreamingEngine();
    // move far — cache should stay bounded by LRU (allow some growth but not unbounded)
    for(let i=0;i<30;i++){
      s.update(0.016, new Vec3(i*8000, 1200, 0));
    }
    expect(s.stats.cached).toBeLessThan(2000);
    expect(s.stats.cached).toBeGreaterThan(100);
  });
  it('hit rate improves with repeated position', ()=>{
    const s=new TerrainStreamingEngine();
    for(let i=0;i<5;i++) s.update(0.016, new Vec3(0,1200,0));
    expect(s.stats.hitRate).toBeGreaterThan(0.5);
  });
});

describe('OcclusionCulling', ()=>{
  it('culls distant objects', ()=>{
    const c=new OcclusionCullingSystem();
    const vp=new Float32Array(16); vp[0]=1; vp[5]=1; vp[10]=1; vp[15]=1;
    c.setCamera(vp, new Vec3(0,1200,0));
    c.register({id:'far', center:new Vec3(90000,0,0), radius:100, lod:0, visible:true, occluded:false, screenSize:10});
    c.update(16);
    expect(c.stats.culledFrustum).toBe(1);
  });
  it('lod bias increases under thermal throttling', ()=>{
    const c=new OcclusionCullingSystem();
    const vp=new Float32Array(16); vp[0]=1; vp[5]=1; vp[10]=1; vp[15]=1;
    c.setCamera(vp, new Vec3());
    c.update(22); // over budget 16.6
    expect(c.stats.lodBias).toBeGreaterThan(1);
    c.update(10);
    expect(c.stats.lodBias).toBeLessThan(1.04+0.04);
  });
});

describe('EngineConfig', ()=>{
  it('has mobile-optimized LODs', ()=>{
    expect(EngineConfig.rendering.lodDistances.length).toBe(5);
    expect(EngineConfig.streaming.maxConcurrentRequests).toBeLessThanOrEqual(6);
    expect(EngineConfig.performance.frameBudgetMs).toBeCloseTo(16.6,0);
  });
});
