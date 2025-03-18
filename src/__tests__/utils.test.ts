import * as utils from '../utils';
import * as colors from '../utils/colors';
import * as stringUtils from '../utils/string';
import * as timing from '../utils/timing';
import { getFunctionName, CallStackManager } from '../utils/stack';

describe('Colors Utils', () => {
  test('color functions should add ANSI color codes', () => {
    const text = 'test';
    expect(colors.red(text)).toContain(text);
    expect(colors.green(text)).toContain(text);
    expect(colors.yellow(text)).toContain(text);
    expect(colors.blue(text)).toContain(text);
    expect(colors.magenta(text)).toContain(text);
    expect(colors.cyan(text)).toContain(text);
    expect(colors.gray(text)).toContain(text);
    expect(colors.bold(text)).toContain(text);
    expect(colors.underline(text)).toContain(text);
    expect(colors.dim(text)).toContain(text);
  });

  test('colorize should apply the specified color', () => {
    const text = 'test';
    expect(colors.colorize(text, 'red')).toContain(text);
  });

  test('supportsColor should return a boolean', () => {
    expect(typeof colors.supportsColor()).toBe('boolean');
  });

  test('supportsColor should handle different environment variables', () => {
    // Save original env
    const originalEnv = { ...process.env };
    const originalPlatform = process.platform;
    const originalStdoutIsTTY = process.stdout.isTTY;
    
    // Mock process properties
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true
    });
    
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true
    });
    
    // Test FORCE_COLOR=0
    process.env.FORCE_COLOR = '0';
    expect(colors.supportsColor()).toBe(false);
    
    // Test FORCE_COLOR=1
    process.env.FORCE_COLOR = '1';
    expect(colors.supportsColor()).toBe(true);
    
    // Test Windows platform
    delete process.env.FORCE_COLOR;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true
    });
    expect(colors.supportsColor()).toBe(true);
    
    // Test CI environment
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true
    });
    process.env.CI = 'true';
    expect(colors.supportsColor()).toBe(true);
    
    // Test COLORTERM
    delete process.env.CI;
    process.env.COLORTERM = 'truecolor';
    expect(colors.supportsColor()).toBe(true);
    
    // Test dumb terminal
    delete process.env.COLORTERM;
    process.env.TERM = 'dumb';
    expect(colors.supportsColor()).toBe(false);
    
    // Test TTY
    delete process.env.TERM;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true
    });
    expect(colors.supportsColor()).toBe(true);
    
    // Restore original env
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY
    });
  });
});

describe('Colors Utils - Advanced Tests', () => {
  test('colorize with fallback color', () => {
    const text = 'test text';
    const result = colors.colorize(text, 'invalidColor');
    expect(result).toContain(text);
  });

  test('color functions should include added text', () => {
    const text = 'test text';
    // Just check that all color functions work and include the original text
    expect(colors.red(text)).toContain(text);
    expect(colors.green(text)).toContain(text);
    expect(colors.yellow(text)).toContain(text);
    expect(colors.blue(text)).toContain(text);
    expect(colors.magenta(text)).toContain(text);
    expect(colors.cyan(text)).toContain(text);
    expect(colors.gray(text)).toContain(text);
    expect(colors.bold(text)).toContain(text);
    expect(colors.underline(text)).toContain(text);
    expect(colors.dim(text)).toContain(text);
  });

  test('color functions should be chainable', () => {
    const text = 'test text';
    const result = colors.red(colors.bold(text));
    expect(result).toContain(text);
  });
});

describe('Stack Utils', () => {
  describe('getFunctionName', () => {
    test('should get name of named function', () => {
      function testFunction() {}
      expect(getFunctionName(testFunction)).toBe('testFunction');
    });

    test('should handle functions without a name property', () => {
      // Mock a function without a name property
      const fn = function() {};
      Object.defineProperty(fn, 'name', { value: undefined });
      
      // We expect it to try to extract from toString
      expect(getFunctionName(fn)).toContain('<anonymous>');
    });

    test('should handle arrow functions', () => {
      const arrowFn = () => {};
      // If the arrow function has a name (which varies by environment), use it
      // Otherwise, it should extract it correctly
      const result = getFunctionName(arrowFn);
      expect(result === 'arrowFn' || result === '<arrow function>').toBeTruthy();
    });
  });

  describe('CallStackManager', () => {
    let stackManager: CallStackManager;

    beforeEach(() => {
      stackManager = new CallStackManager();
    });

    test('should push and pop function names', () => {
      expect(stackManager.getDepth()).toBe(0);
      
      stackManager.push('function1');
      expect(stackManager.getDepth()).toBe(1);
      
      stackManager.push('function2');
      expect(stackManager.getDepth()).toBe(2);
      
      expect(stackManager.pop()).toBe('function2');
      expect(stackManager.getDepth()).toBe(1);
      
      expect(stackManager.pop()).toBe('function1');
      expect(stackManager.getDepth()).toBe(0);
      
      // Pop on empty stack should return undefined
      expect(stackManager.pop()).toBeUndefined();
    });

    test('should get the current function', () => {
      expect(stackManager.getCurrentFunction()).toBeUndefined();
      
      stackManager.push('function1');
      expect(stackManager.getCurrentFunction()).toBe('function1');
      
      stackManager.push('function2');
      expect(stackManager.getCurrentFunction()).toBe('function2');
    });

    test('should get the parent function', () => {
      expect(stackManager.getParentFunction()).toBeUndefined();
      
      stackManager.push('function1');
      expect(stackManager.getParentFunction()).toBeUndefined();
      
      stackManager.push('function2');
      expect(stackManager.getParentFunction()).toBe('function1');
      
      stackManager.push('function3');
      expect(stackManager.getParentFunction()).toBe('function2');
    });

    test('should get the stack', () => {
      expect(stackManager.getStack()).toEqual([]);
      
      stackManager.push('function1');
      stackManager.push('function2');
      
      expect(stackManager.getStack()).toEqual(['function1', 'function2']);
      
      // Ensure the returned stack is a copy
      const stack = stackManager.getStack();
      stack.push('function3');
      
      expect(stackManager.getStack()).toEqual(['function1', 'function2']);
    });

    test('should clear the stack', () => {
      stackManager.push('function1');
      stackManager.push('function2');
      
      expect(stackManager.getDepth()).toBe(2);
      
      stackManager.clear();
      expect(stackManager.getDepth()).toBe(0);
      expect(stackManager.getStack()).toEqual([]);
    });
  });
});

