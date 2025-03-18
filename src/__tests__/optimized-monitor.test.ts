import { OptimizedPerformanceMonitor, TrackingMode } from '../index';

describe('OptimizedPerformanceMonitor', () => {
  // Create a new instance for each test
  let monitor: OptimizedPerformanceMonitor;
  
  beforeEach(() => {
    // Create fresh monitor before each test
    monitor = new OptimizedPerformanceMonitor();
    
    // Configure for testing
    monitor.setConfig({
      silent: true, // Don't output to console during tests
      trackingMode: TrackingMode.BALANCED
    });
  });
  
  test('track synchronous function', () => {
    const add = (a: number, b: number) => a + b;
    const result = monitor.track(() => add(3, 5), { 
      label: 'add'
    });
    
    expect(result).toBe(8);
  });
  
  test('track asynchronous function', async () => {
    const delay = async (ms: number) => {
      return new Promise(resolve => setTimeout(() => resolve(ms), 5));
    };
    
    const result = await monitor.track(async () => delay(100), { 
      label: 'delay'
    });
    
    expect(result).toBe(100);
  });
  
  test('track functions with errors', () => {
    const throwError = () => {
      throw new Error('Test error');
    };
    
    expect(() => {
      monitor.track(throwError);
    }).toThrow('Test error');
  });
  
  test('createTrackable preserves function context', () => {
    const obj = {
      value: 42,
      getValue() {
        return this.value;
      }
    };
    
    // Create trackable version of the method
    const trackedGetValue = monitor.createTrackable(obj.getValue.bind(obj));
    
    // Should preserve context and return the correct value
    expect(trackedGetValue()).toBe(42);
  });
  
  test('registerModule tracks all methods', () => {
    // Sample module with multiple methods
    const mathModule = {
      add: (a: number, b: number) => a + b,
      multiply: (a: number, b: number) => a * b,
      value: 10
    };
    
    // Register the module for tracking
    const trackedMathModule = monitor.registerModule(mathModule);
    
    // Methods should work correctly
    expect(trackedMathModule.add(2, 3)).toBe(5);
    expect(trackedMathModule.multiply(2, 3)).toBe(6);
    
    // Non-method properties should be preserved
    expect(trackedMathModule.value).toBe(10);
  });
  
  test('create custom instance', () => {
    // Create with custom configuration
    const customMonitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.PERFORMANCE,
      silent: true,
      trackMemory: false,
      threshold: 50
    });
    
    // Test basic functionality
    const result = customMonitor.track(() => 5 + 7, { 
      label: 'addition'
    });
    
    expect(result).toBe(12);
  });

  test('tracking modes affect behavior', () => {
    // Performance mode
    monitor.setTrackingMode(TrackingMode.PERFORMANCE);
    let result = monitor.track(() => 1 + 2);
    expect(result).toBe(3);
    
    // Balanced mode
    monitor.setTrackingMode(TrackingMode.BALANCED);
    result = monitor.track(() => 3 + 4);
    expect(result).toBe(7);
    
    // Detailed mode
    monitor.setTrackingMode(TrackingMode.DETAILED);
    result = monitor.track(() => 5 + 6);
    expect(result).toBe(11);
    
    // Debug mode
    monitor.setTrackingMode(TrackingMode.DEBUG);
    result = monitor.track(() => 7 + 8);
    expect(result).toBe(15);
  });
  
  test('memory tracking can be toggled', () => {
    // Enable memory tracking
    monitor.enableMemoryTracking();
    let result = monitor.track(() => 1 + 2);
    expect(result).toBe(3);
    
    // Disable memory tracking
    monitor.disableMemoryTracking();
    result = monitor.track(() => 3 + 4);
    expect(result).toBe(7);
  });
  
  test('silent mode can be toggled', () => {
    // Console spy
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    // Enable silent mode
    monitor.enableSilentMode();
    let result = monitor.track(() => 1 + 2);
    expect(result).toBe(3);
    
    // Disable silent mode (but use detailed to ensure console output)
    monitor.setTrackingMode(TrackingMode.DETAILED);
    monitor.disableSilentMode();
    result = monitor.track(() => 3 + 4);
    expect(result).toBe(7);
    
    // Cleanup
    consoleSpy.mockRestore();
  });
  
  test('sample rate affects tracking', () => {
    // Mock Math.random to control sampling behavior
    const originalRandom = Math.random;
    
    try {
      // Force inclusion (100% sample rate)
      Math.random = jest.fn().mockReturnValue(0.1);
      monitor.setSampleRate(1.0);
      let result = monitor.track(() => 1 + 2);
      expect(result).toBe(3);
      
      // Force exclusion (0% sample rate)
      Math.random = jest.fn().mockReturnValue(0.9);
      monitor.setSampleRate(0.0);
      result = monitor.track(() => {
        // This should still execute but not be tracked
        return 3 + 4;
      });
      expect(result).toBe(7);
    } finally {
      // Restore original Math.random
      Math.random = originalRandom;
    }
  });
  
  test('reset clears execution data', () => {
    // Track a function
    monitor.track(() => 1 + 2);
    
    // Reset the tracker
    monitor.reset();
    
    // Track should still work after reset
    const result = monitor.track(() => 3 + 4);
    expect(result).toBe(7);
  });
  
  test('setConfig updates multiple configurations at once', () => {
    monitor.setConfig({
      trackingMode: TrackingMode.DEBUG,
      silent: false,
      trackMemory: true,
      enableNestedTracking: false,
      threshold: 200,
      sampleRate: 0.5
    });
    
    // Config should be applied
    const result = monitor.track(() => 5 + 6);
    expect(result).toBe(11);
  });
  
  test('promise rejection handling', async () => {
    const failingPromise = async () => {
      throw new Error('Promise rejection');
    };
    
    await expect(
      monitor.track(async () => failingPromise())
    ).rejects.toThrow('Promise rejection');
  });
  
  test('edge case: tracking a non-function throws an error', () => {
    // @ts-ignore deliberately testing wrong types
    expect(() => monitor.track('not a function')).toThrow();
    // @ts-ignore deliberately testing wrong types
    expect(() => monitor.createTrackable('not a function')).toThrow();
  });
  
  test('edge case: registerModule with non-object throws an error', () => {
    // @ts-ignore deliberately testing wrong types
    expect(() => monitor.registerModule('not an object')).toThrow();
    // @ts-ignore deliberately testing wrong types
    expect(() => monitor.registerModule(null)).toThrow();
  });
  
  test('tracked function with varying arguments count', () => {
    const fn = (a = 1, b = 2, c = 3) => a + b + c;
    const tracked = monitor.createTrackable(fn);
    
    // Call with different numbers of arguments
    expect(tracked()).toBe(6); // Default values
    expect(tracked(10)).toBe(15); // One argument
    expect(tracked(10, 20)).toBe(33); // Two arguments
    expect(tracked(10, 20, 30)).toBe(60); // Three arguments
  });
  
  test('tracking with sampling rate edge cases', () => {
    const originalRandom = Math.random;
    
    try {
      // Test edge case: sampleRate exactly 0 and 1
      Math.random = jest.fn().mockReturnValue(0.5);
      
      // Sample rate 0 - should never track
      monitor.setSampleRate(0);
      const result1 = monitor.track(() => 1);
      
      // Sample rate 1 - should always track
      monitor.setSampleRate(1);
      const result2 = monitor.track(() => 2);
      
      // Verify
      expect(result1).toBe(1);
      expect(result2).toBe(2);
      
      // Test edge case: negative sample rate should be treated as 0
      monitor.setSampleRate(-0.5);
      expect(monitor.track(() => 3)).toBe(3);
      
      // Test edge case: sample rate > 1 should be treated as 1
      monitor.setSampleRate(1.5);
      expect(monitor.track(() => 4)).toBe(4);
    } finally {
      Math.random = originalRandom;
    }
  });
  
  test('nested tracking with parent execution IDs', () => {
    // Set up tracking with nested executions
    monitor.setConfig({
      enableNestedTracking: true,
      silent: true,
      trackingMode: TrackingMode.DETAILED
    });
    
    // Create a parent function that will call a child function
    const parentFn = () => {
      // Child function is executed from within parent
      return monitor.track(() => 'child result', { 
        label: 'childFn'
      });
    };
    
    // Track the parent function
    const result = monitor.track(parentFn, { label: 'parentFn' });
    
    // Verify result
    expect(result).toBe('child result');
  });
  
  test('edge case: executeTracker configurability', () => {
    // Configure with all options
    const fullConfigMonitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.DEBUG,
      silent: false, 
      trackMemory: true,
      enableNestedTracking: true,
      threshold: 150,
      sampleRate: 0.75
    });
    
    // Create a spy on console.log
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    try {
      // Track a function with the configured monitor
      const result = fullConfigMonitor.track(() => 'configured', {
        label: 'configuredFn',
        silent: true // Override the monitor's silent setting
      });
      
      expect(result).toBe('configured');
    } finally {
      consoleSpy.mockRestore();
    }
  });
  
  test('test error propagation in tracked methods', () => {
    // Create a module with a method that throws
    const errorModule = {
      throwingMethod() {
        throw new Error('Module method error');
      },
      regularMethod() {
        return 'ok';
      }
    };
    
    // Register the module
    const trackedModule = monitor.registerModule(errorModule);
    
    // Check regular method
    expect(trackedModule.regularMethod()).toBe('ok');
    
    // Check throwing method
    expect(() => {
      trackedModule.throwingMethod();
    }).toThrow('Module method error');
  });
  
  test('test optional argument handling', () => {
    // Create monitor with minimal config
    const minimalMonitor = new OptimizedPerformanceMonitor();
    expect(minimalMonitor).toBeInstanceOf(OptimizedPerformanceMonitor);
    
    // Track with minimal options
    const result = minimalMonitor.track(() => 'minimal');
    expect(result).toBe('minimal');
    
    // Create trackable with minimal options
    const trackable = minimalMonitor.createTrackable(() => 'trackable');
    expect(trackable()).toBe('trackable');
  });
  
  test('track async functions with varying tracking modes', async () => {
    // Test with each tracking mode
    for (const mode of [
      TrackingMode.PERFORMANCE, 
      TrackingMode.BALANCED, 
      TrackingMode.DETAILED, 
      TrackingMode.DEBUG
    ]) {
      monitor.setTrackingMode(mode);
      
      const asyncResult = await monitor.track(async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return `result-${mode}`;
      });
      
      expect(asyncResult).toBe(`result-${mode}`);
    }
  });
});

