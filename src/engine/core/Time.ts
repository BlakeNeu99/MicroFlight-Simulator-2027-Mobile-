export class Time {
  deltaTime = 0;
  fixedDelta = 1/120;
  elapsed = 0;
  frameCount = 0;
  fps = 60;
  private last = performance.now()/1000;
  private fpsSamples: number[] = [];
  private accumulator = 0;

  tick(nowSec: number) {
    const now = nowSec ?? performance.now()/1000;
    this.deltaTime = Math.min(0.05, now - this.last);
    this.last = now;
    this.elapsed += this.deltaTime;
    this.frameCount++;
    this.accumulator += this.deltaTime;
    // fps smoothing
    this.fpsSamples.push(1/Math.max(0.001, this.deltaTime));
    if(this.fpsSamples.length > 30) this.fpsSamples.shift();
    this.fps = this.fpsSamples.reduce((a,b)=>a+b,0)/this.fpsSamples.length;
  }

  consumeFixedSteps(cb: (dt:number)=>void, maxSteps=4) {
    let steps = 0;
    while(this.accumulator >= this.fixedDelta && steps < maxSteps) {
      cb(this.fixedDelta);
      this.accumulator -= this.fixedDelta;
      steps++;
    }
    return this.accumulator / this.fixedDelta; // interpolation alpha
  }
}
