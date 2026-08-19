import './styles.css';
import { MicroFlightApp } from './game/MicroFlight';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = new MicroFlightApp(canvas);

// DOM bindings
const $ = (id:string)=>document.getElementById(id)!;
const vIAS=$('vIAS'), vALT=$('vALT'), vVS=$('vVS'), vHDG=$('vHDG'), vG=$('vG'), vAOA=$('vAOA');
const vTHR=$('vTHR'), vFLP=$('vFLP'), vStall=$('vStall'), vWind=$('vWind'), vTiles=$('vTiles');
const vFT=$('vFT'), vDC=$('vDC'), vTR=$('vTR'), vLOD=$('vLOD'), barDC=$('barDC'), barTR=$('barTR');
const joyStick=$('joyStick'), joyArea=$('joyArea'), thrFill=$('thrFill'), thrKnob=$('thrKnob'), rudFill=$('rudFill');
const vAil=$('vAil'), vElev=$('vElev'), vRud=$('vRud'), vThr2=$('vThr2'), flapsLabel=$('flapsLabel');
const fpsBadge=$('fpsBadge'), horizon=$('horizon'), mapPlane=$('mapPlane'), mapCanvas=$('mapCanvas') as HTMLCanvasElement;
const toast=$('toast');
const onboard=$('onboard') as HTMLElement;
const chkEasy=document.getElementById('chkEasy') as HTMLInputElement;

let flapsIdx=0; const flapSteps=[0,0.33,0.66,1];
function showToast(msg:string){
  toast.textContent=msg; toast.style.opacity='1';
  setTimeout(()=> toast.style.opacity='0', 2400);
}
// onboarding — friendly first-run
let tutorialDismissed = localStorage.getItem('mf2027_tutorial')==='done';
if(tutorialDismissed) onboard.style.display='none';
else onboard.style.display='flex';
function dismissOnboard(){
  onboard.style.opacity='0'; onboard.style.pointerEvents='none';
  setTimeout(()=> onboard.style.display='none', 320);
  localStorage.setItem('mf2027_tutorial','done');
}
document.getElementById('btnHelpFly')?.addEventListener('click', ()=>{
  app.flight.easyAssist = chkEasy.checked;
  try{ navigator.vibrate?.(18);}catch{}
  dismissOnboard(); showToast(chkEasy.checked ? 'Easy assist ON — gentle & stable' : 'Realistic mode — full BET');
  app.audio.init();
});
document.getElementById('btnHelpSkip')?.addEventListener('click', ()=>{
  app.flight.easyAssist = chkEasy.checked;
  dismissOnboard(); showToast('Skipped — tap HELP in top bar to reopen');
});
// allow reopen via long-press on brand?
document.querySelector('.brand')?.addEventListener('dblclick', ()=>{
  onboard.style.display='flex'; setTimeout(()=> onboard.style.opacity='1',10);
});
// easy toggle live
chkEasy?.addEventListener('change', ()=>{ app.flight.easyAssist = chkEasy.checked; showToast(chkEasy.checked? 'Assist ON':'Assist OFF'); });

