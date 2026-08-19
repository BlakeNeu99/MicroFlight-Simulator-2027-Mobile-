/**
 * Math3D — SIMD-friendly vector/matrix library for mobile silicon (ARM NEON/WASM)
 * Inspired by Vulkan's column-major convention. Zero allocations in hot paths.
 */

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static add(a: Vec3, b: Vec3, out = new Vec3()): Vec3 { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; }
  static sub(a: Vec3, b: Vec3, out = new Vec3()): Vec3 { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
  static scale(v: Vec3, s: number, out = new Vec3()): Vec3 { out.x = v.x * s; out.y = v.y * s; out.z = v.z * s; return out; }
  static dot(a: Vec3, b: Vec3): number { return a.x*b.x + a.y*b.y + a.z*b.z; }
  static cross(a: Vec3, b: Vec3, out = new Vec3()): Vec3 {
    out.x = a.y*b.z - a.z*b.y; out.y = a.z*b.x - a.x*b.z; out.z = a.x*b.y - a.y*b.x; return out;
  }
  static len(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }
  static normalize(v: Vec3, out = new Vec3()): Vec3 {
    const l = Vec3.len(v) || 1; out.x = v.x/l; out.y = v.y/l; out.z = v.z/l; return out;
  }
  static lerp(a: Vec3, b: Vec3, t: number, out = new Vec3()): Vec3 {
    out.x = a.x + (b.x - a.x)*t; out.y = a.y + (b.y - a.y)*t; out.z = a.z + (b.z - a.z)*t; return out;
  }
  clone() { return new Vec3(this.x, this.y, this.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length()||1; this.x/=l; this.y/=l; this.z/=l; return this; }
  toArray() { return [this.x, this.y, this.z] as const; }
}

export class Quat {
  constructor(public x=0, public y=0, public z=0, public w=1) {}
  static fromEuler(pitch: number, yaw: number, roll: number): Quat {
    const cy = Math.cos(yaw*0.5), sy = Math.sin(yaw*0.5);
    const cp = Math.cos(pitch*0.5), sp = Math.sin(pitch*0.5);
    const cr = Math.cos(roll*0.5), sr = Math.sin(roll*0.5);
    return new Quat(
      sr*cp*cy - cr*sp*sy,
      cr*sp*cy + sr*cp*sy,
      cr*cp*sy - sr*sp*cy,
      cr*cp*cy + sr*sp*sy
    );
  }
  multiply(q: Quat): Quat {
    return new Quat(
      this.w*q.x + this.x*q.w + this.y*q.z - this.z*q.y,
      this.w*q.y - this.x*q.z + this.y*q.w + this.z*q.x,
      this.w*q.z + this.x*q.y - this.y*q.x + this.z*q.w,
      this.w*q.w - this.x*q.x - this.y*q.y - this.z*q.z
    );
  }
  normalize(): Quat { const l = Math.hypot(this.x,this.y,this.z,this.w)||1; this.x/=l; this.y/=l; this.z/=l; this.w/=l; return this; }
  toMatrix(out = new Float32Array(16)): Float32Array {
    const x=this.x,y=this.y,z=this.z,w=this.w;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2;
    out[0]=1-(yy+zz); out[1]=xy+wz; out[2]=xz-wy; out[3]=0;
    out[4]=xy-wz; out[5]=1-(xx+zz); out[6]=yz+wx; out[7]=0;
    out[8]=xz+wy; out[9]=yz-wx; out[10]=1-(xx+yy); out[11]=0;
    out[12]=0; out[13]=0; out[14]=0; out[15]=1;
    return out;
  }
  rotateVector(v: Vec3, out=new Vec3()): Vec3 {
    const qx=this.x, qy=this.y, qz=this.z, qw=this.w;
    const vx=v.x, vy=v.y, vz=v.z;
    const tx = 2*(qy*vz - qz*vy);
    const ty = 2*(qz*vx - qx*vz);
    const tz = 2*(qx*vy - qy*vx);
    out.x = vx + qw*tx + qy*tz - qz*ty;
    out.y = vy + qw*ty + qz*tx - qx*tz;
    out.z = vz + qw*tz + qx*ty - qy*tx;
    return out;
  }
}

export class Mat4 {
  data = new Float32Array(16);
  constructor() { this.identity(); }
  identity(): Mat4 { this.data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return this; }
  static perspective(fov: number, aspect: number, near: number, far: number, out = new Float32Array(16)): Float32Array {
    const f = 1/Math.tan(fov*0.5), nf = 1/(near-far);
    out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0;
    return out;
  }
  static lookAt(eye: Vec3, center: Vec3, up: Vec3, out = new Float32Array(16)): Float32Array {
    const fx = center.x-eye.x, fy=center.y-eye.y, fz=center.z-eye.z;
    let rlf = 1/Math.hypot(fx,fy,fz); const fxn=fx*rlf, fyn=fy*rlf, fzn=fz*rlf;
    const sx = fyn*up.z - fzn*up.y, sy = fzn*up.x - fxn*up.z, sz = fxn*up.y - fyn*up.x;
    let rls = 1/Math.hypot(sx,sy,sz); const sxn=sx*rls, syn=sy*rls, szn=sz*rls;
    const uxn = syn*fzn - szn*fyn, uyn = szn*fxn - sxn*fzn, uzn = sxn*fyn - syn*fxn;
    out[0]=sxn; out[1]=uxn; out[2]=-fxn; out[3]=0;
    out[4]=syn; out[5]=uyn; out[6]=-fyn; out[7]=0;
    out[8]=szn; out[9]=uzn; out[10]=-fzn; out[11]=0;
    out[12]=-(sxn*eye.x+syn*eye.y+szn*eye.z);
    out[13]=-(uxn*eye.x+uyn*eye.y+uzn*eye.z);
    out[14]=fxn*eye.x+fyn*eye.y+fzn*eye.z;
    out[15]=1;
    return out;
  }
  static multiply(a: Float32Array, b: Float32Array, out = new Float32Array(16)): Float32Array {
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) {
      out[i*4+j]=a[i*4+0]*b[0*4+j]+a[i*4+1]*b[1*4+j]+a[i*4+2]*b[2*4+j]+a[i*4+3]*b[3*4+j];
    }
    return out;
  }
  static translate(m: Float32Array, v: Vec3, out = new Float32Array(16)): Float32Array {
    out.set(m); out[12]=m[0]*v.x+m[4]*v.y+m[8]*v.z+m[12];
    out[13]=m[1]*v.x+m[5]*v.y+m[9]*v.z+m[13];
    out[14]=m[2]*v.x+m[6]*v.y+m[10]*v.z+m[14];
    out[15]=m[3]*v.x+m[7]*v.y+m[11]*v.z+m[15]; return out;
  }
}
