import { BrowserLogger, BrowserPerformanceMonitor, BrowserExecutionTracker } from '../browser';

// Mock the performance API
const originalPerformance = global.performance;
beforeAll(() => {
  // Create a custom performance object with memory property
  const mockPerformance = {
    now: jest.fn().mockImplementation(() => Date.now()),
    // Add other required properties from Performance interface
    timing: {} as any,
    navigation: {} as any,
    timeOrigin: 0,
    // Custom property for Chrome's performance.memory
    memory: {
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
      jsHeapSizeLimit: 4000000
    }
  };
  
  // @ts-expect-error - Ignore type checking for the test mock
  global.performance = mockPerformance;
});

afterAll(() => {
  global.performance = originalPerformance;
});

describe('BrowserLogger', () => {
  let browserLogger: BrowserLogger;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  
  beforeEach(() => {
    browserLogger = new BrowserLogger();
    
    // Spy on console methods
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });
  
  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
  
  test('info method should log a message', () => {
    browserLogger.info('Test info message');
    expect(consoleInfoSpy).toHaveBeenCalled();
    expect(consoleInfoSpy.mock.calls[0][0]).toBe('Test info message');
  });
  
  test('warn method should log a warning message', () => {
    browserLogger.warn('Test warning message');
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toBe('Test warning message');
  });
  
  test('error method should log an error message', () => {
    browserLogger.error('Test error message');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toBe('Test error message');
  });
  
  test('debug method should log a debug message', () => {
    browserLogger.debug('Test debug message');
    expect(consoleDebugSpy).toHaveBeenCalled();
    expect(consoleDebugSpy.mock.calls[0][0]).toBe('Test debug message');
  });
  
  test('debug messages should be suppressed in production mode', () => {
    browserLogger.setMode('prod');
    browserLogger.debug('This should not be logged');
    expect(consoleDebugSpy).not.toHaveBeenCalled();
  });
  
  test('track should return the result of the tracked function', () => {
    const result = browserLogger.track(() => 'test-result');
    expect(result).toBe('test-result');
    expect(consoleLogSpy).toHaveBeenCalled();
  });
  
  test('setMode and getMode should work correctly', () => {
    expect(browserLogger.getMode()).toBe('dev');
    browserLogger.setMode('staging');
    expect(browserLogger.getMode()).toBe('staging');
    browserLogger.setMode('prod');
    expect(browserLogger.getMode()).toBe('prod');
  });
});

describe('BrowserPerformanceMonitor', () => {
  let performanceMonitor: BrowserPerformanceMonitor;
  
  beforeEach(() => {
    performanceMonitor = new BrowserPerformanceMonitor({ defaultThreshold: 100 });
  });
  
  test('startTimer and endTimer should measure duration', () => {
    const id = performanceMonitor.startTimer('test-timer');
    const duration = performanceMonitor.endTimer(id);
    expect(duration).toBeGreaterThanOrEqual(0);
  });
  
  test('isBottleneck should return true for durations above threshold', () => {
    expect(performanceMonitor.isBottleneck(150)).toBe(true);
    expect(performanceMonitor.isBottleneck(50)).toBe(false);
  });
  
  test('getMemoryUsage should return memory usage information', () => {
    const memoryUsage = performanceMonitor.getMemoryUsage();
    expect(memoryUsage).toHaveProperty('heapUsed');
    expect(memoryUsage).toHaveProperty('heapTotal');
    expect(memoryUsage.heapUsed).toBe(1000000);
    expect(memoryUsage.heapTotal).toBe(2000000);
  });
});

describe('BrowserExecutionTracker', () => {
  let executionTracker: BrowserExecutionTracker;
  
  beforeEach(() => {
    executionTracker = new BrowserExecutionTracker({ defaultThreshold: 100 });
  });
  
  test('track should return the result of the tracked function', () => {
    const result = executionTracker.track(() => 'test-result');
    expect(result).toBe('test-result');
  });
  
  test('track should record execution data', () => {
    executionTracker.track(() => {}, { label: 'testFunction' });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('testFunction');
    expect(flowChart).toContain('Execution Flow');
  });
  
  test('getCallStack should return the current call stack', () => {
    executionTracker.track(() => {
      const callStack = executionTracker.getCallStack();
      expect(callStack.length).toBe(1);
      expect(callStack[0]).toBe('testFunction');
    }, { label: 'testFunction' });
  });
  
  test('clear should reset execution data', () => {
    executionTracker.track(() => {}, { label: 'testFunction' });
    
    let flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('testFunction');
    
    executionTracker.clear();
    
    flowChart = executionTracker.generateFlowChart();
    expect(flowChart).not.toContain('testFunction');
  });
});

describe('BrowserExecutionTracker.createTrackable', () => {
  it('should create a trackable version of a function', () => {
    const tracker = new BrowserExecutionTracker();
    const mockFn = jest.fn().mockReturnValue('result');
    const trackable = tracker.createTrackable(mockFn, { label: 'testFunction' });
    
    const result = trackable();
    
    expect(result).toBe('result');
    expect(mockFn).toHaveBeenCalled();
  });
  
  it('should pass arguments to the original function', () => {
    const tracker = new BrowserExecutionTracker();
    const mockFn = jest.fn().mockReturnValue('result');
    const trackable = tracker.createTrackable(mockFn);
    
    trackable('arg1', 'arg2');
    
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
  });
  
  it('should use the function name if no label is provided', () => {
    const tracker = new BrowserExecutionTracker();
    const namedFunction = function testFunction() { return 'result'; };
    const trackable = tracker.createTrackable(namedFunction);
    
    const spy = jest.spyOn(tracker, 'track');
    trackable();
    
    expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      label: 'testFunction'
    }));
  });
  
  it('should preserve the this context', () => {
    const tracker = new BrowserExecutionTracker();
    const obj = {
      value: 'test',
      method() { return this.value; }
    };
    
    const trackableMethod = tracker.createTrackable(obj.method.bind(obj));
    const result = trackableMethod();
    
    expect(result).toBe('test');
  });
});

describe('BrowserLogger.createTrackable', () => {
  it('should delegate to the execution tracker', () => {
    const logger = new BrowserLogger();
    const mockFn = jest.fn().mockReturnValue('result');
    
    // Mock the execution tracker's createTrackable method
    const mockCreateTrackable = jest.fn().mockReturnValue(() => 'tracked result');
    (logger as any)._executionTracker.createTrackable = mockCreateTrackable;
    
    const trackable = logger.createTrackable(mockFn, { label: 'testFunction' });
    const result = trackable();
    
    expect(result).toBe('tracked result');
    expect(mockCreateTrackable).toHaveBeenCalledWith(mockFn, { label: 'testFunction' });
  });
}); 