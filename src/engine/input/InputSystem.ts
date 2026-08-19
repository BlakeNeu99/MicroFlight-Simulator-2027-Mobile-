/**
 * Input System — Touch gesture cockpit + Gamepad + Keyboard fallback
 * Customizable, fully rebindable, haptics-aware
 */
import { Vec3 } from '../core/Math3D';

export interface InputFrame {
  aileron: number; elevator: number; rudder: number; throttle: number;
  flaps: number; brake: boolean; gear: boolean;
  lookX: number; lookY: number;
  pause: boolean; cameraNext: boolean;
}

export class InputSystem {
  private aileron=0; private elevator=0; private rudder=0; private throttle=0.68;
  private flaps=0; private brake=false; private gear=true;
  private lookX=0; private lookY=0;
  private keys = new Set<string>();
  private gamepadIndex: number|null=null;

  // touch state
  private touch = {
    left: { active:false, x:0, y:0, id:-1 },
    right: { active:false, x:0, y:0, id:-1 },
    rudder: 0
  };

  // customization — FRIENDLY DEFAULTS (less twitchy)
  sensitivity = { pitch: 0.78, roll: 0.82, yaw: 0.68, throttle: 1 };
  deadzone = 0.09;
  invertPitch = false;
  easyDamp = 0.92; // return-to-center speed when released

  constructor(private canvas: HTMLCanvasElement){
    this.bindEvents();
    window.addEventListener('keydown', e=>{
      this.keys.add(e.code);
      if(e.code==='KeyG') this.gear=!this.gear;
      if(e.code==='KeyF') this.flaps = this.flaps>0.5?0: this.flaps<0.33?0.33:0.66;
      if(e.code==='Space') this.brake=true;
    });
    window.addEventListener('keyup', e=>{
      this.keys.delete(e.code);
      if(e.code==='Space') this.brake=false;
    });
    window.addEventListener('gamepadconnected', e=>{ this.gamepadIndex=(e as GamepadEvent).gamepad.index; });
  }

