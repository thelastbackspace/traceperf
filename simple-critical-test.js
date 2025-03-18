/**
 * TracePerf Critical Assessment
 * 
 * A simplified version that tests core functionality without relying on internal APIs
 */

const tracePerf = require('./dist/index.js');

console.log('Starting TracePerf Critical Assessment...');
console.log('========================================');

// 1. Test basic functionality
console.log('\n1. Basic Tracking Functionality');
console.log('------------------------------');

function testBasicTracking() {
  // Create a tracker with default settings
  const tracker = tracePerf.createTracePerf();
  
  try {
    // Track a simple synchronous function
    const result = tracker.track(() => {
      let sum = 0;
      for (let i = 0; i < 1000000; i++) {
        sum += i;
      }
      return sum;
    }, { label: 'sumCalculation' });
    
    console.log(`✓ Basic synchronous tracking works, result: ${result}`);
    
    // Test that the return value is correctly passed
    if (result === 499999500000) {
      console.log('✓ Return value is correctly preserved');
    } else {
      console.log(`⚠️ CRITICAL: Return value is incorrect: ${result}`);
    }
  } catch (err) {
    console.log(`⚠️ CRITICAL: Basic tracking failed with error: ${err.message}`);
  }
}

// 2. Test tracking modes
console.log('\n2. Tracking Modes');
console.log('----------------');

function testTrackingModes() {
  try {
    // Try each tracking mode
    const modes = ['performance', 'balanced', 'detailed'];
    
    for (const modeName of modes) {
      const tracker = tracePerf.createTracePerf({
        trackingMode: modeName
      });
      
      tracker.track(() => {
        let sum = 0;
        for (let i = 0; i < 100000; i++) {
          sum += i;
        }
        return sum;
      }, { label: `test-${modeName}-mode` });
      
      console.log(`✓ ${modeName} mode works`);
    }
  } catch (err) {
    console.log(`⚠️ CRITICAL: Tracking mode test failed with error: ${err.message}`);
  }
}

// 3. Test memory tracking
console.log('\n3. Memory Tracking');
console.log('----------------');

function testMemoryTracking() {
  try {
    // Create a tracker with memory tracking
    const tracker = tracePerf.createTracePerf({
      trackMemory: true
    });
    
    // Track a memory-intensive operation
    tracker.track(() => {
      // Allocate a large array (approximately 10MB)
      const array = new Array(1310720).fill(0);
      return array.length;
    }, { label: 'memoryTest' });
    
    console.log('✓ Memory tracking did not cause errors');
  } catch (err) {
    console.log(`⚠️ CRITICAL: Memory tracking test failed with error: ${err.message}`);
  }
}

// 4. Test nested tracking
console.log('\n4. Nested Function Tracking');
console.log('--------------------------');

function testNestedTracking() {
  try {
    // Create a tracker with nested tracking
    const tracker = tracePerf.createTracePerf({
      enableNestedTracking: true
    });
    
    // Create some nested functions
    function outerFunction() {
      return middleFunction();
    }
    
    function middleFunction() {
      return innerFunction();
    }
    
    function innerFunction() {
      return 'nested result';
    }
    
    // Create trackable versions
    const trackedOuter = tracker.createTrackable(outerFunction, { label: 'outer' });
    const trackedMiddle = tracker.createTrackable(middleFunction, { label: 'middle' });
    const trackedInner = tracker.createTrackable(innerFunction, { label: 'inner' });
    
    // Call the outer function
    const result = trackedOuter();
    
    console.log(`✓ Nested tracking completed, result: ${result}`);
  } catch (err) {
    console.log(`⚠️ CRITICAL: Nested tracking test failed with error: ${err.message}`);
  }
}

// 5. Test async tracking
console.log('\n5. Async Function Tracking');
console.log('-------------------------');

async function testAsyncTracking() {
  try {
    const tracker = tracePerf.createTracePerf();
    
    // Track an async function
    const result = await tracker.track(async () => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve('async result');
        }, 100);
      });
    }, { label: 'asyncTest' });
    
    console.log(`✓ Async tracking completed, result: ${result}`);
  } catch (err) {
    console.log(`⚠️ CRITICAL: Async tracking test failed with error: ${err.message}`);
  }
}

// 6. Test error handling
console.log('\n6. Error Handling');
console.log('----------------');

function testErrorHandling() {
  try {
    const tracker = tracePerf.createTracePerf();
    
    try {
      tracker.track(() => {
        throw new Error('Test error');
      }, { label: 'errorTest' });
      
      console.log('⚠️ CRITICAL: Function should have thrown an error but did not');
    } catch (err) {
      console.log(`✓ Error properly propagated: ${err.message}`);
    }
  } catch (err) {
    console.log(`⚠️ CRITICAL: Error handling test failed: ${err.message}`);
  }
}

// Run all tests
async function runAllTests() {
  try {
    testBasicTracking();
    testTrackingModes();
    testMemoryTracking();
    testNestedTracking();
    await testAsyncTracking();
    testErrorHandling();
    
    console.log('\n========================================');
    console.log('TracePerf Critical Assessment Complete!');
  } catch (error) {
    console.error('Error during tests:', error);
  }
}

// Run the tests
runAllTests(); 