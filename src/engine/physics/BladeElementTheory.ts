import { Vec3, Quat } from '../core/Math3D';
import { EngineConfig, AircraftSpecs } from '../core/Config';
import { Atmosphere, WeatherField } from './Atmosphere';

/**
 * Blade Element Theory Aerodynamics
 * Each lifting surface is discretized into spanwise elements.
 * For each element: compute local airflow, AoA, CL/CD, forces, moments.
 * Surpasses lookup-table models (X-Plane style is BET variant, we go full BET with viscous + compressibility + ground effect)
 */

export interface BladeElement {
  // local geometry
  pos: Vec3; // relative to CG
  chord: number;
  spanWidth: number;
  twistRad: number;
  dihedralRad: number;
  // control
  flapFrac: number; // 0..1 for flaps deflection influence
  aileronFrac: number; // -1..1
}

export interface AeroForce {
  force: Vec3;
  torque: Vec3;
  lift: number; drag: number;
  aoaDeg: number;
  cl: number; cd: number;
}

export class BladeElementTheory {
  private elements: BladeElement[] = [];
  private atmosphere = new Atmosphere();
  private weather: WeatherField;
  private spec = AircraftSpecs['MF-27 Sparrow'];
  private time = 0;

  constructor(weather: WeatherField) {
    this.weather = weather;
    this.buildWing();
  }

  private buildWing() {
    const n = EngineConfig.physics.bladeElementsPerWing;
    const halfSpan = this.spec.wingSpan*0.5;
    const rootChord = this.spec.chordRoot;
    const tipChord = this.spec.chordTip;
    const twist = this.spec.wingTwistDeg * Math.PI/180;
    const dihedral = this.spec.dihedralDeg * Math.PI/180;

    const makeHalf = (sign: number) => {
      for(let i=0;i<n;i++) {
        const yFrac0 = i/n, yFrac1=(i+1)/n;
        const yMid = (yFrac0+yFrac1)*0.5*halfSpan*sign;
        const localChord = rootChord + (tipChord-rootChord)*(Math.abs(yMid)/halfSpan);
        const w = halfSpan / n;
        // twist washes out toward tip
        const localTwist = twist * (Math.abs(yMid)/halfSpan);
        // chordwise position ~25% MAC
        const x = -0.15 + (localChord*0.25);
        const z = Math.abs(yMid) * Math.sin(dihedral) * (sign>0?1:-1)*0.15; // slight dihedral rise
        this.elements.push({
          pos: new Vec3(x, yMid, z),
          chord: localChord,
          spanWidth: w,
          twistRad: localTwist,
          dihedralRad: dihedral * Math.sign(yMid || sign),
          flapFrac: Math.abs(yMid) < halfSpan*0.45 ? 1 : 0, // inboard flaps
          aileronFrac: Math.abs(yMid) > halfSpan*0.45 ? sign : 0, // outboard ailerons with sign
        });
      }
    };
    makeHalf(1);
    makeHalf(-1);

    // horizontal tail (2 elements per side)
    const tailSpan=3.2, tailChord=0.9;
    for(const s of [1,-1]) {
      this.elements.push({
        pos: new Vec3(-4.8, s*tailSpan*0.3, 0.2),
        chord: tailChord, spanWidth: tailSpan*0.5,
        twistRad: 0, dihedralRad: 0,
        flapFrac: 0, aileronFrac: 0
      });
    }
    // vertical tail
    this.elements.push({
      pos: new Vec3(-4.6, 0, 0.85),
      chord: 1.1, spanWidth: 1.6,
      twistRad: 0, dihedralRad: Math.PI/2,
      flapFrac: 0, aileronFrac: 0
    });
  }

