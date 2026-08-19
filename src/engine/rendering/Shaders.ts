/** GLSL shaders — Vulkan/Metal-inspired: explicit bindings, push constants via UBOs */

export const Shaders = {
  terrainVertex: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUV;
layout(location=2) in float aTileScale;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uTime;
out vec2 vUV;
out vec3 vWorld;
out float vHeight;
out vec3 vNormal;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; }
  return v;
}

void main(){
  vec2 uv = aUV;
  vec3 pos = aPosition;
  // procedural height: continent + mountains + detail
  float h = 0.0;
  h += fbm(uv*1.5)* 1200.0;
  h += fbm(uv*4.0)* 300.0;
  h += fbm(uv*12.0)* 45.0;
  // ridge for drama
  float ridge = pow(1.0-abs(noise(uv*0.7)*2.0-1.0),3.0)*800.0;
  h += ridge;
  // carve rivers
  float river = smoothstep(0.0,0.08, abs(fract(uv.y*2.4)-0.5));
  h *= mix(0.7,1.0, river);
  pos.y = h;
  // normal approximation
  float e = 0.01;
  float hx1 = fbm((uv+vec2(e,0.0))*1.5)*1200.0;
  float hx2 = fbm((uv+vec2(0.0,e))*1.5)*1200.0;
  vec3 n = normalize(vec3(h-hx1, 15.0, h-hx2));
  vNormal = n;
  vHeight = h;
  vUV = uv;
  vWorld = pos;
  gl_Position = uViewProj * vec4(pos,1.0);
}
`,

  terrainFragment: `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorld;
in float vHeight;
in vec3 vNormal;
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
out vec4 fragColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

vec3 palette(float h){
  vec3 snow = vec3(0.96,0.97,0.98);
  vec3 rock = vec3(0.45,0.38,0.34);
  vec3 grass = vec3(0.22,0.44,0.18);
  vec3 forest = vec3(0.12,0.28,0.14);
  vec3 sand = vec3(0.76,0.69,0.48);
  vec3 water = vec3(0.08,0.22,0.42);
  if(h < 5.0) return mix(water, sand, smoothstep(0.0,5.0,h));
  if(h < 35.0) return mix(sand, grass, smoothstep(5.0,35.0,h));
  if(h < 250.0) return mix(grass, forest, smoothstep(35.0,250.0,h));
  if(h < 900.0) return mix(forest, rock, smoothstep(250.0,900.0,h));
  return mix(rock, snow, smoothstep(900.0,1400.0,h));
}

void main(){
  vec3 base = palette(vHeight);
  // slope darkening
  float slope = 1.0 - vNormal.y;
  base *= 1.0 - slope*0.32;
  // photoreal micro-detail via hash as albedo variation
  float detail = hash(vWorld.xz*0.02)*0.12;
  base += detail - 0.06;
  // PBR-like lighting
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  float NdotL = max(0.0, dot(N,L));
  float diff = NdotL * 0.95 + 0.05;
  // ambient from sky
  vec3 ambient = vec3(0.42,0.59,0.84)*0.35;
  // specular helper (water sheen)
  float spec = 0.0;
  if(vHeight < 8.0) spec = pow(max(0.0, dot(reflect(-L,N), normalize(uCameraPos - vWorld))), 48.0)*0.7;
  vec3 color = base * (diff + ambient) + spec;
  // aerial perspective (altitude haze)
  float dist = length(vWorld - uCameraPos);
  float haze = 1.0 - exp(-dist * 0.00014);
  vec3 sky = vec3(0.58,0.75,0.96);
  color = mix(color, sky, haze*0.65);
  // distance desaturate slightly
  fragColor = vec4(color,1.0);
}
`,

  cloudVertex: `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCameraPos;
