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
  virtualNow = 1000;
  const spy = jest.spyOn(performance, 'now').mockImplementation(() => virtualNow as number);
  return () => {
    spy.mockRestore();
    virtualNow = undefined;
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
