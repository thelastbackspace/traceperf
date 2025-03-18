/**
 * Memory Tracking Test
 * 
 * This example demonstrates the improved memory tracking in TracePerf.
 */

// Load the TracePerf module
const tracePerf = require('../../dist');

// Initialize the tracer with development mode
tracePerf.setMode('dev');

// Clear any previous execution records
tracePerf.track(() => {}, { silent: true });

console.log('==========================================================');
console.log('Test 1: Function that allocates memory');
console.log('==========================================================');

function allocateMemory() {
  // Create a large array to allocate memory
  const largeArray = new Array(1000000).fill('x');
  
  // Do something with the array to prevent optimization
  const sum = largeArray.reduce((acc, val) => acc + val.charCodeAt(0), 0);
  
  console.log(`Array created with sum: ${sum}`);
  return largeArray;
}

// Track memory allocation
console.log('\nRunning memory allocation test...\n');
const result1 = tracePerf.track(allocateMemory, { 
  label: 'allocateMemory',
  includeMemory: true 
});

console.log('\n==========================================================');
console.log('Test 2: Function that allocates and frees memory');
console.log('==========================================================');

function allocateAndFreeMemory() {
  // Allocate memory
  let arrays = [];
  for (let i = 0; i < 5; i++) {
    arrays.push(new Array(200000).fill('x'));
  }
  
  // Use arrays to prevent optimization
  let sum = 0;
  for (const arr of arrays) {
    sum += arr.length;
  }
  console.log(`Arrays created with total length: ${sum}`);
  
  // Free memory
  arrays = null;
  
  // Force garbage collection if available
  if (global.gc) {
    try {
      global.gc();
      console.log('Garbage collection executed');
    } catch (e) {
      console.log('Garbage collection not available');
    }
  }
  
  return sum;
}

// Track memory allocation and freeing
console.log('\nRunning memory allocation and freeing test...\n');
const result2 = tracePerf.track(allocateAndFreeMemory, { 
  label: 'allocateAndFreeMemory',
  includeMemory: true 
});

console.log('\n==========================================================');
console.log('Test 3: Nested functions with memory tracking');
console.log('==========================================================');

function outerFunction() {
  // Allocate some memory
  const outerArray = new Array(300000).fill('a');
  console.log(`Outer array created with length: ${outerArray.length}`);
  
  // Call inner function
  return innerFunction();
}

function innerFunction() {
  // Allocate more memory
  const innerArray = new Array(500000).fill('b');
  console.log(`Inner array created with length: ${innerArray.length}`);
  
  return innerArray.length;
}

// Create trackable versions
const trackedInnerFunction = tracePerf.createTrackable(innerFunction, { label: 'innerFunction' });
const trackedOuterFunction = tracePerf.createTrackable(outerFunction, { label: 'outerFunction' });

// Replace the global references
global.innerFunction = trackedInnerFunction;

// Execute with nested tracking
console.log('\nRunning nested function memory tracking test...\n');
const result3 = trackedOuterFunction();

console.log('\nAll memory tracking tests completed.'); 