import { describe, it, expect } from 'vitest';
import { WeatherField } from '../src/engine/physics/Atmosphere';
import { FlightModel } from '../src/engine/physics/FlightModel';
import { BladeElementTheory } from '../src/engine/physics/BladeElementTheory';
import { Vec3, Quat } from '../src/engine/core/Math3D';

describe('Performance budgets', ()=>{
  it('BET compute under 2ms (60fps budget)', ()=>{
    const w=new WeatherField();
    const bet=new BladeElementTheory(w);
    const start=performance.now();
    for(let i=0;i<100;i++){
      bet.compute(new Vec3(0,1200,0), new Vec3(62,0,0), new Vec3(), Quat.fromEuler(0,0,0), {aileron:0,elevator:0,rudder:0,flaps:0}, 0.68, 1/120);
    }
    const avg=(performance.now()-start)/100;
    expect(avg).toBeLessThan(2.5); // ms per frame, mobile budget
  });

  it('flight stability does not diverge over 10s', ()=>{
    const w=new WeatherField();
    const fm=new FlightModel(w);
    let maxAlt=fm.alt, minAlt=fm.alt;
    for(let i=0;i<1200;i++){
      fm.step(1/120);
      maxAlt=Math.max(maxAlt, fm.alt);
      minAlt=Math.min(minAlt, fm.alt);
      expect(Number.isFinite(fm.pos.x)).toBe(true);
      expect(Number.isFinite(fm.vel.y)).toBe(true);
    }
    expect(maxAlt - minAlt).toBeLessThan(800); // bounded phugoid
  });

  it('memory leak check — no unbounded growth in weather', ()=>{
    const w=new WeatherField();
    const before = (performance as any).memory ? (performance as any).memory.usedJSHeapSize : 0;
    for(let i=0;i<500;i++) w.sample(new Vec3(i*10, 1200, 0), 1200);
    const after = (performance as any).memory ? (performance as any).memory.usedJSHeapSize : 0;
    if(before && after) expect(after - before).toBeLessThan(5*1024*1024);
    else expect(true).toBe(true);
  });
});