// help reopen
document.getElementById('btnHelp')?.addEventListener('click', ()=>{
  onboard.style.display='flex'; onboard.style.opacity='1'; onboard.style.pointerEvents='auto';
  showToast('Tutorial — pick Easy Assist then FLY NOW');
});
// buttons
$('btnReset').addEventListener('click', ()=>{ app.reset(); showToast('Position reset — Sparrow Field, 1350 m — 64 KIAS trimmed'); });
$('btnCamera').addEventListener('click', ()=>{ app.cycleCamera(); showToast(`Camera: ${app.camMode.toUpperCase()}`); });
$('btnPause').addEventListener('click', (e)=>{
  const btn=e.currentTarget as HTMLButtonElement;
  // toggle via running flag hack
  (app as any).running = !(app as any).running;
  btn.textContent = (app as any).running ? '⏸︎ PAUSE' : '▶︎ RESUME';
  if((app as any).running) app.frame(performance.now()/1000);
});
$('btnHaptics').addEventListener('click', ()=>{
  try{ navigator.vibrate?.(22); }catch{}
  showToast('Full thrust — rotate at 62 KIAS');
  app.input.setThrottle(1);
});
function cycleFlaps(){
  flapsIdx=(flapsIdx+1)%flapSteps.length;
  app.setFlaps(flapSteps[flapsIdx]);
  const deg = [0,10,22,35][flapsIdx];
  (document.getElementById('btnFlaps') as HTMLElement).textContent=`FLAPS ${Math.round(flapSteps[flapsIdx]*100)}%`;
  flapsLabel.textContent=`${deg}°`;
  showToast(`Flaps ${deg}° — lift +${(deg*0.9).toFixed(0)}% • drag +${(deg*1.3).toFixed(0)}%`);
}
$('btnFlaps').addEventListener('click', cycleFlaps);
$('btnFlaps2').addEventListener('click', cycleFlaps);
$('btnGear').addEventListener('click', ()=>{
  const g = app.flight.controls.gear;
  app.flight.controls.gear = g?0:1;
  (document.getElementById('btnGear') as HTMLElement).textContent = app.flight.controls.gear ? 'GEAR DN' : 'GEAR UP';
  $('btnGear2').style.opacity = app.flight.controls.gear ? '1' : '0.6';
  showToast(app.flight.controls.gear ? 'Gear down — drag ↑' : 'Gear up — clean');
});
$('btnGear2').addEventListener('click', ()=> $('btnGear').click());
$('btnBrake').addEventListener('pointerdown', ()=> app.flight.controls.brake=1);
$('btnBrake').addEventListener('pointerup', ()=> app.flight.controls.brake=0);
$('btnBrake2').addEventListener('pointerdown', ()=> app.flight.controls.brake=1);
$('btnBrake2').addEventListener('pointerup', ()=> app.flight.controls.brake=0);
$('btnTakeoff').addEventListener('click', ()=>{
  app.flight.controls.throttle=1;
  app.flight.controls.flaps=0.33;
  flapsIdx=1; flapsLabel.textContent='10°';
  showToast('Takeoff config — flaps 10°, full power');
  setTimeout(()=>{ app.flight.controls.elevator=0.42; setTimeout(()=> app.flight.controls.elevator=0.12, 900); }, 600);
});
$('btnWeather').addEventListener('click', (e)=>{
  const btn=e.currentTarget as HTMLButtonElement;
  const live = btn.textContent?.includes('LIVE');
  btn.textContent = live ? 'WEATHER: CALM' : 'WEATHER: LIVE';
  showToast(live ? 'Weather calm — turb 0.2' : 'Live weather — microbursts active');
});

// joystick visual
let joyX=0, joyY=0;
function updateJoyVisual(){
  const dx = app.flight.controls.aileron * 34;
  const dy = app.flight.controls.elevator * -34;
  joyStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joyArea.style.background = `radial-gradient(240px 180px at ${50+dx*0.6}% ${50+dy*0.6}%, rgba(0,212,255,0.14), transparent 68%), linear-gradient(180deg, #0b131e, #070c14)`;
}
function updateThrVisual(){
  const t = app.flight.controls.throttle;
  thrFill.style.height = `${Math.round(t*100)}%`;
  thrKnob.style.bottom = `${Math.round(t*100)}%`;
  const r = app.flight.controls.rudder;
  rudFill.style.left = `${50 + r*38 - 20}%`;
}

// throttle drag
let thrDragging=false;
const thrTrack = document.getElementById('thrTrack')!;
thrTrack.addEventListener('pointerdown', e=>{ thrDragging=true; (e.target as Element).setPointerCapture(e.pointerId); updateThr(e); });
window.addEventListener('pointermove', e=>{ if(thrDragging) updateThr(e); });
window.addEventListener('pointerup', ()=> thrDragging=false);
function updateThr(e:PointerEvent){
  const rect = thrTrack.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const frac = 1 - y/rect.height;
  app.input.setThrottle(Math.max(0, Math.min(1, frac)));
}

// rudder drag
const rudBar=document.getElementById('rudBar')!;
let rudDragging=false;
rudBar.addEventListener('pointerdown', e=>{ rudDragging=true; (rudBar as any).setPointerCapture?.(e.pointerId); updateRud(e); });
window.addEventListener('pointermove', e=>{ if(rudDragging) updateRud(e); });
window.addEventListener('pointerup', ()=> rudDragging=false);
function updateRud(e:PointerEvent){
  const r=rudBar.getBoundingClientRect();
  const x=e.clientX - r.left;
  const frac=(x/r.width -0.5)/0.42;
  app.flight.controls.rudder = Math.max(-1, Math.min(1, frac));
}

