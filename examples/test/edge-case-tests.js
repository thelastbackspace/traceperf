/**
 * Edge case tests for TracePerf
 * 
 * This file contains tests for challenging edge cases:
 * 1. Deeply nested async calls (>10 levels)
 * 2. Rapid memory allocation/deallocation cycles
 * 3. Circular references in tracked modules
 * 4. High-frequency function calls with sampling
 * 5. Error propagation in complex promise chains
 */

// Import the final optimized implementation
const { tracePerf, TrackingMode } = require('./traceperf-final.js');

// Configure for testing
tracePerf.setConfig({
  trackingMode: TrackingMode.DETAILED,
  silent: true, // Suppress console output for clean test output
  trackMemory: true,
  sampleRate: 1.0 // Full tracking for tests
});

// Helper function to create large objects
const createLargeObject = (size) => {
  const obj = {};
  for (let i = 0; i < size; i++) {
    obj[`key-${i}`] = `value-${i}-${'x'.repeat(100)}`;
  }
  return obj;
};

// Helper to force garbage collection if available
const forceGC = () => {
  if (global.gc) {
    global.gc();
  } else {
    console.log('⚠️ Garbage collection not exposed, run with --expose-gc for better test results');
  }
};

// Helper to create async delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Test 1: Deeply nested async calls
 * Creates a chain of >10 nested async function calls
 */
async function testDeepAsyncNesting() {
  console.log('\n📊 TEST 1: Deeply nested async calls');
  
  // Create a trackable recursive async function
  const nestedAsync = (depth) => {
    // Define the async function
    const asyncFn = async (d) => {
      if (d <= 0) return 'done';
      await delay(5); // Small delay to simulate work
      return await nestedAsync(d - 1);
    };
    
    // Create a trackable version and call it
    const trackedAsyncFn = tracePerf.createTrackable(asyncFn, { 
      label: `asyncLevel${depth}` 
    });
    
    return trackedAsyncFn(depth);
  };
  
  // Start tracking from the top level
  console.log('Starting deep async nesting test...');
  const trackedTopLevel = tracePerf.createTrackable(async () => {
    return await nestedAsync(12); // 12 levels of nesting
  }, { label: 'topLevelAsync' });
  
  const result = await trackedTopLevel();
  console.log('Deep async nesting test completed with result:', result);
}

/**
 * Test 2: Rapid memory allocation/deallocation
 * Create and release large objects rapidly
 */
async function testRapidMemoryChanges() {
  console.log('\n📊 TEST 2: Rapid memory allocation/deallocation');
  
  console.log('Starting rapid memory changes test...');
  
  // Create trackable functions
  const memoryChurnFn = tracePerf.createTrackable(async () => {
    const objects = [];
    
    // Create 5 large objects
    for (let i = 0; i < 5; i++) {
      const createObjectsFn = tracePerf.createTrackable(() => {
        objects.push(createLargeObject(1000));
      }, { label: `allocate-${i}` });
      
      createObjectsFn();
      await delay(10); // Small delay
    }
    
    // Release half the objects
    const releaseObjectsFn = tracePerf.createTrackable(() => {
      objects.splice(0, 2);
      forceGC();
    }, { label: 'release-half' });
    
    releaseObjectsFn();
    await delay(50);
    
    // Release remaining objects
    const releaseRemainingFn = tracePerf.createTrackable(() => {
      objects.splice(0, objects.length);
      forceGC();
    }, { label: 'release-remaining' });
    
    releaseRemainingFn();
  }, { label: 'memoryChurnTest' });
  
  await memoryChurnFn();
  console.log('Rapid memory changes test completed');
}

/**
 * Test 3: Circular references in tracked modules
 * Create objects that refer to each other and track them
 */
