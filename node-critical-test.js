/**
 * TracePerf Node.js Critical Test
 * 
 * This script verifies that the core functionality of TracePerf works in Node.js environment.
 */

const { createTracePerf, TrackingMode } = require('./dist/index.js');

console.log('=== TracePerf Node.js Critical Assessment ===\n');

// Create a tracer instance with minimal output
const tracer = createTracePerf({
  silent: true,
  trackingMode: TrackingMode.BALANCED
});

let passed = 0;
let failed = 0;
const totalTests = 5;

// Test 1: Basic Tracking - Sync
console.log('Testing: Basic Tracking Functionality');
try {
  // Track a simple synchronous function
  const result = tracer.track(() => {
    // Perform some work
    let sum = 0;
    for (let i = 0; i < 1000000; i++) {
      sum += i;
    }
    return 'sync result';
  }, { label: 'basicTest', silent: true });
  
  if (result === 'sync result') {
    console.log('✅ PASS: Basic synchronous tracking works and preserves return value');
    passed++;
  } else {
    console.log('❌ FAIL: Basic tracking did not preserve return value');
    failed++;
  }
} catch (error) {
  console.log('❌ FAIL: Basic tracking threw an error:', error);
  failed++;
}

// Test 2: Memory Tracking
console.log('\nTesting: Memory Tracking');
try {
  // Create an array to measure memory usage
  const memResult = tracer.track(() => {
    const bigArray = new Array(1000000).fill(0);
    return bigArray.length;
  }, { 
    label: 'memoryTest', 
    trackMemory: true,
    silent: true 
  });
  
  console.log('✅ PASS: Memory tracking did not cause errors');
  passed++;
} catch (error) {
  console.log('❌ FAIL: Memory tracking threw an error:', error);
  failed++;
}

// Test 3: Nested Function Tracking
console.log('\nTesting: Nested Function Tracking');
try {
  const outerFn = tracer.createTrackable(() => {
    // This is the outer function
    return innerFn();
  }, { label: 'outerFunction', silent: true });
  
  const innerFn = tracer.createTrackable(() => {
    // This is the inner function
    return 'nested result';
  }, { label: 'innerFunction', silent: true });
  
  const nestedResult = outerFn();
  
  if (nestedResult === 'nested result') {
    console.log('✅ PASS: Nested function tracking works and preserves return value');
    passed++;
  } else {
    console.log('❌ FAIL: Nested tracking did not preserve return value');
    failed++;
  }
} catch (error) {
  console.log('❌ FAIL: Nested tracking threw an error:', error);
  failed++;
}

// Test 4: Async Function Tracking
console.log('\nTesting: Async Function Tracking');
(async () => {
  try {
    const asyncResult = await tracer.track(async () => {
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'async result';
    }, { label: 'asyncTest', silent: true });
    
    if (asyncResult === 'async result') {
      console.log('✅ PASS: Async tracking works and preserves promise result');
      passed++;
    } else {
      console.log('❌ FAIL: Async tracking did not preserve promise result');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL: Async tracking threw an error:', error);
    failed++;
  }
})();

// Test 5: Error Propagation
console.log('\nTesting: Error Handling');
try {
  tracer.track(() => {
    throw new Error('Test error');
  }, { label: 'errorTest', silent: true });
  
  console.log('❌ FAIL: Error was not propagated');
  failed++;
} catch (error) {
  if (error.message === 'Test error') {
    console.log('✅ PASS: Error was properly propagated');
    passed++;
  } else {
    console.log(`❌ FAIL: Wrong error was propagated: ${error.message}`);
    failed++;
  }
}

// Delay the final calculation to ensure async tests complete
setTimeout(() => {
  console.log(`\n=== Results: ${passed}/${totalTests} tests passing (${(passed/totalTests*100).toFixed(0)}%) ===`);
  
  if (passed === totalTests) {
    console.log('\n✨ VERDICT: The TracePerf Node.js bundle is market-ready! ✨');
  } else {
    console.log(`\n⚠️ VERDICT: The TracePerf Node.js bundle has ${failed} failing tests and needs attention before release.`);
  }
}, 200);
