import { ExecutionTracker } from '../trackers/execution';

describe('ExecutionTracker', () => {
  let executionTracker: ExecutionTracker;
  
  beforeEach(() => {
    executionTracker = new ExecutionTracker({ defaultThreshold: 100 });
  });
  
  test('track should return the result of the tracked function', () => {
    const result = executionTracker.track(() => 'test-result');
    expect(result).toBe('test-result');
  });
  
  test('track should handle errors in tracked functions', () => {
    const errorMessage = 'Test error';
    
    expect(() => {
      executionTracker.track(() => {
        throw new Error(errorMessage);
      });
    }).toThrow(errorMessage);
  });
  
  test('track should record execution data', () => {
    executionTracker.track(() => {
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait to ensure some time passes
      }
    }, { label: 'testFunction' });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('testFunction');
    expect(flowChart).toContain('Execution Flow');
  });
  
  test('track should detect slow functions', () => {
    executionTracker.track(() => {
      // Simulate slow work
      const start = Date.now();
      while (Date.now() - start < 150) {
        // Busy wait to ensure threshold is exceeded
      }
    }, { label: 'slowFunction', threshold: 100 });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('slowFunction');
    expect(flowChart).toContain('SLOW');
  });
  
  test('track should handle nested function calls', () => {
    executionTracker.track(() => {
      // Outer function
      executionTracker.track(() => {
        // Inner function
      }, { label: 'innerFunction' });
    }, { label: 'outerFunction' });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('outerFunction');
    expect(flowChart).toContain('innerFunction');
  });
  
  test('getCallStack should return the current call stack', () => {
    executionTracker.track(() => {
      executionTracker.track(() => {
        const callStack = executionTracker.getCallStack();
        expect(callStack.length).toBe(2);
        expect(callStack[0]).toBe('outerFunction');
        expect(callStack[1]).toBe('innerFunction');
      }, { label: 'innerFunction' });
    }, { label: 'outerFunction' });
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