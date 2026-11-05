/**
 * Regression: tracked functions must keep the caller's `this`,
 * plus their name and length.
 */
import { createTracePerf } from '../index';

describe('tracking preserves `this`', () => {
  const tp = createTracePerf({ silent: true });

  test('registerModule methods see the module as `this`', () => {
    const service = tp.registerModule({
      prefix: 'svc',
      greet(name: string) {
        return `${this.prefix}:${name}`;
      },
    });
    expect(service.greet('ada')).toBe('svc:ada');
  });

  test('createTrackable used as a method receives the receiver as `this`', () => {
    const obj = {
      value: 42,
      get: tp.createTrackable(function (this: { value: number }) {
        return this.value;
      }),
    };
    expect(obj.get()).toBe(42);
  });

  test('track() honours thisContext', () => {
    const ctx = { n: 7 };
    expect(tp.track(function (this: typeof ctx) { return this.n; }, { thisContext: ctx })).toBe(7);
  });

  test('name and length are preserved', () => {
    function add(a: number, b: number) { return a + b; }
    const tracked = tp.createTrackable(add);
    expect(tracked.name).toBe('add');
    expect(tracked.length).toBe(2);
  });
});
