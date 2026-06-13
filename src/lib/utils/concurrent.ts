/**
 * Concurrency limiter — like p-limit.
 * Runs tasks with a max concurrency, preserving order of results.
 */

export class PLimit {
  private concurrency: number;
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.running < this.concurrency) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

/**
 * Run an array of tasks with limited concurrency.
 * Returns results in the same order as input.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limiter = new PLimit(concurrency);
  const promises = items.map((item, i) => limiter.run(() => fn(item, i)));
  return Promise.all(promises);
}

/**
 * Run an array of tasks with limited concurrency, settling all (like Promise.allSettled).
 */
export async function mapSettledConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const limiter = new PLimit(concurrency);
  const promises = items.map((item, i) => limiter.run(() => fn(item, i)));
  return Promise.allSettled(promises);
}
