import { Logger } from '../core/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  
  beforeEach(() => {
    // Create a new logger instance for each test
    logger = new Logger();
    
    // Spy on console.log to capture output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });
  
  afterEach(() => {
    // Restore console.log after each test
    consoleLogSpy.mockRestore();
  });
  
  test('info method should log a message', () => {
    logger.info('Test info message');
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Test info message');
    expect(consoleLogSpy.mock.calls[0][0]).toContain('INFO');
  });
  
  test('warn method should log a warning message', () => {
    logger.warn('Test warning message');
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Test warning message');
    expect(consoleLogSpy.mock.calls[0][0]).toContain('WARN');
  });
  
  test('error method should log an error message', () => {
    logger.error('Test error message');
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Test error message');
    expect(consoleLogSpy.mock.calls[0][0]).toContain('ERROR');
  });
  
  test('debug method should log a debug message', () => {
    logger.debug('Test debug message');
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Test debug message');
    expect(consoleLogSpy.mock.calls[0][0]).toContain('DEBUG');
  });
  
  test('debug messages should be suppressed in production mode', () => {
    logger.setMode('prod');
    logger.debug('This should not be logged');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
  
  test('group and groupEnd should manage indentation', () => {
    logger.info('Outside group');
    logger.group('Group 1');
    logger.info('Inside group');
    logger.groupEnd();
    logger.info('Outside again');
    
    // First log (outside group) should have no indentation
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Outside group');
    expect(consoleLogSpy.mock.calls[0][0]).not.toContain('  Outside group');
    
    // Second log (group label) should have no indentation
    expect(consoleLogSpy.mock.calls[1][0]).toContain('Group 1');
    expect(consoleLogSpy.mock.calls[1][0]).not.toContain('  Group 1');
    
    // Third log (inside group) should have indentation
    expect(consoleLogSpy.mock.calls[2][0]).toContain('Inside group');
    
    // Fourth log (outside again) should have no indentation
    expect(consoleLogSpy.mock.calls[3][0]).toContain('Outside again');
    expect(consoleLogSpy.mock.calls[3][0]).not.toContain('  Outside again');
  });
  
  test('createTrackable should delegate to the execution tracker', () => {
    // Mock the execution tracker's createTrackable method
    const mockCreateTrackable = jest.fn().mockReturnValue(() => 'tracked result');
    (logger as any)._executionTracker.createTrackable = mockCreateTrackable;
    
    const mockFn = jest.fn().mockReturnValue('result');
    const trackable = logger.createTrackable(mockFn, { label: 'testFunction' });
    const result = trackable();
    
    expect(result).toBe('tracked result');
    expect(mockCreateTrackable).toHaveBeenCalledWith(mockFn, { label: 'testFunction' });
  });
}); 