uniform float uTime;
out vec2 vUV;
out vec3 vRay;
void main(){
  vUV = aQuad*0.5+0.5;
  // full-screen quad ray
  vec2 ndc = aQuad;
  vec4 clip = vec4(ndc, 0.0, 1.0);
  // will be expanded in fragment via inverse VP
  vRay = vec3(ndc, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`,

  cloudFragment: `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vRay;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCoverage;
out vec4 fragColor;

float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x), f=fract(x);
  f=f*f*(3.0-2.0*f);
  float n = mix(
    mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm(vec3 p){
  float v=0.0; float a=0.5;
  for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0; a*=0.5; }
  return v;
}
float cloudDensity(vec3 p){
  // base layer at 1800-3200m
  float h = p.y;
  float heightGrad = smoothstep(1600.0, 1800.0, h) * (1.0 - smoothstep(3000.0, 3400.0, h));
  if(heightGrad < 0.01) return 0.0;
  // world tiling with wind advection
  vec3 q = p*0.00055 + vec3(uTime*0.015, 0.0, uTime*0.008);
  float n = fbm(q*1.0);
  n += 0.5 * fbm(q*2.1);
  // coverage control
  float c = smoothstep(0.35, 0.62, n) * heightGrad;
  c *= mix(0.35, 1.0, uCoverage);
  return c;
}
void main(){
  // reconstruct world ray
  vec4 clip = vec4(vRay.xy, 0.0, 1.0);
  vec4 worldH = uInvViewProj * vec4(clip.xy, 0.0, 1.0);
  worldH /= worldH.w;
  vec3 rayDir = normalize(worldH.xyz - uCameraPos);
  // raymarch clouds
  vec3 ro = uCameraPos;
  // only march if looking not too down
  if(rayDir.y < -0.15){ fragColor = vec4(0.0); return; }
  // intersect cloud layer
  float t0 = (1700.0 - ro.y)/ max(0.08, rayDir.y);
  float t1 = (3350.0 - ro.y)/ max(0.08, rayDir.y);
  if(t1 < 0.0 || t0 > 40000.0){ fragColor = vec4(0.0); return; }
  t0 = max(t0, 0.0);
  float marchDist = min(t1, 38000.0) - t0;
  if(marchDist <= 120.0){ fragColor = vec4(0.0); return; }
  int steps = 24;
  float stepSize = marchDist / float(steps);
  // adaptive jitter
  float jitter = hash(vec3(vUV, uTime))*stepSize;
  float t = t0 + jitter;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  vec3 sun = normalize(uSunDir);
  for(int i=0;i<24;i++){
    if(alpha > 0.92) break;
    vec3 p = ro + rayDir * t;
    float d = cloudDensity(p);
    if(d > 0.03){
      // lighting: Beer-Lambert + phase
      float light = 1.0;
      // cheap light march toward sun
      float lightD = 0.0;
      for(int j=0;j<4;j++){
        vec3 lp = p + sun * float(j)*180.0;
        lightD += cloudDensity(lp)*0.22;
      }
      light = exp(-lightD);
      float phase = 0.55 + 0.45*pow(max(0.0, dot(rayDir, sun)), 6.0);
      vec3 cloudCol = vec3(1.0,0.985,0.96) * (0.42 + 0.58*light*phase);
      // ambient
      cloudCol += vec3(0.35,0.48,0.72)*0.18;
      float a = d*0.18 * (1.0 - alpha);
      col += cloudCol * a;
      alpha += a * 0.9;
    }
    t += stepSize * (1.0 + d*0.35);
  }
  alpha = clamp(alpha, 0.0, 1.0);
  // horizon fade
  float horizonFade = smoothstep(0.0, 0.18, rayDir.y);
  alpha *= horizonFade;
  fragColor = vec4(col, alpha);
}
`,

  aircraftVertex: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
out vec3 vNormal;
out vec3 vWorld;
out vec2 vUV;
void main(){
  vec4 world = uModel * vec4(aPosition,1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vUV = aUV;
  gl_Position = uViewProj * world;
}
`,

  aircraftFragment: `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec2 vUV;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uBaseColor;
out vec4 fragColor;
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L+V);
  float NdotL = max(0.0, dot(N,L));
  float NdotV = max(0.0, dot(N,V));
  float NdotH = max(0.0, dot(N,H));
  // PBR approx: albedo, roughness, metallic
  vec3 albedo = uBaseColor;
  // livery stripe based on UV
  float stripe = step(0.34, vUV.y) * step(vUV.y, 0.46) * step(0.18, vUV.x);
  albedo = mix(albedo, vec3(0.92,0.14,0.18), stripe*0.9);
  float roughness = 0.42 - stripe*0.18;
  float metallic = 0.06;
  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  // Fresnel Schlick
  vec3 F = F0 + (1.0-F0)*pow(1.0-NdotV,5.0);
  float D = ( (roughness*roughness) / (3.14159 * pow( (NdotH*NdotH*(roughness*roughness-1.0)+1.0), 2.0)) );
  float G = 0.5 / ( NdotL*(1.0-roughness) + roughness);
  vec3 spec = D*F*G;
  vec3 kd = (1.0-F)*(1.0-metallic);
  vec3 diffuse = kd * albedo / 3.14159;
  vec3 color = (diffuse + spec) * NdotL;
  // ambient IBL approx
  vec3 ambient = albedo * vec3(0.28,0.34,0.48)*0.55;
  vec3 envSpec = mix(vec3(0.15), vec3(0.55,0.66,0.82), 0.4) * pow(NdotV, 1.8) * (1.0-roughness);
  color += ambient + envSpec*0.45;
  // sun rim
  float rim = pow(1.0 - NdotV, 3.0)*0.35;
  color += rim * vec3(0.9,0.85,0.7);
  fragColor = vec4(color,1.0);
}
`,

  fxaaFragment: `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform vec2 uTexel;
out vec4 fragColor;
void main(){
  vec3 rgbM = texture(uScene, vUV).rgb;
  // fast luma
  float lumaM = dot(rgbM, vec3(0.299,0.587,0.114));
  // sample neighbors
  vec3 rgbN = texture(uScene, vUV+vec2(0.0, uTexel.y)).rgb;
  vec3 rgbS = texture(uScene, vUV+vec2(0.0,-uTexel.y)).rgb;
  vec3 rgbE = texture(uScene, vUV+vec2(uTexel.x,0.0)).rgb;
  vec3 rgbW = texture(uScene, vUV+vec2(-uTexel.x,0.0)).rgb;
  float lumaN = dot(rgbN, vec3(0.299,0.587,0.114));
  float lumaS = dot(rgbS, vec3(0.299,0.587,0.114));
  float lumaE = dot(rgbE, vec3(0.299,0.587,0.114));
  float lumaW = dot(rgbW, vec3(0.299,0.587,0.114));
  float range = max(lumaM, max(max(lumaN,lumaS), max(lumaE,lumaW))) - min(lumaM, min(min(lumaN,lumaS), min(lumaE,lumaW)));
  if(range < 0.12){ fragColor = vec4(rgbM,1.0); return; }
  // FXAA
  vec2 dir = vec2( (lumaW + lumaE) - 2.0*lumaM, (lumaN + lumaS) - 2.0*lumaM );
  dir = normalize(dir + vec2(0.001));
  vec3 a = texture(uScene, vUV + dir*uTexel*0.5).rgb;
  vec3 b = texture(uScene, vUV - dir*uTexel*0.5).rgb;
  fragColor = vec4( (a+b + rgbM*2.0)/4.0, 1.0);
}
`,
  skyVertex: `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.999,1.0); }
`,
  skyFragment: `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uSunDir;
uniform vec3 uCameraPos;
uniform float uTime;
out vec4 fragColor;
void main(){
  vec2 uv = vUV;
  float y = uv.y;
  // gradient sky
  vec3 zenith = vec3(0.18,0.38,0.78);
  vec3 horizon = vec3(0.62,0.79,0.96);
  vec3 sky = mix(horizon, zenith, pow(y, 0.7));
  // sun disk
  vec3 sunDir = normalize(uSunDir);
  // approximate sun pos in sky quad
  vec2 sunUV = vec2(0.78, 0.78);
  float sunDist = length(uv - sunUV);
  float sun = smoothstep(0.14, 0.0, sunDist) * 1.0;
  float sunHalo = exp(-sunDist*9.0)*0.55;
  vec3 sunCol = vec3(1.0,0.97,0.88);
  sky = mix(sky, sunCol, sun*0.9 + sunHalo*0.32);
  // light scattering near horizon
  float horizonBloom = exp(-pow(y-0.08,2.0)*220.0)*0.35;
  sky += vec3(1.0,0.72,0.42)*horizonBloom;
  // add subtle star noise at top if viewing angle high? ignore
  fragColor = vec4(sky,1.0);
}
`,
  fullscreenVertex: `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }
`
};
