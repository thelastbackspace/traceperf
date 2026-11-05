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

export function busyWait(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // spin
  }
}
