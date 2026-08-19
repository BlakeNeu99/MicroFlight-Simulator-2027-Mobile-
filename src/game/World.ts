import { Vec3 } from '../engine/core/Math3D';

export class World {
  // World origin is at 0,0,0 with infinite procedural terrain
  // Provides navigation aids, runways, waypoints
  runways = [
    { id:'MF27-09', pos: new Vec3(0, 3.2, 0), heading: 90, length: 1800, width: 45 },
    { id:'MF27-27', pos: new Vec3(0, 3.2, 0), heading: 270, length: 1800, width: 45 },
    { id:'MF27-X', pos: new Vec3(4200, 185, 3100), heading: 34, length: 1200, width: 32 },
  ];
  thermals: Vec3[] = [];
  microbursts: Vec3[] = [];
  waypoints = [
    { name:'SPARROW FIELD', pos: new Vec3(0,0,0) },
    { name:'RIDGE PEAK', pos: new Vec3(3200,0,4200) },
    { name:'COASTAL', pos: new Vec3(-5800,0,-3100) },
  ];
}
