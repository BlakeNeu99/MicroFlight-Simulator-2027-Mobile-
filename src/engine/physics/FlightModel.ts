import { Vec3, Quat, Mat4 } from '../core/Math3D';
import { EngineConfig, AircraftSpecs } from '../core/Config';
import { BladeElementTheory } from './BladeElementTheory';
import { WeatherField } from './Atmosphere';

export interface ControlsState {
  aileron: number; elevator: number; rudder: number; flaps: number; throttle: number;
  brake: number; gear: number;
}

export class FlightModel {
  pos = new Vec3(0, 1200, 0);
  vel = new Vec3(62, 0, 0);
  acc = new Vec3();
  quat = Quat.fromEuler(0, 0, 0);
  angVel = new Vec3(); // rad/s body
  angAcc = new Vec3();
  controls: ControlsState = { aileron:0, elevator:0, rudder:0, flaps:0, throttle:0.68, brake:0, gear:1 };
  private bet: BladeElementTheory;
  private weather: WeatherField;
  private spec = AircraftSpecs['MF-27 Sparrow'];
  private mass = this.spec.mass;
  private invInertia = new Vec3(1/this.spec.inertia.x, 1/this.spec.inertia.y, 1/this.spec.inertia.z);

  // telemetry
  ias = 62; tas = 62; aoa = 3; gForce = 1; slip = 0;
  vs = 0; alt = 1200; heading = 0;

  stalled = false;
  onGround = false;
  easyAssist = true; // friendly: auto-level, bank limit, softer stall

  constructor(weather: WeatherField) {
    this.weather = weather;
    this.bet = new BladeElementTheory(weather);
  }

