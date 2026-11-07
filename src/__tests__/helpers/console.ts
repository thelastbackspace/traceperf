/**
 * Capture console.log output for assertions on what users actually see.
 */
export function captureLogs(): { lines: () => string[]; text: () => string; restore: () => void } {
  const calls: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    calls.push(args.map(String).join(' '));
  });
  return {
    lines: () => calls,
    text: () => calls.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

let virtualNow: number | undefined;

/**
 * Replace performance.now() with a clock that only moves when busyWait()
 * runs, so sync timing assertions are exact and immune to machine load.
 * Returns a restore function. Not for code that awaits real timers.
 */
export function useVirtualClock(): () => void {
  // An own property shadows Performance.prototype.now (read-only for assignment on Node 18)
  const hadOwn = Object.prototype.hasOwnProperty.call(performance, 'now');
  const previous = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { value: () => virtualNow as number, configurable: true, writable: true });
  virtualNow = 1000;
  return () => {
    virtualNow = undefined;
    if (hadOwn && previous) Object.defineProperty(performance, 'now', previous);
    else delete (performance as { now?: unknown }).now;
  };
}

export function busyWait(ms: number): void {
  if (virtualNow !== undefined) {
    virtualNow += ms;
    return;
  }
  const start = Date.now();
  while (Date.now() - start < ms) {
    // spin
  }
}

/** Run a synchronous test body on the virtual clock (see useVirtualClock). */
export function withVirtualClock(body: () => void): () => void {
  return () => {
    const restore = useVirtualClock();
    try {
      body();
    } finally {
      restore();
    }
  };
}