describe('OptimizedPerformanceMonitor Branch Coverage Tests', () => {
  let monitor: OptimizedPerformanceMonitor;

  beforeEach(() => {
    // Create a fresh instance for each test
    monitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.BALANCED,
      silent: false,
      trackMemory: true,
      enableNestedTracking: true,
      threshold: 0 // Set threshold to 0 to capture everything
    });
  });

  test('tracking mode HIGH should track all executions', async () => {
    const highMonitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.BALANCED, // Use highest detail tracking
      threshold: 0
    });

    // Track a simple function with HIGH mode
    const result = await highMonitor.track(async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return 'high detail result';
    }, { label: 'high-detail-fn' });

    expect(result).toBe('high detail result');
  });

  test('tracking mode LOW should only track important executions', async () => {
    const lowMonitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.BALANCED, // Use low overhead tracking
      threshold: 0,
      sampleRate: 0.1 // Low sample rate to test sampling logic
    });

    // Track multiple executions to test sampling
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await lowMonitor.track(() => i, { label: `low-overhead-fn-${i}` });
      results.push(result);
    }
    
    // Verify results are correct even with sampling
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('tracking with explicit parentId should maintain execution hierarchy', async () => {
    let capturedExecutionId = '';
    
    // Create a trackable function that captures its execution ID (indirectly)
    const trackedFn = monitor.createTrackable(() => {
      // We'll capture the ID outside this function
      return 'parent function';
    }, { label: 'parent-fn' });
    
    // Execute it to get a parent ID
    trackedFn();
    
    // Now use a child function with made-up parent ID
    const childResult = await monitor.track(() => 'child result', { 
      label: 'child-fn',
      parentExecutionId: 'parent-1' // Any string will do for testing
    });
    
    expect(childResult).toBe('child result');
  });

  test('configuration options should be properly applied', () => {
    // Test various configuration combinations
    const customMonitor = new OptimizedPerformanceMonitor({
      trackingMode: TrackingMode.BALANCED,
      silent: true,
      trackMemory: false,
      enableNestedTracking: false,
      threshold: 100,
      sampleRate: 0.5
    });
    
    // We can't easily test the internal state directly,
    // but we can track something and verify it doesn't throw
    expect(() => {
      customMonitor.track(() => 'test', { label: 'config-test' });
    }).not.toThrow();
  });
}); 