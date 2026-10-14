// Event-triggered recovery, not polling: coalesce reads and retry only pending
// work. Each resource owns one timer; cancellation invalidates in-flight drains.
export class ResourceRefresh {
  pending = false;
  running = false;
  private epoch = 0;
  private delay = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly read: () => Promise<void>,
    private readonly options: {
      canRun?: () => boolean;
      onError: (error: unknown) => void;
      onIdle?: () => void;
    },
  ) {}

  get busy() { return this.pending || this.running; }

  request() {
    this.pending = true;
    this.clearTimer();
    void this.resume();
  }

  async resume(): Promise<void> {
    if (this.running || !this.pending || this.timer || this.options.canRun?.() === false) return;
    const epoch = this.epoch;
    this.running = true;
    try {
      while (this.pending && this.options.canRun?.() !== false) {
        this.pending = false;
        await this.read();
        if (epoch !== this.epoch) return;
        this.delay = 1000;
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.pending = true;
      this.options.onError(error);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.resume();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    } finally {
      if (epoch === this.epoch) {
        this.running = false;
        if (!this.pending) this.options.onIdle?.();
      }
    }
  }

  cancel() {
    this.epoch++;
    this.clearTimer();
    this.pending = false;
    this.running = false;
    this.delay = 1000;
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