  private bindEvents(){
    const c=this.canvas;
    const rect = ()=>c.getBoundingClientRect();
    const dead = (v:number, dz:number)=> Math.abs(v)<dz?0:(v - Math.sign(v)*dz)/(1-dz);

    // left stick: pitch/roll
    c.addEventListener('touchstart', e=>{
      e.preventDefault();
      for(const t of Array.from(e.changedTouches)){
        const r=rect(); const x=(t.clientX-r.left)/r.width; const y=(t.clientY-r.top)/r.height;
        if(x<0.42 && y>0.38){
          this.touch.left.active=true; this.touch.left.id=t.identifier; this.touch.left.x=x; this.touch.left.y=y;
        } else if(x>0.58){
          this.touch.right.active=true; this.touch.right.id=t.identifier; this.touch.right.x=x; this.touch.right.y=y;
        }
      }
    }, {passive:false});
    c.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const t of Array.from(e.touches)){
        if(t.identifier===this.touch.left.id){
          const r=rect(); const x=(t.clientX-r.left)/r.width; const y=(t.clientY-r.top)/r.height;
          const dx = (x - this.touch.left.x)/0.18; const dy = (y - this.touch.left.y)/0.18;
          this.aileron = dead(Math.max(-1,Math.min(1,dx))*this.sensitivity.roll, this.deadzone);
          this.elevator = dead(Math.max(-1,Math.min(1,-dy))*this.sensitivity.pitch, this.deadzone) * (this.invertPitch?-1:1);
        }
        if(t.identifier===this.touch.right.id){
          const r=rect(); const y=(t.clientY-r.top)/r.height;
          const dy = (y - 0.5)/0.4; // throttle vertical
          this.throttle = Math.max(0, Math.min(1, 0.5 - dy*0.85));
        }
      }
      // rudder slider at bottom
      for(const t of Array.from(e.touches)){
        const r=rect(); const x=(t.clientX-r.left)/r.width; const y=(t.clientY-r.top)/r.height;
        if(y>0.88 && x>0.22 && x<0.78){
          this.rudder = dead((x-0.5)/0.28, 0.05)*this.sensitivity.yaw;
          this.touch.rudder=this.rudder;
        }
      }
    }, {passive:false});
    c.addEventListener('touchend', e=>{
      e.preventDefault();
      for(const t of Array.from(e.changedTouches)){
        if(t.identifier===this.touch.left.id){ this.touch.left.active=false; this.aileron*=0.42; this.elevator*=0.42; }
        if(t.identifier===this.touch.right.id){ this.touch.right.active=false; }
      }
      if(e.touches.length===0){
        this.touch.rudder*=0.55; this.rudder*=0.55;
        // gentle auto-center when no touch
        this.aileron *= 0.55; this.elevator *= 0.55;
      }
    }, {passive:false});

    // mouse fallback for desktop testing
    let dragging=false; let dragStart={x:0,y:0};
    c.addEventListener('mousedown', e=>{
      dragging=true; dragStart={x:e.clientX, y:e.clientY};
      if(e.button===0) this.brake=true;
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const dx=(e.clientX-dragStart.x)/180; const dy=(e.clientY-dragStart.y)/180;
      this.aileron = dead(Math.max(-1,Math.min(1,dx)), this.deadzone);
      this.elevator = dead(Math.max(-1,Math.min(1,-dy)), this.deadzone);
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; this.aileron*=0.45; this.elevator*=0.45; this.brake=false; });
    c.addEventListener('wheel', e=>{
      this.throttle = Math.max(0, Math.min(1, this.throttle - e.deltaY*0.0007));
    }, {passive:true});
  }

  poll(): InputFrame {
    // keyboard overrides
    if(this.keys.has('KeyA')||this.keys.has('ArrowLeft')) this.aileron = Math.max(-1, this.aileron - 0.07);
    if(this.keys.has('KeyD')||this.keys.has('ArrowRight')) this.aileron = Math.min(1, this.aileron + 0.07);
    if(this.keys.has('KeyW')||this.keys.has('ArrowUp')) this.elevator = Math.min(1, this.elevator + 0.06);
    if(this.keys.has('KeyS')||this.keys.has('ArrowDown')) this.elevator = Math.max(-1, this.elevator - 0.06);
    if(this.keys.has('KeyQ')) this.rudder = Math.max(-1, this.rudder - 0.06);
    if(this.keys.has('KeyE')) this.rudder = Math.min(1, this.rudder + 0.06);
    if(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')) this.throttle = Math.min(1, this.throttle+0.012);
    if(this.keys.has('ControlLeft')||this.keys.has('ControlRight')) this.throttle = Math.max(0, this.throttle-0.012);
    if(!this.touch.left.active){
      if(!this.keys.has('KeyA')&&!this.keys.has('KeyD')&&!this.keys.has('ArrowLeft')&&!this.keys.has('ArrowRight')) this.aileron*=0.94;
      if(!this.keys.has('KeyW')&&!this.keys.has('KeyS')&&!this.keys.has('ArrowUp')&&!this.keys.has('ArrowDown')) this.elevator*=0.94;
      if(!this.keys.has('KeyQ')&&!this.keys.has('KeyE')) this.rudder*=0.93;
    }

    // gamepad
    if(this.gamepadIndex!==null){
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if(gp){
        const dz=0.12;
        const a0 = Math.abs(gp.axes[0])>dz?gp.axes[0]:0;
        const a1 = Math.abs(gp.axes[1])>dz?gp.axes[1]:0;
        const a2 = Math.abs(gp.axes[2]??0)>dz? (gp.axes[2] as number):0;
        const a3 = gp.axes[3]??0;
        this.aileron = a0*0.95;
        this.elevator = -a1*0.95;
        this.rudder = a2*0.92;
        this.throttle = Math.max(0, Math.min(1, (1 - a3)*0.5));
        if(gp.buttons[0]?.pressed) this.brake=true; else if(!this.keys.has('Space')) this.brake=false;
        if(gp.buttons[9]?.pressed) this.gear=!this.gear;
      }
    }

    return {
      aileron: this.aileron, elevator: this.elevator, rudder: this.rudder, throttle: this.throttle,
      flaps: this.flaps, brake: this.brake, gear: this.gear,
      lookX:this.lookX, lookY:this.lookY, pause:false, cameraNext:false
    };
  }

  setFlaps(v:number){ this.flaps=Math.max(0,Math.min(1,v)); }
  setThrottle(v:number){ this.throttle=Math.max(0,Math.min(1,v)); }
}
