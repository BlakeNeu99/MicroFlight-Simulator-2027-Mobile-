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

    // angular
    this.angAcc.x = totalTorque.x * this.invInertia.x;
    this.angAcc.y = totalTorque.y * this.invInertia.y;
    this.angAcc.z = totalTorque.z * this.invInertia.z;

    // damping (aerodynamic damping)
    const damp = 0.12 + Math.abs(Vec3.len(this.vel))*0.004;
    this.angVel.x += this.angAcc.x*dt - this.angVel.x*damp*dt;
    this.angVel.y += this.angAcc.y*dt - this.angVel.y*damp*dt;
    this.angVel.z += this.angAcc.z*dt - this.angVel.z*damp*dt;

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
    else this.pos = new Vec3(0,1200,0);
    this.vel = new Vec3(62,0,0);
    this.quat = Quat.fromEuler(0,0,0);
    this.angVel = new Vec3();
  }
}
