import { PerformanceMonitor } from '../trackers/performance';

describe('PerformanceMonitor', () => {
  let performanceMonitor: PerformanceMonitor;
  
  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor({ defaultThreshold: 100 });
  });
  
  test('startTimer and endTimer should measure duration', () => {
    const id = performanceMonitor.startTimer('test-timer');
    
    // Simulate some work
    const start = Date.now();
    while (Date.now() - start < 10) {
      // Busy wait to ensure some time passes
    }
    
    const duration = performanceMonitor.endTimer(id);
    expect(duration).toBeGreaterThan(0);
  });
  
  test('endTimer should throw error for non-existent timer', () => {
    expect(() => {
      performanceMonitor.endTimer('non-existent-timer');
    }).toThrow();
  });
  
  test('isBottleneck should return true for durations above threshold', () => {
    expect(performanceMonitor.isBottleneck(150)).toBe(true);
    expect(performanceMonitor.isBottleneck(50)).toBe(false);
  });
  
  test('isBottleneck should use custom threshold when provided', () => {
    expect(performanceMonitor.isBottleneck(75, 50)).toBe(true);
    expect(performanceMonitor.isBottleneck(75, 100)).toBe(false);
  });
  
  test('getMemoryUsage should return memory usage information', () => {
    const memoryUsage = performanceMonitor.getMemoryUsage();
    
    // Skip test if memory usage is not available
    if (!memoryUsage) {
      console.warn('Memory usage information not available, skipping test');
      return;
    }
    
    expect(memoryUsage).toHaveProperty('heapUsed');
    expect(memoryUsage).toHaveProperty('heapTotal');
    expect(memoryUsage).toHaveProperty('external');
    expect(memoryUsage).toHaveProperty('rss');
    
    expect(typeof memoryUsage?.heapUsed).toBe('number');
    expect(typeof memoryUsage?.heapTotal).toBe('number');
    expect(typeof memoryUsage?.external).toBe('number');
    expect(typeof memoryUsage?.rss).toBe('number');
  });
  
  test('generateSuggestion should provide different suggestions based on duration', () => {
    const slowSuggestion = performanceMonitor.generateSuggestion('slowFunction', 1500);
    const mediumSuggestion = performanceMonitor.generateSuggestion('mediumFunction', 600);
    const fastSuggestion = performanceMonitor.generateSuggestion('fastFunction', 50);
    
    expect(slowSuggestion).toContain('slowFunction');
    expect(slowSuggestion).toContain('caching');
    
    expect(mediumSuggestion).toContain('mediumFunction');
    expect(mediumSuggestion).toContain('blocking');
    
    expect(fastSuggestion).toContain('fastFunction');
    expect(fastSuggestion).toContain('optimizations');
  });
}); 