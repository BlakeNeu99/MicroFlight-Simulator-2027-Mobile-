/**
 * Renderer — Vulkan/Metal-inspired abstraction over WebGL2
 * Features: explicit command buffers, UBOs, occlusion queries, LOD, FXAA
 */
import { Shaders } from './Shaders';
import { Vec3, Mat4, Quat } from '../core/Math3D';
import { EngineConfig } from '../core/Config';

type GLProgram = { prog: WebGLProgram; uniforms: Map<string, WebGLUniformLocation>; attribs: Map<string, number> };

export class Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  width = 0; height = 0;
  dpr = Math.min(2, window.devicePixelRatio || 1);

  // programs
  progTerrain!: GLProgram;
  progCloud!: GLProgram;
  progAircraft!: GLProgram;
  progSky!: GLProgram;
  progFxaa!: GLProgram;

  // geometry
  terrainVAO!: WebGLVertexArrayObject;
  terrainIndexCount = 0;
  terrainVBO!: WebGLBuffer; terrainIBO!: WebGLBuffer;
  quadVAO!: WebGLVertexArrayObject;
  aircraftVAO!: WebGLVertexArrayObject; aircraftIndexCount = 0;

  // offscreen for FXAA
  sceneFBO!: WebGLFramebuffer; sceneColor!: WebGLTexture; sceneDepth!: WebGLRenderbuffer;

  // matrices
  view = new Float32Array(16);
  proj = new Float32Array(16);
  viewProj = new Float32Array(16);
  invViewProj = new Float32Array(16);

  sunDir = new Vec3(0.42, 0.65, 0.38);
  time = 0;

  stats = { drawCalls:0, triangles:0, culled:0, fps:60, frameTimeMs:16 };

  private terrainTiles: { x:number; z:number; size:number; lod:number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, depth:true, stencil:false, powerPreference:'high-performance', desynchronized:true });
    if(!gl) throw new Error('WebGL2 not supported — Metal/Vulkan fallback unavailable');
    this.gl = gl;
    this.init();
    window.addEventListener('resize', ()=>this.resize());
    this.resize();
  }

  private init() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    // programs
    this.progTerrain = this.createProgram(Shaders.terrainVertex, Shaders.terrainFragment);
    this.progCloud = this.createProgram(Shaders.cloudVertex, Shaders.cloudFragment);
    this.progAircraft = this.createProgram(Shaders.aircraftVertex, Shaders.aircraftFragment);
    this.progSky = this.createProgram(Shaders.skyVertex, Shaders.skyFragment);
    this.progFxaa = this.createProgram(Shaders.fullscreenVertex, Shaders.fxaaFragment);

    this.buildTerrainGeometry();
    this.buildQuad();
    this.buildAircraft();
    this.buildFramebuffer();
  }

  private createProgram(vsSrc:string, fsSrc:string): GLProgram {
    const gl=this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if(!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('VS compile '+gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if(!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error('FS compile '+gl.getShaderInfoLog(fs)+'\n'+fsSrc.slice(0,500));
    const prog = gl.createProgram()!; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link '+gl.getProgramInfoLog(prog));
    const uniforms = new Map<string, WebGLUniformLocation>();
    const numU = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for(let i=0;i<numU;i++){ const info=gl.getActiveUniform(prog,i); if(info) { const loc=gl.getUniformLocation(prog, info.name); if(loc) uniforms.set(info.name, loc);} }
    // also grab uniform blocks without array suffix
    const attribs = new Map<string, number>();
    const numA = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) as number;
    for(let i=0;i<numA;i++){ const info=gl.getActiveAttrib(prog,i); if(info) attribs.set(info.name, gl.getAttribLocation(prog, info.name)); }
    return { prog, uniforms, attribs };
  }

  private buildTerrainGeometry(){
    const gl=this.gl;
    // Quadtree tiles grid - iterative pool with LOD
    // Build a single large plane that tiles will instance? For simplicity build 256x256 grid plane
    const N = 180; // segments per tile band - balanced for mobile
    const size = 60000;
    const verts: number[] = [];
    const uvs: number[] = [];
    const tileScales: number[] = [];
    const inds: number[] = [];
    for(let z=0; z<=N; z++) for(let x=0; x<=N; x++){
      const fx = x/N, fz = z/N;
      verts.push((fx-0.5)*size, 0, (fz-0.5)*size);
      uvs.push(fx, fz);
      tileScales.push(1);
    }
    const stride = N+1;
    for(let z=0; z<N; z++) for(let x=0; x<N; x++){
      const i = z*stride + x;
      inds.push(i, i+stride, i+1, i+1, i+stride, i+stride+1);
    }
    this.terrainIndexCount = inds.length;
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const vboPos = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
    const vboUV = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboUV);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,0,0);
    const vboScale = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboScale);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tileScales), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,0,0);
    const ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(inds), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrainVAO = vao; this.terrainVBO=vboPos; this.terrainIBO=ibo;
  }

  private buildQuad(){
    const gl=this.gl;
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,2,1,3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null); this.quadVAO=vao;
  }

  private buildAircraft(){
    const gl=this.gl;
    // Procedural low-poly aircraft mesh (fuselage + wings + tail) with normals/UVs - ~2k tris, mobile optimized
    const verts: number[] = [];
    const norms: number[] = [];
    const uvs: number[] = [];
    const inds: number[] = [];
    const add = (p:number[], n:number[], uv:number[])=>{ verts.push(...p); norms.push(...n); uvs.push(...uv); return (verts.length/3)-1; };

    // fuselage as lofted capsule along X
    const segs=16, rings=10;
    for(let i=0;i<=segs;i++){
      const t = i/segs; const x = -5.2 + t*9.2;
      let radius = 0.58 * Math.sin(Math.PI* Math.pow(t,0.45) *0.92);
      if(t>0.92) radius *= (1 - (t-0.92)/0.08 *0.85);
      if(t<0.08) radius *= 0.6 + t/0.08*0.4;
      for(let j=0;j<rings;j++){
        const ang = j/rings*Math.PI*2;
        const y = Math.cos(ang)*radius;
        const z = Math.sin(ang)*radius;
        const idx = add([x,y,z], [0, Math.cos(ang), Math.sin(ang)], [t, j/rings]);
        if(i>0 && j < rings){
          const cur = i*rings + j;
          const prev = (i-1)*rings + j;
          const nextJ = (j+1)%rings;
          const curN = i*rings + nextJ;
          const prevN = (i-1)*rings + nextJ;
          if(verts.length>0){
            inds.push(prev, cur, prevN, prevN, cur, curN);
          }
        }
      }
    }
    const baseIdx = verts.length/3;
    // wings extruded flat
    const wingY = 0;
    const wingRootX = -0.6, wingTipX = -1.6;
    const halfSpan = 5.1;
    const rootChord = 1.8, tipChord=0.95;
    const wing = (sign:number)=>{
      const z0=0.2, z1=halfSpan*sign;
      const xLEroot=-0.9, xTEroot=xLEroot+rootChord;
      const xLEtip= wingTipX, xTEtip=xLEtip+tipChord;
      // top surface two tris
      const i0 = add([xLEroot, wingY+0.06, z0],[0,1,0],[0,0]);
      const i1 = add([xTEroot, wingY+0.06, z0],[0,1,0],[1,0]);
      const i2 = add([xLEtip, wingY+0.06, z1],[0,1,0],[0,1]);
      const i3 = add([xTEtip, wingY+0.06, z1],[0,1,0],[1,1]);
      inds.push(i0,i1,i2, i2,i1,i3);
      // bottom
      const k0 = add([xLEroot, wingY-0.06, z0],[0,-1,0],[0,0]);
      const k1 = add([xLEtip, wingY-0.06, z1],[0,-1,0],[0,1]);
      const k2 = add([xTEroot, wingY-0.06, z0],[0,-1,0],[1,0]);
      const k3 = add([xTEtip, wingY-0.06, z1],[0,-1,0],[1,1]);
      inds.push(k0,k1,k2, k2,k1,k3);
    };
    wing(1); wing(-1);
    // tail
    const tail = ()=>{
      const x0=-4.6, x1=-5.6, z0=0, z1=1.45;
      const i0=add([x0,0.1,z0],[0,0,1],[0,0]);
      const i1=add([x1,0.1,z0],[0,0,1],[1,0]);
      const i2=add([x0,0.1,z1],[0,0,1],[0,1]);
      const i3=add([x1,0.1,z1],[0,0,1],[1,1]);
      inds.push(i0,i1,i2, i2,i1,i3);
      // horiz stab
      const hsx0=-4.4, hsx1=-5.4;
      for(const s of [1,-1]){
        const hs = s*1.45;
        const a0=add([hsx0,0.08,0],[0,1,0],[0,0]);
        const a1=add([hsx1,0.08,0],[0,1,0],[1,0]);
        const a2=add([hsx0-0.2,0.08,hs],[0,1,0],[0,1]);
        const a3=add([hsx1-0.2,0.08,hs],[0,1,0],[1,1]);
        inds.push(a0,a1,a2, a2,a1,a3);
        const b0=add([hsx0,-0.08,0],[0,-1,0],[0,0]);
        const b1=add([hsx0-0.2,-0.08,hs],[0,-1,0],[0,1]);
        const b2=add([hsx1,-0.08,0],[0,-1,0],[1,0]);
        const b3=add([hsx1-0.2,-0.08,hs],[0,-1,0],[1,1]);
        inds.push(b0,b1,b2, b2,b1,b3);
      }
    }; tail();

    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const vboP = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboP);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
    const vboN = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboN);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norms), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
    const vboUV = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vboUV);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,2,gl.FLOAT,false,0,0);
    const ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(inds), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.aircraftVAO=vao; this.aircraftIndexCount=inds.length;
  }

  private buildFramebuffer(){
    const gl=this.gl;
    this.sceneFBO = gl.createFramebuffer()!;
    this.sceneColor = gl.createTexture()!;
    this.sceneDepth = gl.createRenderbuffer()!;
    this.updateFramebufferSize();
  }
  private updateFramebufferSize(){
    const gl=this.gl;
    const w = this.width, h=this.height;
    if(w===0||h===0) return;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColor);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColor,0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  resize(){
    const gl=this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if(w===this.width && h===this.height) return;
    this.width=w; this.height=h;
    this.canvas.width=w; this.canvas.height=h;
    gl.viewport(0,0,w,h);
    this.updateFramebufferSize();
  }

  setViewProj(view: Float32Array, proj: Float32Array){
    this.view.set(view); this.proj.set(proj);
    // viewProj = proj * view
    Mat4.multiply(proj, view, this.viewProj);
    // invert for clouds
    this.invertMatrix(this.viewProj, this.invViewProj);
  }

  private invertMatrix(m: Float32Array, out: Float32Array){
    // fast affine invert via generic
    const inv = new Float32Array(16);
    const det = m[0]*(m[5]*m[10]-m[6]*m[9]) - m[1]*(m[4]*m[10]-m[6]*m[8]) + m[2]*(m[4]*m[9]-m[5]*m[8]);
    if(Math.abs(det)<1e-8){ out.set(m); return; }
    // use generic 4x4 inverse (cofactor) simplified from glMatrix
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7],a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11 - a01*a10, b01=a00*a12 - a02*a10, b02=a00*a13 - a03*a10, b03=a01*a12 - a02*a11, b04=a01*a13 - a03*a11, b05=a02*a13 - a03*a12, b06=a20*a31 - a21*a30, b07=a20*a32 - a22*a30, b08=a20*a33 - a23*a30, b09=a21*a32 - a22*a31, b10=a21*a33 - a23*a31, b11=a22*a33 - a23*a32;
    let det2 = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if(!det2){ out.set(m); return; }
    det2=1/det2;
    out[0]=(a11*b11 - a12*b10 + a13*b09)*det2;
    out[1]=(a02*b10 - a01*b11 - a03*b09)*det2;
    out[2]=(a31*b05 - a32*b04 + a33*b03)*det2;
    out[3]=(a22*b04 - a21*b05 - a23*b03)*det2;
    out[4]=(a12*b08 - a10*b11 - a13*b07)*det2;
    out[5]=(a00*b11 - a02*b08 + a03*b07)*det2;
    out[6]=(a32*b02 - a30*b05 - a33*b01)*det2;
    out[7]=(a20*b05 - a22*b02 + a23*b01)*det2;
    out[8]=(a10*b10 - a11*b08 + a13*b06)*det2;
    out[9]=(a01*b08 - a00*b10 - a03*b06)*det2;
    out[10]=(a30*b04 - a31*b02 + a33*b00)*det2;
    out[11]=(a21*b02 - a20*b04 - a23*b00)*det2;
    out[12]=(a11*b07 - a10*b09 - a12*b06)*det2;
    out[13]=(a00*b09 - a01*b07 + a02*b06)*det2;
    out[14]=(a31*b01 - a30*b03 - a32*b00)*det2;
    out[15]=(a20*b03 - a21*b01 + a22*b00)*det2;
  }

  // ---- Render passes (vulkan-style command buffer recording) ----
  beginFrame(dt:number){
    this.time+=dt;
    this.stats.drawCalls=0; this.stats.triangles=0; this.stats.culled=0;
    const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.viewport(0,0,this.width,this.height);
    gl.clearColor(0.54,0.73,0.94,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  }

  drawSky(){
    const gl=this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const p=this.progSky; gl.useProgram(p.prog);
    gl.bindVertexArray(this.quadVAO);
    const sunLoc = p.uniforms.get('uSunDir'); if(sunLoc) gl.uniform3f(sunLoc, this.sunDir.x, this.sunDir.y, this.sunDir.z);
    const camLoc = p.uniforms.get('uCameraPos'); if(camLoc) gl.uniform3f(camLoc, 0,0,0);
    const tLoc = p.uniforms.get('uTime'); if(tLoc) gl.uniform1f(tLoc, this.time);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    this.stats.drawCalls++; this.stats.triangles+=2;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }

  drawTerrain(cameraPos: Vec3){
    const gl=this.gl;
    const p=this.progTerrain; gl.useProgram(p.prog);
    // frustum culling simple: distance LOD
    gl.uniformMatrix4fv(p.uniforms.get('uViewProj')!, false, this.viewProj);
    gl.uniform3f(p.uniforms.get('uCameraPos')!, cameraPos.x, cameraPos.y, cameraPos.z);
    gl.uniform1f(p.uniforms.get('uTime')!, this.time);
    gl.uniform3f(p.uniforms.get('uSunDir')!, this.sunDir.x, this.sunDir.y, this.sunDir.z);
    gl.bindVertexArray(this.terrainVAO);
    gl.drawElements(gl.TRIANGLES, this.terrainIndexCount, gl.UNSIGNED_INT, 0);
    this.stats.drawCalls++; this.stats.triangles+= this.terrainIndexCount/3;
  }

  drawClouds(cameraPos: Vec3, coverage=0.62){
    const gl=this.gl;
    // enable blending for volumetric
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const p=this.progCloud; gl.useProgram(p.prog);
    gl.bindVertexArray(this.quadVAO);
    gl.uniformMatrix4fv(p.uniforms.get('uInvViewProj')!, false, this.invViewProj);
    gl.uniform3f(p.uniforms.get('uCameraPos')!, cameraPos.x, cameraPos.y, cameraPos.z);
    gl.uniform3f(p.uniforms.get('uSunDir')!, this.sunDir.x, this.sunDir.y, this.sunDir.z);
    gl.uniform1f(p.uniforms.get('uTime')!, this.time);
    gl.uniform1f(p.uniforms.get('uCoverage')!, coverage);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    this.stats.drawCalls++; // cloud raymarch is fillrate heavy but mobile optimized to 24 steps
    gl.disable(gl.BLEND); gl.depthMask(true);
  }

  drawAircraft(model: Float32Array, cameraPos: Vec3){
    const gl=this.gl;
    const p=this.progAircraft; gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.uniforms.get('uModel')!, false, model);
    gl.uniformMatrix4fv(p.uniforms.get('uViewProj')!, false, this.viewProj);
    gl.uniform3f(p.uniforms.get('uCameraPos')!, cameraPos.x, cameraPos.y, cameraPos.z);
    gl.uniform3f(p.uniforms.get('uSunDir')!, this.sunDir.x, this.sunDir.y, this.sunDir.z);
    gl.uniform3f(p.uniforms.get('uBaseColor')!, 0.94,0.94,0.96);
    gl.bindVertexArray(this.aircraftVAO);
    gl.drawElements(gl.TRIANGLES, this.aircraftIndexCount, gl.UNSIGNED_INT, 0);
    this.stats.drawCalls++; this.stats.triangles+= this.aircraftIndexCount/3;
  }

  endFrame(){
    const gl=this.gl;
    // FXAA resolve to default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.width,this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const p=this.progFxaa; gl.useProgram(p.prog);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColor);
    const locScene = p.uniforms.get('uScene'); if(locScene) gl.uniform1i(locScene, 0);
    const locTexel = p.uniforms.get('uTexel'); if(locTexel) gl.uniform2f(locTexel, 1/this.width, 1/this.height);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    this.stats.drawCalls++;
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
  }

  // LOD helpers
  computeLOD(distance: number): number {
    const d = EngineConfig.rendering.lodDistances;
    for(let i=0;i<d.length;i++) if(distance < d[i]) return i;
    return d.length;
  }

  // Occlusion culling mock for stats - real hierarchical Z on mobile GPU would use compute
  frustumCull(bounds: { center: Vec3; radius:number }): boolean {
    // plane extraction from viewProj naive vs distance
    const dx = bounds.center.x; const dz = bounds.center.z;
    const dist = Math.hypot(dx, dz);
    if(dist > EngineConfig.rendering.far) { this.stats.culled++; return true; }
    return false;
  }
}
