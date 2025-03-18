/**
 * TracePerf Critical Evaluation Test
 * 
 * This script performs a rigorous assessment of TracePerf's capabilities
 * under various conditions to evaluate its claims of high-performance
 * function execution tracking with minimal overhead.
 * 
 * Key aspects tested:
 * - Performance overhead in different tracking modes
 * - Memory tracking accuracy
 * - Nested function tracking depth and fidelity
 * - Behavior under load with concurrent operations
 * - Edge cases and error handling
 */

// Import directly from the main package
const tracePerf = require('./dist/index.js');
const { createTracePerf } = tracePerf;
const { TrackingMode } = require('./dist/types/index.js');

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Create an output directory for results
const outputDir = path.join(__dirname, 'evaluation-results');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Log file for results
const logFile = path.join(outputDir, 'evaluation-results.json');
const results = {
  performanceOverhead: {},
  memoryTracking: {},
  nestedTracking: {},
  concurrentOperations: {},
  edgeCases: {}
};

console.log('Starting TracePerf Critical Evaluation...');
console.log('==========================================');

/**
 * Test 1: Performance Overhead Evaluation
 * 
 * This test evaluates the overhead introduced by TracePerf in different tracking modes
 * by comparing execution times with and without tracking.
 */
console.log('\n1. Performance Overhead Evaluation');
console.log('----------------------------------');

async function testPerformanceOverhead() {
  // Function to test - mathematical operation that won't be optimized away
  const testFunction = (iterations) => {
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sin(i * 0.01) * Math.cos(i * 0.02);
    }
    return result;
  };

  // The number of iterations for our test function
  const iterations = 1000000;
  
  // Number of test runs to average results
  const testRuns = 10;
  
  // First, measure baseline without any tracking
  let baselineTimes = [];
  for (let i = 0; i < testRuns; i++) {
    const start = performance.now();
    testFunction(iterations);
    baselineTimes.push(performance.now() - start);
  }
  const baselineAvg = baselineTimes.reduce((a, b) => a + b, 0) / testRuns;
  console.log(`Baseline (no tracking): ${baselineAvg.toFixed(3)}ms`);

  // Test with different tracking modes
  const modes = {
    [TrackingMode.PERFORMANCE]: createTracePerf({ trackingMode: TrackingMode.PERFORMANCE }),
    [TrackingMode.BALANCED]: createTracePerf({ trackingMode: TrackingMode.BALANCED }),
    [TrackingMode.DETAILED]: createTracePerf({ trackingMode: TrackingMode.DETAILED })
  };

  const overheadResults = {};
  
  for (const [modeName, tracer] of Object.entries(modes)) {
    let tracedTimes = [];
    
    for (let i = 0; i < testRuns; i++) {
      const start = performance.now();
      tracer.track(() => testFunction(iterations), { label: `test-${modeName}` });
      tracedTimes.push(performance.now() - start);
    }
    
    const tracedAvg = tracedTimes.reduce((a, b) => a + b, 0) / testRuns;
    const overhead = ((tracedAvg - baselineAvg) / baselineAvg) * 100;
    
    console.log(`${modeName} mode: ${tracedAvg.toFixed(3)}ms (${overhead.toFixed(2)}% overhead)`);
    
    overheadResults[modeName] = {
      baselineMs: baselineAvg,
      tracedMs: tracedAvg,
      overheadPercent: overhead
    };
  }
  
  results.performanceOverhead = overheadResults;
  
  // Critical evaluation:
  const performanceModeOverhead = overheadResults[TrackingMode.PERFORMANCE].overheadPercent;
  if (performanceModeOverhead > 10) {
    console.log(`⚠️ CRITICAL: Performance mode overhead is ${performanceModeOverhead.toFixed(2)}%, which exceeds the 10% threshold for a high-performance monitoring library.`);
  } else {
    console.log(`✓ Performance mode overhead is acceptable at ${performanceModeOverhead.toFixed(2)}%`);
  }
}

/**
 * Test 2: Memory Tracking Accuracy
 * 
 * This test evaluates how accurately TracePerf tracks memory allocation
 * by comparing with known allocation patterns.
 */