// map canvas 2D overlay
const mctx = mapCanvas.getContext('2d')!;
function drawMap(){
  const w=mapCanvas.width, h=mapCanvas.height;
  mctx.clearRect(0,0,w,h);
  // grid already via css, add runways + microbursts
  const pos=app.flight.pos;
  // center is aircraft
  const scale = 0.055; // world to map px
  // waypoints
  mctx.fillStyle='rgba(0,212,255,0.9)';
  mctx.strokeStyle='rgba(0,212,255,0.35)';
  // draw microburst zones
  const mbs=[{x:2000,z:1500,r:600},{x:-3000,z:-2000,r:450}];
  for(const mb of mbs){
    const mx = (mb.x - pos.x)*scale + w/2;
    const mz = (mb.z - pos.z)*scale + h/2;
    const rr = mb.r*scale;
    mctx.beginPath(); mctx.arc(mx,mz,rr,0,Math.PI*2);
    mctx.fillStyle='rgba(231,76,60,0.22)'; mctx.fill();
    mctx.strokeStyle='rgba(231,76,60,0.9)'; mctx.lineWidth=1; mctx.setLineDash([4,4]); mctx.stroke(); mctx.setLineDash([]);
    mctx.fillStyle='rgba(255,255,255,0.9)'; mctx.font='700 8px Inter'; mctx.textAlign='center';
    mctx.fillText('MB',mx,mz+3);
  }
  // thermals
  const ths=[{x:800,z:1200,r:400},{x:-1200,z:2500,r:550},{x:3500,z:-800,r:500}];
  for(const th of ths){
    const mx=(th.x - pos.x)*scale + w/2;
    const mz=(th.z - pos.z)*scale + h/2;
    const rr=th.r*scale;
    mctx.beginPath(); mctx.arc(mx,mz,rr,0,Math.PI*2);
    mctx.fillStyle='rgba(46,204,113,0.20)'; mctx.fill();
    mctx.strokeStyle='rgba(46,204,113,0.9)'; mctx.lineWidth=1; mctx.stroke();
    mctx.fillStyle='rgba(255,255,255,0.95)'; mctx.font='700 7px Inter'; mctx.fillText('THERMAL',mx,mz+3);
  }
  // runway
  const rw = {x:0,z:0};
  const mx=(rw.x - pos.x)*scale + w/2;
  const mz=(rw.z - pos.z)*scale + h/2;
  mctx.fillStyle='rgba(255,255,255,0.92)'; mctx.fillRect(mx-18, mz-3, 36, 6);
  mctx.fillStyle='rgba(255,255,255,0.7)'; mctx.font='600 7px Inter'; mctx.textAlign='center'; mctx.fillText('MF27 09/27', w/2, h-18);
  // aircraft heading line
  const hdg = app.flight.heading * Math.PI/180;
  const hx = Math.sin(hdg)*28, hz = -Math.cos(hdg)*28; // in screen, y is -z
  // map plane rotation
  mapPlane.style.transform = `translate(-50%,-50%) rotate(${app.flight.heading}deg)`;
  // velocity vector
  mctx.strokeStyle='rgba(255,212,0,0.9)'; mctx.lineWidth=2; mctx.beginPath();
  mctx.moveTo(w/2,h/2); mctx.lineTo(w/2+hx, h/2+hz); mctx.stroke();
}
setInterval(drawMap, 100);

