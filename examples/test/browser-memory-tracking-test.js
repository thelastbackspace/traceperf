/**
 * Browser Memory Tracking Test
 * 
 * This test demonstrates the memory tracking issues in the browser environment and tests our fixes.
 */

// Import the browser version of the library
const tracePerf = require('../../dist/browser');

// Initialize the tracer in development mode
tracePerf.setMode('dev');

// Helper function to perform a memory-intensive operation in browsers
function allocateMemory(sizeInMB) {
  console.log(`Allocating approximately ${sizeInMB}MB of memory...`);
  const bytesPerMB = 1024 * 1024;
  const totalBytes = sizeInMB * bytesPerMB;
  
  // Allocate arrays of numbers to consume memory
  const arrays = [];
  const chunkSize = 1024 * 100; // 100KB chunks
  const chunks = Math.ceil(totalBytes / chunkSize);
  
  for (let i = 0; i < chunks; i++) {
    arrays.push(new Array(chunkSize / 8).fill(0).map((_, idx) => idx));
  }
  
  return arrays;
}

// Function that releases memory
function releaseMemory(arrays) {
  console.log('Releasing allocated memory...');
  while (arrays.length) {
    arrays.pop();
  }
}

// Test 1: Basic memory tracking in browser
function testBasicMemoryTracking() {
  console.log('\n--- Test 1: Basic Browser Memory Tracking ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Track memory allocation
  const memoryArrays = tracePerf.track(() => {
    return allocateMemory(10); // Allocate 10MB
  }, { label: 'allocateMemory' });
  
  // Track memory release in a separate operation
  tracePerf.track(() => {
    releaseMemory(memoryArrays);
  }, { label: 'releaseMemory' });
  
  console.log('\nBrowser memory tracking completed for Test 1.');
}

// Test 2: Nested function memory tracking in browser
function testNestedMemoryTracking() {
  console.log('\n--- Test 2: Nested Browser Memory Tracking ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Create trackable versions of functions
  const trackedAllocateMemory = tracePerf.createTrackable(allocateMemory, { label: 'allocateMemory' });
  const trackedReleaseMemory = tracePerf.createTrackable(releaseMemory, { label: 'releaseMemory' });
  
  // Replace global references
  global.allocateMemory = trackedAllocateMemory;
  global.releaseMemory = trackedReleaseMemory;
  
  // Track the top-level function with nested calls
  tracePerf.track(() => {
    console.log('Starting memory operations...');
    
    // Allocate memory
    const arrays = allocateMemory(5);
    
    // Allocate more memory
    const moreArrays = allocateMemory(5);
    
    // Release memory
    releaseMemory(arrays);
    releaseMemory(moreArrays);
    
    console.log('Memory operations completed.');
  }, { label: 'memoryOperations' });
  
  // Restore original functions
  global.allocateMemory = allocateMemory;
  global.releaseMemory = releaseMemory;
  
  console.log('\nBrowser memory tracking completed for Test 2.');
}

// Run the tests
testBasicMemoryTracking();
testNestedMemoryTracking();

console.log('\nAll browser memory tracking tests completed.'); 