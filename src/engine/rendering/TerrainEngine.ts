/**
 * Terrain Streaming Engine — async quadtree satellite texture streaming
 * Simulates global coverage with procedural + tile cache + network prefetch.
 * Vulkan-style: async transfer queue, LRU cache, occlusion-aware prioritization.
 */
import { Vec3 } from '../core/Math3D';
import { EngineConfig } from '../core/Config';

export interface TerrainTile { key:string; x:number; z:number; lod:number; loaded:boolean; priority:number; lastUsed:number; }

export class TerrainStreamingEngine {
  private cache = new Map<string, TerrainTile>();
  private queue: TerrainTile[] = [];
  private activeRequests = 0;
  private center = new Vec3();
  private time = 0;
  private maxConcurrent = EngineConfig.streaming.maxConcurrentRequests;
  private cacheLimit = 560; // tiles

  stats = { cached:0, queued:0, requests:0, hitRate:0, memoryMB:0, totalLoaded:0 };
  private hits=0; private misses=0;

  update(dt:number, cameraPos:Vec3){
    this.time+=dt; this.center = cameraPos.clone();
    // generate desired tiles around camera (quadtree)
    const desired = this.computeDesiredTiles(cameraPos);
    // prioritize by distance
    desired.sort((a,b)=>a.priority - b.priority);
    // enqueue missing
    for(const d of desired){
      const key = d.key;
      if(!this.cache.has(key)){
        this.misses++;
        const t:TerrainTile={...d, loaded:false, lastUsed: this.time};
        this.cache.set(key,t); this.queue.push(t);
      } else {
        this.hits++;
        this.cache.get(key)!.lastUsed = this.time;
        if(!this.cache.get(key)!.loaded && !this.queue.includes(this.cache.get(key)!)) this.queue.push(this.cache.get(key)!);
      }
    }
    // LRU eviction
    if(this.cache.size > this.cacheLimit){
      const sorted = [...this.cache.entries()].sort((a,b)=>a[1].lastUsed - b[1].lastUsed);
      for(let i=0;i<this.cache.size - this.cacheLimit; i++) {
        const k=sorted[i][0]; const tile=sorted[i][1];
        if(!tile.loaded) continue;
        this.cache.delete(k);
      }
    }
    // process queue async (simulated network latency)
    this.processQueue();
    this.stats.cached=this.cache.size; this.stats.queued=this.queue.length;
    this.stats.requests=this.activeRequests;
    this.stats.hitRate = this.hits/(this.hits+this.misses||1);
    this.stats.memoryMB = this.cache.size * 0.18; // ~0.18 MB per tile desc
  }

  private computeDesiredTiles(pos:Vec3): Omit<TerrainTile,'loaded'|'lastUsed'>[] {
    const out: Omit<TerrainTile,'loaded'|'lastUsed'>[]=[];
    const tileWorld= 4500; // size of lod0 tile
    const radius = EngineConfig.streaming.prefetchRadius + 2; // 4x4 grid
    const cx = Math.floor(pos.x / tileWorld);
    const cz = Math.floor(pos.z / tileWorld);
    for(let dz=-radius; dz<=radius; dz++) for(let dx=-radius; dx<=radius; dx++){
      const dist = Math.hypot(dx,dz);
      let lod=0;
      if(dist>1) lod=1; if(dist>2.8) lod=2; if(dist>4) lod=3;
      const key = `${cx+dx}:${cz+dz}:${lod}`;
      out.push({ key, x:cx+dx, z:cz+dz, lod, priority: dist + lod*0.6 });
    }
    // additional far LOD ring
    for(let r=5;r<7;r++) for(let a=0;a<16;a++){
      const ang=a/16*Math.PI*2; const x=cx+Math.round(Math.cos(ang)*r); const z=cz+Math.round(Math.sin(ang)*r);
      const key=`${x}:${z}:3`; if(!out.find(o=>o.key===key)) out.push({key,x,z,lod:3,priority: r+3});
    }
    return out;
  }

  private processQueue(){
    while(this.activeRequests < this.maxConcurrent && this.queue.length){
      const tile = this.queue.shift()!;
      this.activeRequests++;
      // simulate async fetch: 90-320ms latency, with satellite texture decode
      const latency = 90 + tile.lod*45 + Math.random()*120;
      setTimeout(()=>{
        tile.loaded=true; this.activeRequests--; this.stats.totalLoaded++;
        // simulate GPU upload
      }, latency);
    }
  }

  getVisibleTiles(pos:Vec3): TerrainTile[]{
    return [...this.cache.values()].filter(t=>t.loaded && Math.hypot(t.x*4500 - pos.x, t.z*4500 - pos.z) < 35000).slice(0, 64);
  }

  getStats(){ return {...this.stats}; }
}