// HUD update loop
function updateHUD(){
  const h=app.hud;
  vIAS.textContent = `${h.ias}`;
  vALT.textContent = `${h.alt.toLocaleString()}`;
  vVS.textContent = `${h.vs>0?'+':''}${h.vs}`;
  vHDG.textContent = `${String(h.hdg).padStart(3,'0')}`;
  (document.getElementById('vHDG2') as HTMLElement).textContent = '°';
  vG.textContent = h.g.toFixed(2);
  vAOA.textContent = h.aoa.toFixed(1);
  vTHR.textContent = `${h.throttle}%`;
  vFLP.textContent = `${h.flaps}% • ${app.flight.controls.gear?'DN':'UP'}`;
  // @ts-ignore slip not in hud but flight
  const slipVal = (app.flight as any).slip ?? 0;
  vStall.textContent = h.stalled ? '⚠ STALL' : h.onGround ? 'GRND' : `${slipVal.toFixed(1)}°`;
  (vStall.parentElement!.parentElement as HTMLElement).style.color = h.stalled ? '#ff3b30' : 'var(--text)';
  const mIAS = document.getElementById('mIAS')!, mG=document.getElementById('mG')!;
  mIAS.className = 'metric' + (h.ias < 62 && !h.onGround ? ' warn' : '') + (h.stalled ? ' danger' : '');
  mG.className = 'metric' + (Math.abs(h.g-1)>0.9 ? ' warn' : '');
  vWind.textContent = h.wind;
  vTiles.textContent = `${h.tiles} tiles • ${app.streaming.stats.memoryMB.toFixed(1)} MB`;
  vFT.textContent = app.renderer.stats.frameTimeMs?.toFixed?.(1) ?? app['frameTimeMs'].toFixed(1);
  vDC.textContent = `${app.renderer.stats.drawCalls}`;
  vTR.textContent = `${(app.renderer.stats.triangles/1000).toFixed(1)}k`;
  vLOD.textContent = `${app.culling.stats.lodBias.toFixed(2)}×`;
  barDC.style.width = `${Math.min(100, app.renderer.stats.drawCalls/8*100)}%`;
  barTR.style.width = `${Math.min(100, app.renderer.stats.triangles/9000*100)}%`;
  fpsBadge.textContent = `${h.fps} FPS • Vulkan/Metal`;
  fpsBadge.style.background = h.fps >=55 ? 'rgba(46,204,113,0.14)' : h.fps>=40 ? 'rgba(241,196,15,0.16)' : 'rgba(231,76,60,0.16)';
  fpsBadge.style.borderColor = h.fps >=55 ? 'rgba(46,204,113,0.35)' : h.fps>=40 ? 'rgba(241,196,15,0.35)' : 'rgba(231,76,60,0.45)';
  // BUG FIX: horizon now reflects actual aircraft attitude, not stick
  const up = app.flight.quat.rotateVector({x:0,y:1,z:0} as any);
  const fwd = app.flight.quat.rotateVector({x:1,y:0,z:0} as any);
  const rollDeg = Math.atan2(up.z, up.y)*180/Math.PI;
  const pitchDeg = Math.asin(Math.max(-1,Math.min(1, fwd.y)))*180/Math.PI;
  horizon.style.transform = `translateY(${ -pitchDeg*2.8 }px) rotate(${ -rollDeg }deg)`;
  horizon.style.top = `50%`;
  updateJoyVisual(); updateThrVisual();
  vAil.textContent = `${Math.round(app.flight.controls.aileron*100)}%`;
  vElev.textContent = `${Math.round(app.flight.controls.elevator*100)}%`;
  vRud.textContent = `${Math.round(app.flight.controls.rudder*100)}%`;
  vThr2.textContent = `${Math.round(app.flight.controls.throttle*100)}%`;
  // thermal indicator
  const thermalLift = app.weather.sample(app.flight.pos, app.flight.alt).velocity.y;
  if(thermalLift > 2.2){
    (document.getElementById('statusDot') as HTMLElement).style.background = '#2ecc71';
    (document.getElementById('statusDot') as HTMLElement).style.boxShadow = '0 0 12px #2ecc71';
  } else if(app.flight.stalled){
    (document.getElementById('statusDot') as HTMLElement).style.background = '#e74c3c';
  } else {
    (document.getElementById('statusDot') as HTMLElement).style.background = '#00d4ff';
  }
}
setInterval(updateHUD, 60);

// start
app.frame(performance.now()/1000);

// register keyboard help
window.addEventListener('keydown', e=>{
  if(e.code==='KeyC') { app.cycleCamera(); showToast(`Camera: ${app.camMode}`); }
  if(e.code==='KeyR') { app.reset(); }
});

// handle visibility
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) (app as any).running=false;
  else { (app as any).running=true; app.frame(performance.now()/1000); }
});

// expose for tests
(window as any).MicroFlight = app;
console.log('%cMicroFlight Simulator 2027%c — BET 24 elements • 120 Hz • Global streaming • 60 FPS','background:#00d4ff;color:#001018;padding:4px 8px;border-radius:6px;font-weight:800','color:#8a9bb0');