console.log('\n2. Memory Tracking Accuracy');
console.log('---------------------------');

function testMemoryTracking() {
  // Create a tracker with memory tracking enabled
  const memoryTracker = createTracePerf({
    trackingMode: TrackingMode.DETAILED,
    trackMemory: true
  });
  
  // Functions that allocate specific amounts of memory
  function allocateSmall() {
    // Approximately 1MB
    const array = new Array(131072).fill(0); // Each number is 8 bytes
    return array;
  }
  
  function allocateMedium() {
    // Approximately 10MB
    const array = new Array(1310720).fill(0);
    return array;
  }
  
  function allocateLarge() {
    // Approximately 50MB
    const array = new Array(6553600).fill(0);
    return array;
  }
  
  // Collect memory metrics for different allocation sizes
  // Note: We'll use a custom hook to extract the memory usage data from TracePerf
  let memoryMetrics = {};
  
  // We'll need to capture the console.log output to analyze memory tracking results
  const originalLog = console.log;
  
  // Small allocation
  console.log = function() {};  // Temporarily disable console output
  let smallAllocation = memoryTracker.track(allocateSmall, { label: 'small-allocation' });
  console.log = originalLog;
  
  // Medium allocation
  console.log = function() {}; 
  let mediumAllocation = memoryTracker.track(allocateMedium, { label: 'medium-allocation' });
  console.log = originalLog;
  
  // Large allocation
  console.log = function() {};
  let largeAllocation = memoryTracker.track(allocateLarge, { label: 'large-allocation' });
  console.log = originalLog;
  
  // Use executeTracker directly to get memory data for a more direct test
  // (This is a more invasive test that reaches into the internal API)
  const internalTracker = memoryTracker._executionTracker;
  
  // Manual tracking
  const trackedMemorySizes = [1, 10, 50]; // MB
  const memoryResults = {};
  
  for (const size of trackedMemorySizes) {
    // Create array with approximately size MB
    const elements = (size * 1024 * 1024) / 8;  // 8 bytes per number
    
    let memoryBefore, memoryAfter;
    
    if (global.gc) {
      global.gc(); // Force garbage collection if available (node --expose-gc)
    }
    
    internalTracker.startTimer('memory-test-' + size, true);
    memoryBefore = internalTracker.getMemoryUsage();
    
    const array = new Array(Math.floor(elements)).fill(0);
    
    memoryAfter = internalTracker.getMemoryUsage();
    internalTracker.endTimer('memory-test-' + size);
    
    const expectedBytes = size * 1024 * 1024;
    const actualBytes = memoryAfter - memoryBefore;
    const accuracyPercent = (actualBytes / expectedBytes) * 100;
    
    memoryResults[size + 'MB'] = {
      expectedBytes,
      measuredBytes: actualBytes,
      accuracyPercent
    };
    
    console.log(`${size}MB allocation - Expected: ${expectedBytes} bytes, Measured: ${actualBytes} bytes (${accuracyPercent.toFixed(2)}% accuracy)`);
    
    // Critical evaluation
    if (accuracyPercent < 50 || accuracyPercent > 150) {
      console.log(`⚠️ CRITICAL: Memory tracking accuracy is ${accuracyPercent.toFixed(2)}% for ${size}MB allocation, which is outside the acceptable range of 50-150%.`);
    } else {
      console.log(`✓ Memory tracking accuracy is reasonable at ${accuracyPercent.toFixed(2)}% for ${size}MB allocation`);
    }
  }
  
  results.memoryTracking = memoryResults;
}

/**
 * Test 3: Nested Function Tracking
 * 
 * This test evaluates how well TracePerf tracks nested function calls
 * including proper parent-child relationships and accurate timing.
 */
console.log('\n3. Nested Function Tracking');
console.log('---------------------------');