  compute(
    pos: Vec3, vel: Vec3, angVel: Vec3, quat: Quat,
    controls: { aileron: number; elevator: number; rudder: number; flaps: number },
    throttle: number, dt: number
  ): { totalForce: Vec3; totalTorque: Vec3; elements: AeroForce[]; rho: number } {
    this.time += dt;
    const alt = Math.max(0, pos.y);
    const rho = this.atmosphere.getDensity(alt);
    const wind = this.weather.sample(pos, alt).velocity;

    const totalForce = new Vec3();
    const totalTorque = new Vec3();
    const results: AeroForce[] = [];

    const speed = Vec3.len(vel);
    const q = quat;

    // dynamic pressure helper
    // for each element
    for(const el of this.elements) {
      // world position of element
      const rWorld = q.rotateVector(el.pos);
      // local velocity = aircraft vel + angular cross r - wind
      // angular contribution: ω × r
      const angCross = new Vec3(
        angVel.y * rWorld.z - angVel.z * rWorld.y,
        angVel.z * rWorld.x - angVel.x * rWorld.z,
        angVel.x * rWorld.y - angVel.y * rWorld.x
      );
      const vLocal = new Vec3(vel.x + angCross.x - wind.x, vel.y + angCross.y - wind.y, vel.z + angCross.z - wind.z);
      // rotate into body-relative wind axes? simplify: body frame velocity
      const vBody = q.rotateVector(new Vec3(0,0,0)); // placeholder keep world
      // Transform vLocal into element's local aerodynamic frame: we approximate using world but twist changes AoA
      const vMag = Vec3.len(vLocal);
      if(vMag < 0.8) { results.push({ force:new Vec3(), torque:new Vec3(), lift:0, drag:0, aoaDeg:0, cl:0, cd:0 }); continue; }

      // Angle of attack: angle between chord line and airflow projected onto element's lift plane
      // Simplify: AoA ≈ atan2(-vLocal.y , vLocal.x) + twist + control deflections + wing incidence
      const wingIncidence = 2.8 * Math.PI/180;
      let baseAoA = Math.atan2(-vLocal.y, Math.hypot(vLocal.x, vLocal.z));
      baseAoA += el.twistRad + wingIncidence;
      // control surface delta CL via effective camber change
      const flapDelta = controls.flaps * el.flapFrac * (12*Math.PI/180); // up to 12 deg effective
      const aileronDelta = controls.aileron * (el.aileronFrac!==0? Math.sign(el.aileronFrac):0) * (10*Math.PI/180);
      const elevatorDelta = Math.abs(el.pos.x +4.8) < 0.3 ? controls.elevator * (8*Math.PI/180) : 0;
      const rudderDelta = Math.abs(el.pos.z -0.85)<0.2 && Math.abs(el.pos.y)<0.2 ? controls.rudder * (15*Math.PI/180) : 0;
      const controlAoA = flapDelta + aileronDelta + elevatorDelta + rudderDelta;
      const aoa = baseAoA + controlAoA;

      // Lift curve with stall - more realistic than linear
      const aoaDeg = aoa*180/Math.PI;
      let cl: number;
      if(Math.abs(aoaDeg) < 14) {
        cl = 0.22 + 0.11 * aoaDeg + flapDelta*1.2; // linear + flap increment
        // add mild compressibility correction
        const mach = vMag / this.atmosphere.speedOfSound(alt);
        const beta = Math.sqrt(Math.max(0.15, 1 - mach*mach));
        cl /= beta;
      } else {
        // post-stall: flat plate + exponential decay
        const stallCl = 0.22 + 0.11*14;
        const stallDeg = 14;
        const beyond = Math.abs(aoaDeg)-stallDeg;
        const sign = Math.sign(aoaDeg);
        cl = sign * (stallCl * Math.exp(-beyond*0.09) + 0.35*Math.sin(2*(aoaDeg-stallDeg)*Math.PI/180));
        // buffeting
        cl += Math.sin(this.time*22 + el.pos.y*2)*0.05*beyond/10;
      }

      // Induced drag + profile drag
      const ar = this.spec.wingSpan*this.spec.wingSpan / this.spec.wingArea; // aspect ratio ~6.4
      const oswald = 0.82;
      let cdInduced = (cl*cl)/(Math.PI*ar*oswald);
      const cd0 = 0.022 + Math.abs(flapDelta)*0.04 + (speed>60?0.008:0) ; // profile + flap
      let cd = cd0 + cdInduced;
      // vertical tail/ rudder adds drag when deflected
      if(rudderDelta!==0) cd += Math.abs(rudderDelta)*0.12;

      // ground effect: within 1 wingspan of ground, increase lift and reduce induced drag
      let groundFactorLift = 1, groundFactorDrag = 1;
      if(alt < this.spec.wingSpan*1.4) {
        const h = Math.max(0.35, alt) / this.spec.wingSpan;
        const ge = 1 - Math.exp(- (1/h -1) * 0.18);
        groundFactorLift = 1 + ge*0.24; // up to 24% more lift
        groundFactorDrag = 1 - ge*0.32; // up to 32% less induced drag
        cdInduced *= groundFactorDrag;
        cd = cd0 + cdInduced;
        cl *= groundFactorLift;
      }

      const dyn = 0.5*rho*vMag*vMag;
      const liftMag = dyn * el.chord * el.spanWidth * cl;
      const dragMag = dyn * el.chord * el.spanWidth * cd;

      // Directions: drag opposite to velocity, lift perpendicular (approx world up corrected)
      const dragDir = new Vec3(-vLocal.x/vMag, -vLocal.y/vMag, -vLocal.z/vMag);
      // lift direction = up cross away from drag, approx world up projected perpendicular to drag
      // Build lift dir as (worldUp - (worldUp·dragDir)dragDir) normalized
      const worldUp = new Vec3(0,1,0);
      const upDot = Vec3.dot(worldUp, dragDir);
      const liftDirRaw = new Vec3(worldUp.x - upDot*dragDir.x, worldUp.y - upDot*dragDir.y, worldUp.z - upDot*dragDir.z);
      const liftDir = Vec3.len(liftDirRaw) > 1e-6 ? Vec3.normalize(liftDirRaw) : new Vec3(0,1,0);
      // Flip lift if AoA negative
      if(aoa < 0) { liftDir.x*=-1; liftDir.y*=-1; liftDir.z*=-1; }

      const lift = Vec3.scale(liftDir, Math.abs(liftMag));
      // correct sign
      if(cl < 0) Vec3.scale(lift, -1, lift);
      const drag = Vec3.scale(dragDir, dragMag);
      const force = Vec3.add(lift, drag, new Vec3());

      // torque = r × F
      const torque = Vec3.cross(rWorld, force, new Vec3());

      Vec3.add(totalForce, force, totalForce);
      Vec3.add(totalTorque, torque, totalTorque);
      results.push({ force, torque, lift: liftMag, drag: dragMag, aoaDeg, cl, cd });
    }

    // Propulsion: simple propeller thrust model P = thrust * v  => thrust = power * eta / v
    const eta = 0.82 - Math.max(0, (speed-55)/240) ;
    const power = throttle * this.spec.enginePower;
    let thrustMag = 0;
    if(speed < 2) thrustMag = throttle * 3200;
    else thrustMag = Math.max(0, power * Math.max(0.25, eta) / Math.max(5, speed));
    // add propwash over inboard wing? boost lift 4%
    const thrustDir = q.rotateVector(new Vec3(1,0,0));
    const thrust = Vec3.scale(thrustDir, thrustMag);
    Vec3.add(totalForce, thrust, totalForce);
    // torque from p-factor at high AoA
    const pFactorTorque = new Vec3(0,0, throttle * 120 * Math.sin(controls.elevator*0.5));
    Vec3.add(totalTorque, pFactorTorque, totalTorque);

    // Gravity in world frame
    const weight = new Vec3(0, -this.spec.mass * EngineConfig.physics.gravity, 0);
    Vec3.add(totalForce, weight, totalForce);

    return { totalForce, totalTorque, elements: results, rho };
  }

  get wingElements() { return this.elements.length; }
}
