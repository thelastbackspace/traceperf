/**
 * TracePerf Optimized Performance Tracking Example
 * 
 * This example demonstrates the various ways to use the optimized performance tracking implementation.
 */

// Import the optimized implementation
const { createTracePerf, TrackingMode } = require('../dist');

// Create instances with different tracking modes
const balancedTracker = createTracePerf({
  trackingMode: TrackingMode.BALANCED,
  silent: false,
  trackMemory: true,
  enableNestedTracking: true,
  threshold: 0 // Track everything in this example
});

const performanceTracker = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE,
  silent: true, // No console output
  trackMemory: false,
  threshold: 50
});

// Example 1: Basic tracking of synchronous functions
console.log('\n--- Example 1: Basic Tracking ---');
function add(a, b) {
  // Simulate some work
  const start = Date.now();
  while (Date.now() - start < 10) {}
  return a + b;
}

const sum = balancedTracker.track(() => add(5, 3), { label: 'addition' });
console.log(`Result: ${sum}`);

// Example 2: Tracking async functions
console.log('\n--- Example 2: Async Function Tracking ---');
async function fetchData() {
  // Simulate async operation
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ data: 'Sample data' });
    }, 100);
  });
}

async function asyncExample() {
  const result = await balancedTracker.track(async () => {
    const data = await fetchData();
    return data;
  }, { label: 'fetchData' });
  
  console.log(`Async result:`, result);
}

// Execute and wait for the async example
asyncExample().then(() => {
  // Continue with more examples
  
  // Example 3: Creating trackable functions
  console.log('\n--- Example 3: Trackable Functions ---');
  const trackedAdd = balancedTracker.createTrackable(add, { label: 'trackedAdd' });
  const trackedFetchData = balancedTracker.createTrackable(fetchData, { label: 'trackedFetchData' });
  
  // Use the tracked functions
  const trackedSum = trackedAdd(10, 20);
  console.log(`Tracked sum: ${trackedSum}`);
  
  // Example 4: Tracking with different modes
  console.log('\n--- Example 4: Different Tracking Modes ---');
  function longOperation() {
    const start = Date.now();
    while (Date.now() - start < 60) {}
    return 'Completed';
  }
  
  // Track with performance mode (silent)
  const perfResult = performanceTracker.track(longOperation, { label: 'performanceMode' });
  console.log(`Performance mode result: ${perfResult} (no console output due to silent:true)`);
  
  // Track with balanced mode
  const balancedResult = balancedTracker.track(longOperation, { label: 'balancedMode' });
  console.log(`Balanced mode result: ${balancedResult}`);
  
  // Example 5: Tracking nested function calls
  console.log('\n--- Example 5: Nested Function Calls ---');
  
  function outer() {
    const result1 = middle();
    const result2 = add(result1, 5);
    return result2;
  }
  
  function middle() {
    return inner() * 2;
  }
  
  function inner() {
    // Simulate some work
    const start = Date.now();
    while (Date.now() - start < 30) {}
    return 10;
  }
  
  // Create trackable versions
  const trackedOuter = balancedTracker.createTrackable(outer, { label: 'outer' });
  const trackedMiddle = balancedTracker.createTrackable(middle, { label: 'middle' });
  const trackedInner = balancedTracker.createTrackable(inner, { label: 'inner' });
  
  // Replace the original functions to enable nested tracking
  global.middle = trackedMiddle;
  global.inner = trackedInner;
  global.add = trackedAdd;
  
  // Execute the outer function which will call the others
  const nestedResult = trackedOuter();
  console.log(`Nested tracking result: ${nestedResult}`);
  
  // Example 6: Tracking module methods
  console.log('\n--- Example 6: Module Method Tracking ---');
  
  const userService = {
    getUser: (id) => {
      // Simulate database lookup
      const start = Date.now();
      while (Date.now() - start < 15) {}
      return { id, name: 'John Doe' };
    },
    updateUser: (id, data) => {
      // Simulate database update
      const start = Date.now();
      while (Date.now() - start < 25) {}
      return { id, ...data, updated: true };
    }
  };
  
  // Register all methods for tracking
  const trackedUserService = balancedTracker.registerModule(userService);
  
  // Use the tracked methods
  const user = trackedUserService.getUser(123);
  const updatedUser = trackedUserService.updateUser(123, { name: 'Jane Doe' });
  
  console.log('Retrieved user:', user);
  console.log('Updated user:', updatedUser);
  
  console.log('\n--- All examples completed ---');
}); 