/**
 * MicroFlight Simulator 2027 — Main Game Orchestrator
 * Architecture: Engine (core/physics/rendering/input/audio) + Game (Aircraft/World) + UI
 * Vulkan/Metal command-buffer style frame loop, fixed physics stepping.
 */
import { Renderer } from '../engine/rendering/Renderer';
import { TerrainStreamingEngine } from '../engine/rendering/TerrainEngine';
import { OcclusionCullingSystem } from '../engine/rendering/OcclusionCulling';
import { WeatherField } from '../engine/physics/Atmosphere';
import { FlightModel } from '../engine/physics/FlightModel';
import { InputSystem } from '../engine/input/InputSystem';
import { AudioSystem } from '../engine/audio/AudioSystem';
import { Time } from '../engine/core/Time';
import { Vec3, Mat4, Quat } from '../engine/core/Math3D';
import { EngineConfig } from '../engine/core/Config';

export class MicroFlightApp {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  streaming: TerrainStreamingEngine;
  culling: OcclusionCullingSystem;
  weather: WeatherField;
  flight: FlightModel;
  input: InputSystem;
  audio: AudioSystem;
  time = new Time();

  // camera
  camMode: 'chase'|'cockpit'|'orbit' = 'chase';
  camPos = new Vec3(0, 6, -18);
  camTarget = new Vec3();
  camUp = new Vec3(0,1,0);
  chaseDistance = 22; chaseHeight = 5.4;
  orbitYaw = 0.7; orbitPitch = 0.22;

  // ui refs
  hud = {
    ias: 0, alt:0, vs:0, hdg:0, g:1, aoa:0, throttle:0, flaps:0, wind: '', fps:60,
    stalled:false, onGround:false, coverage:0, tiles:0
  };

  private running = true;
  private frameTimeMs = 16;
  private lastFpsUpdate = 0;

  constructor(canvas: HTMLCanvasElement){
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.streaming = new TerrainStreamingEngine();
    this.culling = new OcclusionCullingSystem();
    this.weather = new WeatherField();
    this.flight = new FlightModel(this.weather);
    this.input = new InputSystem(canvas);
    this.audio = new AudioSystem();
    // click to init audio
    canvas.addEventListener('pointerdown', ()=> this.audio.init(), {once:true});
    this.setupUI();
    this.resize();
  }

  private setupUI(){
    // flaps buttons handled via DOM in main.ts — here we expose methods
  }

  setControlsFromInput(){
    const inp = this.input.poll();
    this.flight.controls.aileron = inp.aileron;
    this.flight.controls.elevator = inp.elevator;
    this.flight.controls.rudder = inp.rudder;
    this.flight.controls.throttle = inp.throttle;
    this.flight.controls.flaps = inp.flaps;
    this.flight.controls.brake = inp.brake ? 1 : 0;
  }

  updateCamera(dt:number){
    const pos = this.flight.pos;
    const vel = this.flight.vel;
    const quat = this.flight.quat;

    if(this.camMode==='chase'){
      const fwd = quat.rotateVector(new Vec3(1,0,0));
      const up = quat.rotateVector(new Vec3(0,1,0));
      // desired chase pos behind aircraft
      let target = new Vec3(pos.x - fwd.x*this.chaseDistance, pos.y + this.chaseHeight, pos.z - fwd.z*this.chaseDistance);
      // add velocity lead
      target.x += vel.x*0.12; target.z += vel.z*0.12;
      // collision with ground
      if(target.y < 3.8) target.y = 3.8;
      // smooth
      this.camPos.x += (target.x - this.camPos.x) * Math.min(1, dt*3.2);
      this.camPos.y += (target.y - this.camPos.y) * Math.min(1, dt*2.8);
      this.camPos.z += (target.z - this.camPos.z) * Math.min(1, dt*3.2);
      // look at aircraft + lead point
      const look = new Vec3(pos.x + fwd.x*12, pos.y, pos.z + fwd.z*12);
      this.camTarget.x += (look.x - this.camTarget.x)*Math.min(1, dt*4);
      this.camTarget.y += (look.y - this.camTarget.y)*Math.min(1, dt*4);
      this.camTarget.z += (look.z - this.camTarget.z)*Math.min(1, dt*4);
      this.camUp = up;
    } else if(this.camMode==='cockpit'){
      const eyeOffset = quat.rotateVector(new Vec3(0.75, 0.42, 0));
      this.camPos = Vec3.add(pos, eyeOffset, new Vec3());
      const lookOffset = quat.rotateVector(new Vec3(24, -0.15, 0));
      this.camTarget = Vec3.add(this.camPos, lookOffset, new Vec3());
      this.camUp = quat.rotateVector(new Vec3(0,1,0));
    } else if(this.camMode==='orbit'){
      this.orbitYaw += dt*0.08;
      const r = 48;
      this.camPos.x = pos.x + Math.cos(this.orbitYaw)*r;
      this.camPos.z = pos.z + Math.sin(this.orbitYaw)*r;
      this.camPos.y = pos.y + 14 + Math.sin(this.time.elapsed*0.22)*2;
      this.camTarget = new Vec3(pos.x, pos.y, pos.z);
      this.camUp = new Vec3(0,1,0);
    }
  }

