/**
 * Auto-Tracking Example
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
  global.simulateWork = trackedSimulateWork;
  global.calculateResults = trackedCalculateResults;
  global.processData = trackedProcessData;
  
  // Execute the tracked top-level function
  const result = trackedFetchData();
  
  console.log('\nResult:', result);
}

// Example 2: Using track directly
function example2() {
  console.log('\n--- Example 2: Using track directly with nested functions ---\n');
  
  // Clear any previous execution records
  tracePerf.track(() => {}, { silent: true });
  
  // Track the execution of the top-level function
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
}

// Run the examples
example1();
example2();