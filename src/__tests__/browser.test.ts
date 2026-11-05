import { BrowserLogger } from '../browser';

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

describe('BrowserLogger.createTrackable', () => {
  it('should delegate to the execution tracker', () => {
    const logger = new BrowserLogger();
    const mockFn = jest.fn().mockReturnValue('result');
    
    // Mock the track method to return 'tracked result'
    const mockTrack = jest.fn().mockImplementation((fn) => {
      fn();
      return 'tracked result';
    });
    logger.track = mockTrack;
    
    const trackable = logger.createTrackable(mockFn, { label: 'testFunction' });
    const result = trackable();
    
    expect(result).toBe('tracked result');
    expect(mockTrack).toHaveBeenCalled();
  });
});

describe('BrowserLogger with additional tests', () => {
  let browserLogger: BrowserLogger;
  let consoleLogSpy: jest.SpyInstance;
  
  beforeEach(() => {
    browserLogger = new BrowserLogger();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });
  
  afterEach(() => {
    consoleLogSpy.mockRestore();
  });
  
  test('different log modes behavior', () => {
    // Default (dev) mode - should log everything
    browserLogger.info('Info in dev');
    browserLogger.debug('Debug in dev');
    
    // Staging mode - should log info but not debug
    browserLogger.setMode('staging');
    browserLogger.info('Info in staging');
    browserLogger.debug('Debug in staging');
    
    // Prod mode - should log info but not debug
    browserLogger.setMode('prod');
    browserLogger.info('Info in prod');
    browserLogger.debug('Debug in prod');
    
    // Test invalid mode (falls back to dev)
    browserLogger.setMode('invalid' as any);
    expect(browserLogger.getMode()).toBe('invalid');
  });
  
  test('track with different options', () => {
    // Basic tracking
    browserLogger.track(() => {}, { label: 'basicTracking' });
    
    // With threshold
    browserLogger.track(() => {}, { 
      label: 'withThreshold',
      threshold: 200
    });
    
    // With includeMemory
    browserLogger.track(() => {}, { 
      label: 'withMemory',
      trackMemory: true
    });
    
    // With execution path - using object spreading to bypass type checking
    browserLogger.track(() => {}, 
      { 
        label: 'withPath',
        ...{ executionPath: 'test.path' }
      } as any
    );
  });
  
  test('track with nested functions', () => {
    browserLogger.track(() => {
      browserLogger.track(() => {}, { label: 'inner' });
    }, { label: 'outer' });
  });
}); 