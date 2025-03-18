/**
 * TracePerf Browser Critical Assessment
 * 
 * A critical assessment of the browser bundle functionality
 */

// Import the browser bundle
const TracePerf = require('./dist/browser.js');

console.log('Starting TracePerf Browser Critical Assessment...');
console.log('===============================================');

// 1. Test basic functionality
console.log('\n1. Basic Tracking Functionality');
console.log('------------------------------');

function testBasicTracking() {
  try {
    // Create a tracker with default settings
    const tracker = TracePerf.createBrowserLogger();
    
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
    
    return true;
  } catch (err) {
    console.log(`⚠️ CRITICAL: Basic tracking failed with error: ${err.message}`);
    return false;
  }
}

// 2. Test memory tracking
console.log('\n2. Memory Tracking');
console.log('----------------');

function testMemoryTracking() {
  try {
    // Create a tracker with memory tracking
    const tracker = TracePerf.createBrowserLogger({
      trackMemory: true
    });
    
    // Track a memory-intensive operation
    tracker.track(() => {
      // Allocate a large array (approximately 10MB)
      const array = new Array(1310720).fill(0);
      return array.length;
    }, { label: 'memoryTest' });
    
    console.log('✓ Memory tracking did not cause errors');
    return true;
  } catch (err) {
    console.log(`⚠️ CRITICAL: Memory tracking test failed with error: ${err.message}`);
    return false;
  }
}

// 3. Test nested tracking
console.log('\n3. Nested Function Tracking');
console.log('--------------------------');

function testNestedTracking() {
  try {
    // Create a tracker with nested tracking
    const tracker = TracePerf.createBrowserLogger({
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
    return true;
  } catch (err) {
    console.log(`⚠️ CRITICAL: Nested tracking test failed with error: ${err.message}`);
    return false;
  }
}

// 4. Test async tracking
console.log('\n4. Async Function Tracking');
console.log('-------------------------');

async function testAsyncTracking() {
  try {
    const tracker = TracePerf.createBrowserLogger();
    
    // Track an async function
    const result = await tracker.track(async () => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve('async result');
        }, 100);
      });
    }, { label: 'asyncTest' });
    
    console.log(`✓ Async tracking completed, result: ${result}`);
    return true;
  } catch (err) {
    console.log(`⚠️ CRITICAL: Async tracking test failed with error: ${err.message}`);
    return false;
  }
}

// 5. Test error handling
console.log('\n5. Error Handling');
console.log('----------------');

function testErrorHandling() {
  try {
    const tracker = TracePerf.createBrowserLogger();
    
    try {
      tracker.track(() => {
        throw new Error('Test error');
      }, { label: 'errorTest' });
      
      console.log('⚠️ CRITICAL: Function should have thrown an error but did not');
      return false;
    } catch (err) {
      console.log(`✓ Error properly propagated: ${err.message}`);
      return true;
    }
  } catch (err) {
    console.log(`⚠️ CRITICAL: Error handling test failed: ${err.message}`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  try {
    const results = {
      basicTracking: testBasicTracking(),
      memoryTracking: testMemoryTracking(),
      nestedTracking: testNestedTracking(),
      asyncTracking: await testAsyncTracking(),
      errorHandling: testErrorHandling()
    };
    
    console.log('\n===============================================');
    console.log('TracePerf Browser Critical Assessment Results:');
    
    let passedCount = 0;
    for (const [testName, result] of Object.entries(results)) {
      console.log(`- ${testName}: ${result ? '✓ PASSED' : '✗ FAILED'}`);
      if (result) passedCount++;
    }
    
    const totalTests = Object.keys(results).length;
    const passRate = Math.round((passedCount / totalTests) * 100);
    
    console.log('\nSummary:');
    console.log(`${passedCount}/${totalTests} tests passed (${passRate}%)`);
    
    if (passRate === 100) {
      console.log('\n✅ VERDICT: TracePerf browser bundle is market-ready!');
    } else if (passRate >= 80) {
      console.log('\n⚠️ VERDICT: TracePerf browser bundle needs minor improvements before market-readiness.');
    } else {
      console.log('\n❌ VERDICT: TracePerf browser bundle requires significant improvements before market-readiness.');
    }
    
  } catch (error) {
    console.error('Error during tests:', error);
  }
}

// Run the tests
runAllTests(); 