  // semi-implicit Euler with angular quaternion integration
  step(dt: number) {
    const { totalForce, totalTorque } = this.bet.compute(this.pos, this.vel, this.angVel, this.quat, this.controls, this.controls.throttle, dt);

    // linear
    this.acc.x = totalForce.x / this.mass;
    this.acc.y = totalForce.y / this.mass;
    this.acc.z = totalForce.z / this.mass;

    this.vel.x += this.acc.x * dt;
    this.vel.y += this.acc.y * dt;
    this.vel.z += this.acc.z * dt;

    // simple ground collision plane y=0 — integrate position once
    const nextOnGround = this.pos.y <= 3.25;
    if(nextOnGround) {
      this.onGround = true;
      if(this.vel.y < 0) this.vel.y *= -0.18;
      if(Math.abs(this.vel.y) < 0.45) this.vel.y = Math.max(0, this.vel.y);
      const friction = this.controls.brake * 6.5 + 0.45;
      this.vel.x *= (1 - Math.min(0.95, friction*dt));
      this.vel.z *= (1 - Math.min(0.95, friction*dt));
      this.angVel.x *= (1 - 2.2*dt);
      this.angVel.z *= (1 - 2.2*dt);
    } else {
      this.onGround = false;
    }

    // integrate position (unified)
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    if(this.pos.y < 3.2) { this.pos.y = 3.2; if(this.vel.y < 0) this.vel.y = 0; this.onGround = true; }

    // --- Friendly assist: apply before integration ---
    let adjTorque = totalTorque.clone ? totalTorque.clone() : new Vec3(totalTorque.x, totalTorque.y, totalTorque.z);
    // copy to avoid mutating
    const torque = new Vec3(totalTorque.x, totalTorque.y, totalTorque.z);
    if(this.easyAssist && !this.onGround){
      // auto-level roll: gentle spring to 0 bank when stick near center
      const stickNeutral = Math.abs(this.controls.aileron) < 0.08 && Math.abs(this.controls.elevator) < 0.12;
      if(stickNeutral){
        // estimate bank from quat: roll angle approx
        const up = this.quat.rotateVector(new Vec3(0,1,0));
        const bank = Math.atan2(up.z, up.y); // ~ roll
        torque.x += -bank * 4200 * dt * 6; // leveling moment
        // pitch trim to 3 deg
        const fwd = this.quat.rotateVector(new Vec3(1,0,0));
        const pitch = Math.asin(Math.max(-1,Math.min(1,fwd.y)));
        const pitchErr = pitch - 0.052; // 3 deg
        torque.z += -pitchErr * 5600 * dt * 4;
      }
      // bank limit 32 deg: push back
      const up2 = this.quat.rotateVector(new Vec3(0,1,0));
      const bank2 = Math.atan2(up2.z, up2.y);
      if(Math.abs(bank2) > 32*Math.PI/180){
        const excess = Math.abs(bank2) - 32*Math.PI/180;
        torque.x += -Math.sign(bank2) * excess * 9000;
      }
    }

    // angular
    this.angAcc.x = torque.x * this.invInertia.x;
    this.angAcc.y = torque.y * this.invInertia.y;
    this.angAcc.z = torque.z * this.invInertia.z;

    // damping (aerodynamic damping) — friendly: extra pitch/roll damping
    const baseDamp = 0.14 + Math.abs(Vec3.len(this.vel))*0.0045;
    const assistDamp = this.easyAssist ? 0.18 : 0;
    this.angVel.x += this.angAcc.x*dt - this.angVel.x*(baseDamp+assistDamp+0.12)*dt;
    this.angVel.y += this.angAcc.y*dt - this.angVel.y*baseDamp*dt;
    this.angVel.z += this.angAcc.z*dt - this.angVel.z*(baseDamp+assistDamp)*dt;

    // clamp insane rates (bug fix)
    const maxRate = 2.2; // rad/s ~126 deg/s
    this.angVel.x = Math.max(-maxRate, Math.min(maxRate, this.angVel.x));
    this.angVel.y = Math.max(-maxRate, Math.min(maxRate, this.angVel.y));
    this.angVel.z = Math.max(-maxRate, Math.min(maxRate, this.angVel.z));

    // integrate quaternion: q += 0.5 * q * ω * dt
    const q = this.quat;
    const wx=this.angVel.x, wy=this.angVel.y, wz=this.angVel.z;
    const qx=q.x, qy=q.y, qz=q.z, qw=q.w;
    const nqx = qx + dt*0.5*( qw*wx + qy*wz - qz*wy);
    const nqy = qy + dt*0.5*( qw*wy - qx*wz + qz*wx);
    const nqz = qz + dt*0.5*( qw*wz + qx*wy - qy*wx);
    const nqw = qw + dt*0.5*(-qx*wx - qy*wy - qz*wz);
    this.quat = new Quat(nqx,nqy,nqz,nqw).normalize();

    // telemetry
    this.tas = Vec3.len(this.vel);
    const rho = this.bet.compute(this.pos, this.vel, this.angVel, this.quat, this.controls, this.controls.throttle, 0).rho; // cheap reuse? approximate
    this.ias = this.tas * Math.sqrt(rho/1.225);
    this.vs = this.vel.y;
    this.alt = this.pos.y;
    // approximate AoA from velocity vs body forward
    const fwd = this.quat.rotateVector(new Vec3(1,0,0));
    const vN = Vec3.normalize(this.vel.clone());
    const dot = Vec3.dot(fwd, vN);
    this.aoa = Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI * Math.sign(Vec3.dot(this.quat.rotateVector(new Vec3(0,1,0)), this.vel));
    this.gForce = 1 - this.acc.y/EngineConfig.physics.gravity; // approximate
    this.heading = (Math.atan2(this.vel.x, this.vel.z)*180/Math.PI+360)%360;
    // slip ball
    const bodyVel = this.worldToBody(this.vel);
    this.slip = Math.atan2(bodyVel.z, Math.hypot(bodyVel.x, bodyVel.y)) * 180/Math.PI;

    // stall detection via BET Cl
    this.stalled = Math.abs(this.aoa) > 15.5 && this.ias < 42;
  }

  private worldToBody(v: Vec3): Vec3 {
    // inverse rotate by quat
    const q = this.quat; const iq = new Quat(-q.x,-q.y,-q.z,q.w);
    return iq.rotateVector(v);
  }

  getMatrix(): Float32Array {
    const m = this.quat.toMatrix();
    const out = new Float32Array(16);
    Mat4.translate(m as unknown as Float32Array, this.pos, out);
    return out;
  }

  reset(pos?: Vec3) {
    if(pos) this.pos = pos.clone();
    else this.pos = new Vec3(0,1350,0);
    this.vel = new Vec3(64,0.6,0);
    this.quat = Quat.fromEuler(0.045,0,0);
    this.angVel = new Vec3();
    this.controls = { aileron:0, elevator:0.02, rudder:0, flaps:0, throttle:0.68, brake:0, gear:1 };
  }
}
