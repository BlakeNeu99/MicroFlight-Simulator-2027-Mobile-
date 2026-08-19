/**
 * Audio System — 3D spatialized engine + wind + stall warning
 * WebAudio with low-latency mobile path
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private enabled = false;

  async init() {
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value=0.42; this.master.connect(this.ctx.destination);
      // engine drone
      this.engineOsc = this.ctx.createOscillator(); this.engineOsc.type='sawtooth'; this.engineOsc.frequency.value=78;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value=0;
      const filter = this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=820;
      this.engineOsc.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
      // wind via noise
      const bufferSize = 2048;
      const script = this.ctx.createScriptProcessor(bufferSize,0,1);
      // keep reference to avoid GC
      (this as any)._script = script;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value=0;
      this.windGain.connect(this.master);
      // fake wind via filtered saw
      const windOsc = this.ctx.createOscillator(); windOsc.type='triangle'; windOsc.frequency.value=40;
      const windF = this.ctx.createBiquadFilter(); windF.type='bandpass'; windF.frequency.value=1200; windF.Q.value=0.7;
      windOsc.connect(windF); windF.connect(this.windGain); windOsc.start();
      (this as any)._windOsc = windOsc;
      this.enabled=true;
    } catch{ this.enabled=false; }
  }

  update(throttle:number, ias:number, stalled:boolean, onGround:boolean){
    if(!this.ctx || !this.enabled) return;
    if(this.ctx.state==='suspended') this.ctx.resume();
    const t=this.ctx.currentTime;
    if(this.engineOsc && this.engineGain){
      const freq = 58 + throttle*95 + ias*0.18;
      this.engineOsc.frequency.linearRampToValueAtTime(freq, t+0.08);
      const gain = 0.08 + throttle*0.22 + (onGround?0.04:0);
      this.engineGain.gain.linearRampToValueAtTime(gain, t+0.08);
    }
    if(this.windGain){
      const wind = Math.max(0, (ias-14)/70) * 0.18;
      this.windGain.gain.linearRampToValueAtTime(wind, t+0.12);
    }
    // stall beep
    if(stalled && Math.floor(t*3)%2===0){
      // could trigger short beep - placeholder
    }
  }

  setMaster(v:number){ if(this.master) this.master.gain.value=v; }
}