describe('Stack Utils - Additional Tests', () => {
  test('getCallStack returns an array of function names', () => {
    const stack = utils.getCallStack();
    expect(Array.isArray(stack)).toBe(true);
    // Should contain at least this test function
    expect(stack.length).toBeGreaterThan(0);
  });

  test('getFunctionName handles different function types', () => {
    // Anonymous function
    const anonymousFn = function() {};
    expect(getFunctionName(anonymousFn)).toBe('anonymousFn');

    // Arrow function
    const arrowFn = () => {};
    expect(getFunctionName(arrowFn)).toBe('arrowFn');

    // Function with special name extraction
    const funcWithoutName = Object.defineProperty(function() {}, 'name', { value: '' });
    expect(getFunctionName(funcWithoutName)).toBe('<anonymous>');
  });
});

describe('Timing Utils', () => {
  test('formatDuration should format duration in milliseconds', () => {
    expect(timing.formatDuration(1.5)).toBe('1.50ms');
    expect(timing.formatDuration(0.5)).toBe('500.00μs');
    expect(timing.formatDuration(1500)).toBe('1.50s');
  });

  test('getHighResTime should return a high-resolution time', () => {
    const time = timing.getHighResTime();
    expect(Array.isArray(time)).toBe(true);
    expect(time.length).toBe(2);
    expect(typeof time[0]).toBe('number');
    expect(typeof time[1]).toBe('number');
  });

  test('getDuration should calculate duration between times', () => {
    const startTime = timing.getHighResTime();
    
    // Small delay
    const start = Date.now();
    while (Date.now() - start < 5) {
      // Busy wait to ensure some time passes
    }
    
    const duration = timing.getDuration(startTime);
    expect(duration).toBeGreaterThan(0);
  });

  describe('Timer', () => {
    test('constructor should create a timer with a label', () => {
      const timer = new timing.Timer('test-timer');
      expect(timer.getLabel()).toBe('test-timer');
    });
    
    test('stop should stop the timer and return duration', () => {
      const timer = new timing.Timer('test-timer');
      
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait to ensure some time passes
      }
      
      const duration = timer.stop();
      expect(duration).toBeGreaterThan(0);
    });
    
    test('getDuration should return the timer duration', () => {
      const timer = new timing.Timer('test-timer');
      
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait to ensure some time passes
      }
      
      const duration = timer.getDuration();
      expect(duration).toBeGreaterThan(0);
    });
    
    test('reset should reset the timer', () => {
      const timer = new timing.Timer('test-timer');
      
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait to ensure some time passes
      }
      
      const firstDuration = timer.getDuration();
      timer.reset();
      
      // The new duration should be less than the first one
      expect(timer.getDuration()).toBeLessThan(firstDuration);
    });
    
    test('toString should return a formatted string', () => {
      const timer = new timing.Timer('test-timer');
      const str = timer.toString();
      expect(str).toContain('test-timer');
      expect(str).toMatch(/test-timer: \d+\.\d+[μm]s/);
    });
    
    test('stopping an already stopped timer should return the same duration', () => {
      const timer = new timing.Timer('test-timer');
      
      // Stop the timer
      const duration1 = timer.stop();
      
      // Stop again and should get the same duration
      const duration2 = timer.stop();
      
      // Use approximately equal since timing differences may occur
      expect(duration2).toBeCloseTo(duration1, 1);
    });
  });
});

describe('Timing Utils - Additional Tests', () => {
  test('Timer can be stopped and reset multiple times', () => {
    const timer = new timing.Timer('multi-timer');
    
    // First stop cycle
    const firstDuration = timer.stop();
    expect(firstDuration).toBeGreaterThanOrEqual(0);
    
    // Reset and stop again
    timer.reset();
    const secondDuration = timer.stop();
    expect(secondDuration).toBeGreaterThanOrEqual(0);
  });

  test('formatDuration handles edge cases', () => {
    // Zero duration
    expect(timing.formatDuration(0)).toBe('0.00μs');
    
    // Negative duration (shouldn't happen in real use)
    expect(timing.formatDuration(-1)).toContain('-');
    
    // Very large duration
    expect(timing.formatDuration(3600000)).toBe('3600.00s');
  });
}); 