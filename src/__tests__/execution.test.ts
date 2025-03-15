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
  
  test('track should handle errors thrown by tracked functions', () => {
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
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += i;
      }
    }, { label: 'testFunction' });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('testFunction');
  });
  
  test('track should detect slow functions', async () => {
    jest.setTimeout(1000);
    
    await executionTracker.track(async () => {
      return new Promise(resolve => setTimeout(resolve, 150));
    }, { label: 'slowFunction', threshold: 100 });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('slowFunction');
  });
  
  test('track should handle nested function calls', () => {
    const outerFunction = () => {
      executionTracker.track(() => {
        // Inner function
      }, { label: 'innerFunction' });
    };
    
    executionTracker.track(outerFunction, { label: 'outerFunction' });
    
    const flowChart = executionTracker.generateFlowChart();
    expect(flowChart).toContain('outerFunction');
    expect(flowChart).toContain('innerFunction');
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