function testNestedTracking() {
  // Create a tracker with nested tracking enabled
  const nestedTracker = createTracePerf({
    trackingMode: TrackingMode.DETAILED,
    enableNestedTracking: true
  });
  
  // Define a set of functions with known nested calling patterns
  function level1() {
    const delay = 100;
    const start = performance.now();
    while (performance.now() - start < delay) {} // Busy wait
    return level2();
  }
  
  function level2() {
    const delay = 50;
    const start = performance.now();
    while (performance.now() - start < delay) {} // Busy wait
    return level3();
  }
  
  function level3() {
    const delay = 25;
    const start = performance.now();
    while (performance.now() - start < delay) {} // Busy wait
    return 'result';
  }
  
  // Create trackable versions
  const trackedLevel1 = nestedTracker.createTrackable(level1, { label: 'level1' });
  const trackedLevel2 = nestedTracker.createTrackable(level2, { label: 'level2' });
  const trackedLevel3 = nestedTracker.createTrackable(level3, { label: 'level3' });
  
  // Execute with tracking and capture the console output
  const originalLog = console.log;
  let logs = [];
  
  console.log = function(...args) {
    logs.push(args.join(' '));
  };
  
  trackedLevel1();
  
  console.log = originalLog;
  
  // Analyze the logs to determine if the nested structure was captured correctly
  const nestedResults = {
    capturedLogs: logs,
    level1Found: logs.some(log => log.includes('level1')),
    level2Found: logs.some(log => log.includes('level2')),
    level3Found: logs.some(log => log.includes('level3')),
    properNesting: logs.some(log => log.includes('└─'))
  };
  
  console.log('Nested function tracking results:');
  console.log(`- Level 1 function tracked: ${nestedResults.level1Found ? 'Yes' : 'No'}`);
  console.log(`- Level 2 function tracked: ${nestedResults.level2Found ? 'Yes' : 'No'}`);
  console.log(`- Level 3 function tracked: ${nestedResults.level3Found ? 'Yes' : 'No'}`);
  console.log(`- Proper nesting visualization: ${nestedResults.properNesting ? 'Yes' : 'No'}`);
  
  // Critical evaluation
  if (!nestedResults.level1Found || !nestedResults.level2Found || !nestedResults.level3Found) {
    console.log(`⚠️ CRITICAL: Not all nested function levels were properly tracked.`);
  } else if (!nestedResults.properNesting) {
    console.log(`⚠️ CRITICAL: Nested functions were tracked but not properly visualized.`);
  } else {
    console.log(`✓ Nested function tracking is working as expected`);
  }
  
  results.nestedTracking = nestedResults;
}

/**
 * Test 4: Concurrent Operations
 * 
 * This test evaluates how well TracePerf handles tracking multiple
 * concurrent operations, especially in asynchronous contexts.
 */
console.log('\n4. Concurrent Operations');
console.log('------------------------');

async function testConcurrentOperations() {
  // Create a tracker with detailed mode
  const concurrentTracker = createTracePerf({
    trackingMode: TrackingMode.DETAILED
  });
  
  // Create async functions that will run concurrently
  async function asyncOperation(id, delay) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(`Operation ${id} completed after ${delay}ms`);
      }, delay);
    });
  }
  
  // Track multiple concurrent operations
  const originalLog = console.log;
  let logs = [];
  
  console.log = function(...args) {
    logs.push(args.join(' '));
  };
  
  const operations = [];
  const numOperations = 5;
  
  // Start multiple tracked async operations concurrently
  for (let i = 0; i < numOperations; i++) {
    const delay = 50 + Math.random() * 100;
    operations.push(
      concurrentTracker.track(() => asyncOperation(i, delay), { 
        label: `async-op-${i}` 
      })
    );
  }
  
  // Wait for all operations to complete
  await Promise.all(operations);
  
  console.log = originalLog;
  
  // Analyze results
  const concurrentResults = {
    totalOperations: numOperations,
    trackedOperations: logs.filter(log => log.includes('async-op')).length,
    allOperationsTracked: logs.filter(log => log.includes('async-op')).length === numOperations
  };
  
  console.log(`Concurrent operations tracked: ${concurrentResults.trackedOperations}/${concurrentResults.totalOperations}`);
  
  // Critical evaluation
  if (concurrentResults.trackedOperations < concurrentResults.totalOperations) {
    console.log(`⚠️ CRITICAL: Only ${concurrentResults.trackedOperations} out of ${concurrentResults.totalOperations} concurrent operations were tracked.`);
  } else {
    console.log(`✓ All concurrent operations were properly tracked`);
  }
  
  results.concurrentOperations = concurrentResults;
}

