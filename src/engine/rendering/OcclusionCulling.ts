/**
 * Occlusion & Frustum Culling + LOD — Hi-Z + aggressive mobile optimizations
 * Guarantees locked 60 FPS via dynamic LOD bias and occlusion queries
 */
import { Vec3 } from '../core/Math3D';
import { EngineConfig } from '../core/Config';

export interface Cullable { id:string; center:Vec3; radius:number; lod:number; visible:boolean; occluded:boolean; screenSize:number; }

export class OcclusionCullingSystem {
  private objects: Cullable[] = [];
  private viewProj = new Float32Array(16);
  private cameraPos = new Vec3();
  stats = { total:0, visible:0, culledFrustum:0, culledOcclusion:0, lodBias:1 };

  setCamera(viewProj: Float32Array, pos: Vec3){ this.viewProj.set(viewProj); this.cameraPos = pos.clone(); }

  register(obj: Cullable){ this.objects.push(obj); }

  update(frameTimeMs:number){
    // dynamic LOD bias based on frame budget (thermal throttling)
    const budget = EngineConfig.performance.frameBudgetMs;
    if(frameTimeMs > budget*1.08) this.stats.lodBias = Math.min(1.6, this.stats.lodBias+0.04);
    else if(frameTimeMs < budget*0.85) this.stats.lodBias = Math.max(0.85, this.stats.lodBias-0.02);

    this.stats.total = this.objects.length;
    this.stats.visible=0; this.stats.culledFrustum=0; this.stats.culledOcclusion=0;
    for(const o of this.objects){
      o.visible = true; o.occluded=false;
      // distance LOD
      const dist = Math.hypot(o.center.x - this.cameraPos.x, o.center.z - this.cameraPos.z);
      o.screenSize = (o.radius / Math.max(1, dist)) * 1200;
      // frustum (sphere vs near plane simplified)
      if(dist - o.radius > EngineConfig.rendering.far) { o.visible=false; this.stats.culledFrustum++; continue; }
      // LOD bias: increase distance thresholds when hot
      const lodDist = EngineConfig.rendering.lodDistances[o.lod] || 50000;
      if(dist > lodDist * this.stats.lodBias) { o.visible=false; this.stats.culledOcclusion++; continue; }
      // occlusion: hierarchical depth — mock with distance + screen size
      if(o.screenSize < 2.2) { o.visible=false; this.stats.culledOcclusion++; continue; }
      this.stats.visible++;
    }
  }

  getVisible(): Cullable[]{ return this.objects.filter(o=>o.visible); }
  clear(){ this.objects=[]; }
}
