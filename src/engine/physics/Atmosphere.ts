import { Vec3 } from '../core/Math3D';
import { EngineConfig } from '../core/Config';

/**
 * ISA Atmosphere + dynamic weather field
 * Provides air density, temperature, pressure, wind vectors at any point
 */

export class Atmosphere {
  // ISA constants
  private readonly T0 = 288.15; // K
  private readonly P0 = 101325; // Pa
  private readonly L = 0.0065; // lapse rate K/m
  private readonly R = 287.05;
  private readonly g = EngineConfig.physics.gravity;

  getDensity(altitude: number): number {
    const h = Math.max(0, Math.min(25000, altitude));
    if (h < 11000) {
      const T = this.T0 - this.L * h;
      const P = this.P0 * Math.pow(T / this.T0, this.g / (this.L * this.R));
      return P / (this.R * T);
    } else {
      const T = 216.65;
      const P = 22632 * Math.exp(-this.g * (h - 11000) / (this.R * T));
      return P / (this.R * T);
    }
  }

  getTemperature(alt: number): number {
    return alt < 11000 ? this.T0 - this.L*alt : 216.65;
  }

  speedOfSound(alt: number): number {
    const T = this.getTemperature(alt);
    return Math.sqrt(1.4 * this.R * T);
  }
}

export interface WindSample { velocity: Vec3; turbulence: number; }

export class WeatherField {
  // Microburst and thermal column definitions
  private microbursts: { center: Vec3; radius: number; strength: number; altitude: number }[] = [];
  private thermals: { center: Vec3; radius: number; lift: number; top: number }[] = [];
  private globalWind = new Vec3(5, 0, 0); // 5 m/s westerly base
  private time = 0;

  constructor() {
    // seed microbursts and thermals
    this.microbursts = [
      { center: new Vec3(2000, 0, 1500), radius: 600, strength: 18, altitude: 1200 },
      { center: new Vec3(-3000, 0, -2000), radius: 450, strength: 14, altitude: 1000 },
    ];
    this.thermals = [
      { center: new Vec3(800, 0, 1200), radius: 400, lift: 6, top: 2500 },
      { center: new Vec3(-1200, 0, 2500), radius: 550, lift: 8, top: 3000 },
      { center: new Vec3(3500, 0, -800), radius: 500, lift: 7, top: 2200 },
    ];
  }

  update(dt: number, alt: number) {
    this.time += dt;
    // subtle global wind evolution with altitude shear
    const shear = Math.min(1, alt / 3000) * 4;
    this.globalWind.x = 5 + Math.sin(this.time*0.03)*3 + shear;
    this.globalWind.z = Math.cos(this.time*0.02)*2;
  }

  sample(pos: Vec3, alt: number): WindSample {
    const out = new Vec3(this.globalWind.x, this.globalWind.y, this.globalWind.z);
    let turb = 0;

    // altitude-dependent turbulence (Perlin-like)
    const highAltTurb = Math.max(0, (alt - 800)/4000) * 2.5;
    turb += highAltTurb * (0.5 + 0.5*Math.sin(pos.x*0.001 + this.time*0.7) * Math.cos(pos.z*0.0013 + this.time*0.5));

    // microburst: strong divergent outflow near ground + downdraft core
    for (const mb of this.microbursts) {
      const dx = pos.x - mb.center.x, dz = pos.z - mb.center.z;
      const dist = Math.hypot(dx, dz);
      if (dist < mb.radius*1.8 && alt < mb.altitude) {
        const radial = Math.max(0, 1 - dist / mb.radius);
        const vertFactor = Math.max(0, 1 - alt / mb.altitude);
        // downdraft at center
        const down = mb.strength * radial * 0.7;
        out.y -= down * (1 - vertFactor*0.3);
        // outflow near ground
        if (dist > 40) {
          const outflow = mb.strength * (1-vertFactor) * radial * 0.9;
          const inv = 1/Math.max(40, dist);
          out.x += dx * inv * outflow;
          out.z += dz * inv * outflow;
        }
        turb += radial * 3.5;
      }
    }

    // thermal columns: buoyant updraft with toroidal circulation
    for (const th of this.thermals) {
      const dx = pos.x - th.center.x, dz = pos.z - th.center.z;
      const dist = Math.hypot(dx, dz);
      if (dist < th.radius && alt > 50 && alt < th.top) {
        const rFactor = 1 - dist/th.radius;
        const hFactor = Math.sin(Math.PI * (alt-50)/(th.top-50)); // strongest mid-column
        const lift = th.lift * rFactor * hFactor;
        out.y += lift;
        // inflow at base, outflow at top
        const circulation = (alt < th.top*0.5 ? -1 : 1) * 1.5 * rFactor;
        if (dist > 15) {
          const inv = 1/dist;
          out.x += -dx*inv*circulation;
          out.z += -dz*inv*circulation;
        }
        turb += rFactor * 1.2;
      }
    }

    // small-scale noise
    out.x += Math.sin(pos.z*0.005 + this.time*0.6)*0.6;
    out.z += Math.cos(pos.x*0.005 + this.time*0.7)*0.6;
    out.y += Math.sin(pos.x*0.003 + pos.z*0.002 + this.time)*0.3;

    return { velocity: out, turbulence: turb };
  }

  getMETAR(alt: number): string {
    const spd = Math.hypot(this.globalWind.x, this.globalWind.z);
    const dir = (Math.atan2(this.globalWind.x, this.globalWind.z)*180/Math.PI + 360)%360;
    return `METAR MF27 ${Math.round(dir).toString().padStart(3,'0')}${Math.round(spd*1.943).toString().padStart(2,'0')}KT 9999 FEW040 ${Math.round(this.getTempAtAlt(alt))}°C QNH1013 TURB ${this.sample(new Vec3(0,alt,0),alt).turbulence.toFixed(1)}`;
  }
  private getTempAtAlt(alt:number){ return 15 - 0.0065*alt; }
}