  frame(nowSec:number){
    if(!this.running) return;
    this.time.tick(nowSec);
    const dt = this.time.deltaTime;
    this.frameTimeMs = dt*1000;

    this.setControlsFromInput();

    // fixed physics steps
    const alpha = this.time.consumeFixedSteps((fixed)=>{
      this.flight.step(fixed);
    });

    this.updateCamera(dt);
    this.streaming.update(dt, this.flight.pos);
    // audio
    this.audio.update(this.flight.controls.throttle, this.flight.ias, this.flight.stalled, this.flight.onGround);

    // render
    this.render();

    // hud
    if(this.time.elapsed - this.lastFpsUpdate > 0.12){
      this.lastFpsUpdate = this.time.elapsed;
      this.hud.fps = Math.round(this.time.fps);
      this.hud.ias = Math.round(this.flight.ias * 1.943); // kts
      this.hud.alt = Math.round(this.flight.alt * 3.28084);
      this.hud.vs = Math.round(this.flight.vs * 196.85); // fpm
      this.hud.hdg = Math.round(this.flight.heading);
      this.hud.g = +(this.flight.gForce.toFixed(2));
      this.hud.aoa = +(this.flight.aoa.toFixed(1));
      this.hud.throttle = Math.round(this.flight.controls.throttle*100);
      this.hud.flaps = Math.round(this.flight.controls.flaps*100);
      this.hud.stalled=this.flight.stalled; this.hud.onGround=this.flight.onGround;
      const ws = this.weather.sample(this.flight.pos, this.flight.alt);
      const windSpd = Math.hypot(ws.velocity.x, ws.velocity.z)*1.943;
      const windDir = (Math.atan2(ws.velocity.x, ws.velocity.z)*180/Math.PI+360)%360;
      this.hud.wind = `${Math.round(windDir).toString().padStart(3,'0')}° ${Math.round(windSpd)}kt turb ${ws.turbulence.toFixed(1)}`;
      this.hud.tiles = this.streaming.stats.cached;
      this.hud.coverage = 0.62;
    }

    requestAnimationFrame((t)=> this.frame(t/1000));
  }

  private render(){
    // view / proj
    const view = Mat4.lookAt(this.camPos, this.camTarget, this.camUp);
    const proj = Mat4.perspective(EngineConfig.rendering.fov, this.renderer.width/this.renderer.height, EngineConfig.rendering.near, EngineConfig.rendering.far);
    this.renderer.setViewProj(view as Float32Array, proj as Float32Array);
    this.renderer.sunDir = new Vec3(0.42, 0.62, 0.38).normalize();

    this.renderer.beginFrame(this.time.deltaTime);
    this.renderer.drawSky();
    this.renderer.drawTerrain(this.flight.pos);
    this.renderer.drawClouds(this.flight.pos, 0.62);
    // aircraft model matrix
    const model = this.flight.getMatrix();
    this.renderer.drawAircraft(model, this.camPos);
    this.renderer.endFrame();

    // frame stats for culling adaptation
    this.culling.setCamera(this.renderer.viewProj, this.camPos);
    this.culling.update(this.frameTimeMs);
  }

  resize(){ this.renderer.resize(); }

  // exposed for UI
  setFlaps(v:number){ this.input.setFlaps(v); }
  cycleCamera(){ this.camMode = this.camMode==='chase' ? 'cockpit' : this.camMode==='cockpit' ? 'orbit' : 'chase'; }
  reset(){ this.flight.reset(); this.camPos = new Vec3(0,6,-18); }
  setWeatherCoverage(v:number){ /* driven internally */ }
}
