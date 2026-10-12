/** Averages frame rate over a short window so the readout stays legible. */
export class FpsCounter {
  private frames = 0;
  private elapsed = 0;
  private _fps = 0;

  constructor(private readonly windowSeconds = 0.5) {}

  get fps(): number {
    return this._fps;
  }

  tick(frameDt: number): void {
    this.frames++;
    this.elapsed += frameDt;
    if (this.elapsed >= this.windowSeconds) {
      this._fps = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
  }
}