/**
 * Test 5: Edge Cases and Error Handling
 * 
 * This test evaluates how TracePerf handles various edge cases
 * including errors in tracked functions, invalid inputs, etc.
 */
console.log('\n5. Edge Cases and Error Handling');
console.log('-------------------------------');

function testEdgeCases() {
  // Create a tracker with detailed mode
  const edgeCaseTracker = createTracePerf({
    trackingMode: TrackingMode.DETAILED
  });
  
  const edgeCaseResults = {
    handlesErrors: false,
    handlesRecursion: false,
    handlesInvalidLabels: false,
    handlesZeroExecutionTime: false
  };
  
  // Test 1: Function that throws an error
  try {
    edgeCaseTracker.track(() => {
      throw new Error('Test error');
    }, { label: 'error-function' });
    
    edgeCaseResults.handlesErrors = true;
    console.log('✓ Properly handled errors in tracked functions');
  } catch (e) {
    console.log(`⚠️ CRITICAL: Failed to handle errors in tracked functions: ${e.message}`);
  }
  
  // Test 2: Recursive function
  function factorial(n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
  }
  
  const trackedFactorial = edgeCaseTracker.createTrackable(factorial, { 
    label: 'factorial' 
  });
  
  try {
    // This will cause multiple tracked calls to the same function
    trackedFactorial(5);
    
    edgeCaseResults.handlesRecursion = true;
    console.log('✓ Properly handled recursive function tracking');
  } catch (e) {
    console.log(`⚠️ CRITICAL: Failed to handle recursive function tracking: ${e.message}`);
  }
  
  // Test 3: Invalid labels
  try {
    edgeCaseTracker.track(() => {}, { label: null });
    edgeCaseTracker.track(() => {}, { label: undefined });
    edgeCaseTracker.track(() => {}, { label: 123 });
    
    edgeCaseResults.handlesInvalidLabels = true;
    console.log('✓ Properly handled invalid labels');
  } catch (e) {
    console.log(`⚠️ CRITICAL: Failed to handle invalid labels: ${e.message}`);
  }
  
  // Test 4: Zero execution time
  try {
    edgeCaseTracker.track(() => {}, { label: 'empty-function' });
    
    edgeCaseResults.handlesZeroExecutionTime = true;
    console.log('✓ Properly handled zero execution time');
  } catch (e) {
    console.log(`⚠️ CRITICAL: Failed to handle zero execution time: ${e.message}`);
  }
  
  results.edgeCases = edgeCaseResults;
}

// Run all tests
async function runAllTests() {
  try {
    await testPerformanceOverhead();
    testMemoryTracking();
    testNestedTracking();
    await testConcurrentOperations();
    testEdgeCases();
    
    // Save results to file
    fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
    
    console.log('\n==========================================');
    console.log('TracePerf Critical Evaluation Complete!');
    console.log(`Detailed results saved to: ${logFile}`);
    
    // Overall assessment
    const criticalIssuesCount = Object.values(results).reduce((count, category) => {
      // Count boolean failures in each category
      const failures = Object.values(category).filter(value => 
        typeof value === 'boolean' && value === false
      ).length;
      
      // Add any percentage-based failures (from performance overhead and memory tracking)
      if (category.overheadPercent && category.overheadPercent > 10) failures++;
      
      return count + failures;
    }, 0);
    
    if (criticalIssuesCount === 0) {
      console.log('\n✓ TracePerf passed all critical evaluation tests!');
    } else {
      console.log(`\n⚠️ TracePerf has ${criticalIssuesCount} critical issues that should be addressed.`);
    }
    
  } catch (error) {
    console.error('Error during evaluation:', error);
  }
}

// Run the tests
runAllTests(); 