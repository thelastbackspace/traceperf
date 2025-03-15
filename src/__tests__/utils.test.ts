import * as colors from '../utils/colors';
import { CallStackManager, getFunctionName } from '../utils/stack';
import { formatDuration, Timer, getHighResTime, getDuration } from '../utils/timing';

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

describe('Stack Utils', () => {
  test('getFunctionName should extract function name', () => {
    function testFunction() {}
    expect(getFunctionName(testFunction)).toBe('testFunction');
    
    const arrowFunction = () => {};
    expect(getFunctionName(arrowFunction)).toBe('arrowFunction');
    
    // Anonymous function
    expect(getFunctionName(function() {})).toBe('<anonymous>');
  });

  describe('CallStackManager', () => {
    let callStackManager: CallStackManager;
    
    beforeEach(() => {
      callStackManager = new CallStackManager();
    });
    
    test('push should add a function to the stack', () => {
      const depth = callStackManager.push('testFunction');
      expect(depth).toBe(1);
      expect(callStackManager.getStack()).toEqual(['testFunction']);
    });
    
    test('pop should remove a function from the stack', () => {
      callStackManager.push('function1');
      callStackManager.push('function2');
      
      const popped = callStackManager.pop();
      expect(popped).toBe('function2');
      expect(callStackManager.getStack()).toEqual(['function1']);
    });
    
    test('getDepth should return the stack depth', () => {
      expect(callStackManager.getDepth()).toBe(0);
      
      callStackManager.push('function1');
      expect(callStackManager.getDepth()).toBe(1);
      
      callStackManager.push('function2');
      expect(callStackManager.getDepth()).toBe(2);
    });
    
    test('clear should reset the stack', () => {
      callStackManager.push('function1');
      callStackManager.push('function2');
      
      callStackManager.clear();
      expect(callStackManager.getStack()).toEqual([]);
      expect(callStackManager.getDepth()).toBe(0);
    });
    
    test('getCurrentFunction should return the top function', () => {
      expect(callStackManager.getCurrentFunction()).toBeUndefined();
      
      callStackManager.push('function1');
      expect(callStackManager.getCurrentFunction()).toBe('function1');
      
      callStackManager.push('function2');
      expect(callStackManager.getCurrentFunction()).toBe('function2');
    });
    
    test('getParentFunction should return the parent function', () => {
      expect(callStackManager.getParentFunction()).toBeUndefined();
      
      callStackManager.push('function1');
      expect(callStackManager.getParentFunction()).toBeUndefined();
      
      callStackManager.push('function2');
      expect(callStackManager.getParentFunction()).toBe('function1');
    });
  });
});

describe('Timing Utils', () => {
  test('formatDuration should format duration in milliseconds', () => {
    expect(formatDuration(1.5)).toBe('1.50ms');
    expect(formatDuration(0.5)).toBe('500.00μs');
    expect(formatDuration(1500)).toBe('1.50s');
  });

  test('getHighResTime should return a high-resolution time', () => {
    const time = getHighResTime();
    expect(Array.isArray(time)).toBe(true);
    expect(time.length).toBe(2);
    expect(typeof time[0]).toBe('number');
    expect(typeof time[1]).toBe('number');
  });

  test('getDuration should calculate duration between times', () => {
    const startTime = getHighResTime();
    
    // Small delay
    const start = Date.now();
    while (Date.now() - start < 5) {
      // Busy wait to ensure some time passes
    }
    
    const duration = getDuration(startTime);
    expect(duration).toBeGreaterThan(0);
  });

  describe('Timer', () => {
    test('constructor should create a timer with a label', () => {
      const timer = new Timer('test-timer');
      expect(timer.getLabel()).toBe('test-timer');
    });
    
    test('stop should stop the timer and return duration', () => {
      const timer = new Timer('test-timer');
      
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait to ensure some time passes
      }
      
      const duration = timer.stop();
      expect(duration).toBeGreaterThan(0);
    });
    
    test('getDuration should return the timer duration', () => {
      const timer = new Timer('test-timer');
      
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait to ensure some time passes
      }
      
      const duration = timer.getDuration();
      expect(duration).toBeGreaterThan(0);
    });
    
    test('reset should reset the timer', () => {
      const timer = new Timer('test-timer');
      
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
      const timer = new Timer('test-timer');
      const str = timer.toString();
      expect(str).toContain('test-timer');
      expect(str).toMatch(/test-timer: \d+\.\d+[μm]s/);
    });
  });
}); 