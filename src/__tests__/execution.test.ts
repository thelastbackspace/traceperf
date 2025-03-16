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

describe('createTrackable', () => {
  it('should create a trackable version of a function', () => {
    const tracker = new ExecutionTracker();
    const mockFn = jest.fn().mockReturnValue('result');
    const trackable = tracker.createTrackable(mockFn, { label: 'testFunction' });
    
    const result = trackable();
    
    expect(result).toBe('result');
    expect(mockFn).toHaveBeenCalled();
  });
  
  it('should pass arguments to the original function', () => {
    const tracker = new ExecutionTracker();
    const mockFn = jest.fn().mockReturnValue('result');
    const trackable = tracker.createTrackable(mockFn);
    
    trackable('arg1', 'arg2');
    
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
  });
  
  it('should use the function name if no label is provided', () => {
    const tracker = new ExecutionTracker();
    const namedFunction = function testFunction() { return 'result'; };
    const trackable = tracker.createTrackable(namedFunction);
    
    const spy = jest.spyOn(tracker, 'track');
    trackable();
    
    expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      label: 'testFunction'
    }));
  });
  
  it('should preserve the this context', () => {
    const tracker = new ExecutionTracker();
    const obj = {
      value: 'test',
      method() { return this.value; }
    };
    
    const trackableMethod = tracker.createTrackable(obj.method.bind(obj));
    const result = trackableMethod();
    
    expect(result).toBe('test');
  });
}); 