function testCircularReferences() {
  console.log('\n📊 TEST 3: Circular references in tracked modules');
  
  // Create mutually referencing objects
  const objA = {
    name: 'Object A',
    callB: function() {
      console.log(`${this.name} calling Object B`);
      return this.objB.respondToA();
    }
  };
  
  const objB = {
    name: 'Object B',
    respondToA: function() {
      console.log(`${this.name} responding to Object A`);
      return `Response from ${this.name}`;
    },
    callA: function() {
      console.log(`${this.name} calling Object A`);
      return this.objA.callB();
    }
  };
  
  // Create circular reference
  objA.objB = objB;
  objB.objA = objA;
  
  // Track both objects
  const trackedA = tracePerf.registerModule(objA, { prefix: 'A.' });
  const trackedB = tracePerf.registerModule(objB, { prefix: 'B.' });
  
  // Re-establish circular references with tracked versions
  trackedA.objB = trackedB;
  trackedB.objA = trackedA;
  
  // Execute the test
  console.log('Testing circular references...');
  // This should work without stack overflow or other issues
  const result = trackedA.callB();
  console.log('Circular references test result:', result);
}

/**
 * Test 4: High-frequency function calls with sampling
 * Test performance with different sampling rates
 */
function testHighFrequencySampling() {
  console.log('\n📊 TEST 4: High-frequency function calls with sampling');
  
  // Simple function to track
  const add = (a, b) => a + b;
  
  // Track with different sampling rates
  const samplingRates = [1.0, 0.5, 0.1, 0.01];
  
  for (const rate of samplingRates) {
    // Configure sampling rate
    tracePerf.setSampleRate(rate);
    const trackedAdd = tracePerf.createTrackable(add, { label: `add-sample-${rate}` });
    
    console.log(`Testing with sampling rate: ${rate}`);
    const iterations = 1000;
    const start = Date.now();
    
    // Run high-frequency calls
    for (let i = 0; i < iterations; i++) {
      trackedAdd(i, i + 1);
    }
    
    const duration = Date.now() - start;
    console.log(`  Completed ${iterations} calls in ${duration}ms (${Math.round(iterations / duration * 1000)} ops/sec)`);
  }
  
  // Reset sampling rate to default
  tracePerf.setSampleRate(1.0);
}

/**
 * Test 5: Error propagation in complex promise chains
 * Ensure errors are properly tracked through complex chains
 */
async function testComplexErrorPropagation() {
  console.log('\n📊 TEST 5: Error propagation in complex promise chains');
  
  // Define functions with different error behaviors
  const successFn = async () => {
    await delay(10);
    return 'success';
  };
  
  const failFn = async () => {
    await delay(10);
    throw new Error('Intentional failure');
  };
  
  const recoveryFn = async (err) => {
    await delay(10);
    return `Recovered from: ${err.message}`;
  };
  
  // Create trackable versions
  const trackedSuccessFn = tracePerf.createTrackable(successFn, { label: 'successFn' });
  const trackedFailFn = tracePerf.createTrackable(failFn, { label: 'failFn' });
  const trackedRecoveryFn = tracePerf.createTrackable(recoveryFn, { label: 'recoveryFn' });
  
  // Test different error scenarios
  async function testScenario(name, fn) {
    try {
      console.log(`Running scenario: ${name}`);
      const result = await fn();
      console.log(`  Result: ${result}`);
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
  }
  
  // Scenario 1: Success path
  await testScenario('Simple success', async () => {
    return await trackedSuccessFn();
  });
  
  // Scenario 2: Error path
  await testScenario('Simple error', async () => {
    return await trackedFailFn();
  });
  
  // Scenario 3: Error with recovery
  await testScenario('Error with recovery', async () => {
    try {
      return await trackedFailFn();
    } catch (err) {
      return await trackedRecoveryFn(err);
    }
  });
  
  // Scenario 4: Complex chain with both success and failure
  await testScenario('Complex chain', async () => {
    return trackedSuccessFn()
      .then(() => trackedFailFn())
      .catch(err => trackedRecoveryFn(err))
      .then(result => `Final: ${result}`);
  });
}

// Run all tests
async function runAllTests() {
  console.log('🧪 Starting TracePerf edge case tests\n');
  
  try {
    await testDeepAsyncNesting();
    await testRapidMemoryChanges();
    testCircularReferences();
    testHighFrequencySampling();
    await testComplexErrorPropagation();
    
    console.log('\n✅ All edge case tests completed successfully');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

// Run the tests
runAllTests(); 