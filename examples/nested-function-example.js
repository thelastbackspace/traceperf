/**
 * Nested Function Tracking Example
 * 
 * This example demonstrates two approaches to tracking nested function calls:
 * 1. Using createTrackable to create tracked versions of functions
 * 2. Using track directly with nested function calls
 */

// Import the default logger instance
const tracePerf = require('../dist');

// Initialize the tracer in development mode
tracePerf.setMode('dev');

// Helper function to simulate CPU-bound work
function simulateWork(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait
  }
}

// Define our functions
function fetchData() {
  console.log('Fetching data...');
  simulateWork(300); // Simulate network delay
  const result = processData();
  return `Data fetched: ${result}`;
}

function processData() {
  console.log('Processing data...');
  simulateWork(200);
  const result = calculateResults();
  return result;
}

function calculateResults() {
  console.log('Calculating results...');
  simulateWork(100);
  return 'Data processed';
}

// Example 1: Using createTrackable
function example1() {
  console.log('\n--- Example 1: Using createTrackable for nested function tracking ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Create trackable versions of all functions
  const trackedSimulateWork = tracePerf.createTrackable(simulateWork, { label: 'simulateWork' });
  const trackedCalculateResults = tracePerf.createTrackable(calculateResults, { label: 'calculateResults' });
  const trackedProcessData = tracePerf.createTrackable(processData, { label: 'processData' });
  const trackedFetchData = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
  
  // Replace the global references to enable tracking
  // This step is crucial for tracking nested calls
  global.simulateWork = trackedSimulateWork;
  global.calculateResults = trackedCalculateResults;
  global.processData = trackedProcessData;
  
  // Execute the tracked top-level function
  console.log('Running with the createTrackable approach...');
  const result = trackedFetchData();
  
  console.log('\nResult:', result);
  console.log('\nNote: For the createTrackable approach to work properly with nested functions,');
  console.log('you must replace the global references to the functions as shown above.');
}

// Example 2: Using track directly
function example2() {
  console.log('\n--- Example 2: Using track directly with nested functions ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Reset the global references to their original forms
  global.simulateWork = simulateWork;
  global.calculateResults = calculateResults;
  global.processData = processData;
  
  // Track the execution of the top-level function
  console.log('Running with explicit nested track calls...');
  const result = tracePerf.track(() => {
    console.log('Fetching data...');
    
    // Track the simulateWork function
    tracePerf.track(() => {
      simulateWork(300);
    }, { label: 'simulateWork (network delay)' });
    
    // Track the processData function
    const processResult = tracePerf.track(() => {
      console.log('Processing data...');
      
      // Track the simulateWork function again
      tracePerf.track(() => {
        simulateWork(200);
      }, { label: 'simulateWork (processing)' });
      
      // Track the calculateResults function
      const calcResult = tracePerf.track(() => {
        console.log('Calculating results...');
        
        // Track the simulateWork function one more time
        tracePerf.track(() => {
          simulateWork(100);
        }, { label: 'simulateWork (calculation)' });
        
        return 'Data processed';
      }, { label: 'calculateResults' });
      
      return calcResult;
    }, { label: 'processData' });
    
    return `Data fetched: ${processResult}`;
  }, { label: 'fetchData' });
  
  console.log('\nResult:', result);
  console.log('\nNote: The explicit nested track calls approach requires more manual instrumentation');
  console.log('but gives you precise control over what gets tracked.');
}

// Example 3: Disabling nested tracking
function example3() {
  console.log('\n--- Example 3: Disabling nested tracking ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Reset the global references to their original forms
  global.simulateWork = simulateWork;
  global.calculateResults = calculateResults;
  global.processData = processData;
  
  // Create trackable version only for the top-level function
  const trackedFetchData = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
  
  // Execute with nested tracking disabled
  console.log('Running with enableNestedTracking set to false...');
  const result = tracePerf.track(() => {
    return trackedFetchData();
  }, { 
    label: 'trackedFetchData',
    enableNestedTracking: false 
  });
  
  console.log('\nResult:', result);
  console.log('\nNote: With enableNestedTracking set to false, only the top-level function is tracked,');
  console.log('and no nested function calls are included in the tracking.');
}

// Run the examples
example1();
example2();
example3();