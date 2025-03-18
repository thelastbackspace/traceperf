/**
 * Nested Function Tracking Test
 * 
 * This example tests and verifies the nested function tracking implementation.
 */

// Load the TracePerf module from the parent directory
const tracePerf = require('../../dist');

// Initialize the tracer with development mode
tracePerf.setMode('dev');

// Helper function to simulate CPU-bound work
function simulateWork(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait to simulate CPU-bound work
  }
}

// Clear any previous execution records
tracePerf.track(() => {}, { silent: true });

console.log('==========================================================');
console.log('Test 1: Using createTrackable for nested function tracking');
console.log('==========================================================');

// Original functions
function fetchData() {
  console.log('Fetching data...');
  simulateWork(100);
  processData();
  validateData();
  return 'Data fetched and processed';
}

function processData() {
  console.log('Processing data...');
  simulateWork(150);
  calculateResults();
  return 'Data processed';
}

function calculateResults() {
  console.log('Calculating results...');
  simulateWork(80);
  return 'Results calculated';
}

function validateData() {
  console.log('Validating data...');
  simulateWork(60);
  return 'Data validated';
}

// Create tracked versions of all functions
const trackedFetchData = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
const trackedProcessData = tracePerf.createTrackable(processData, { label: 'processData' });
const trackedCalculateResults = tracePerf.createTrackable(calculateResults, { label: 'calculateResults' });
const trackedValidateData = tracePerf.createTrackable(validateData, { label: 'validateData' });
const trackedSimulateWork = tracePerf.createTrackable(simulateWork, { label: 'simulateWork' });

// Replace the global references to enable tracking of nested calls
global.processData = trackedProcessData;
global.calculateResults = trackedCalculateResults;
global.validateData = trackedValidateData;
global.simulateWork = trackedSimulateWork;

// Execute the traced function
console.log('\nRunning the nested functions with createTrackable...\n');
const result1 = trackedFetchData();
console.log('\nResult:', result1);
console.log('\nFlow chart for createTrackable approach:');

// Clear execution records and simulate reset
tracePerf.track(() => {}, { silent: true });

// Test 2: Using nested track calls
console.log('\n\n=================================================');
console.log('Test 2: Using explicit nested track function calls');
console.log('=================================================');

// Reset the global references to their original forms
global.processData = processData;
global.calculateResults = calculateResults;
global.validateData = validateData;
global.simulateWork = simulateWork;

// Use nested track calls directly
console.log('\nRunning the nested functions with explicit track calls...\n');
const result2 = tracePerf.track(() => {
  console.log('Fetching data...');
  
  tracePerf.track(() => {
    simulateWork(100);
  }, { label: 'simulateWork (in fetchData)' });
  
  tracePerf.track(() => {
    console.log('Processing data...');
    
    tracePerf.track(() => {
      simulateWork(150);
    }, { label: 'simulateWork (in processData)' });
    
    tracePerf.track(() => {
      console.log('Calculating results...');
      
      tracePerf.track(() => {
        simulateWork(80);
      }, { label: 'simulateWork (in calculateResults)' });
      
      return 'Results calculated';
    }, { label: 'calculateResults' });
    
    return 'Data processed';
  }, { label: 'processData' });
  
  tracePerf.track(() => {
    console.log('Validating data...');
    
    tracePerf.track(() => {
      simulateWork(60);
    }, { label: 'simulateWork (in validateData)' });
    
    return 'Data validated';
  }, { label: 'validateData' });
  
  return 'Data fetched and processed';
}, { label: 'fetchData' });

console.log('\nResult:', result2);
console.log('\nFlow chart for explicit track calls approach:');

// Test 3: Test enableNestedTracking option
console.log('\n\n=================================================');
console.log('Test 3: Testing enableNestedTracking option');
console.log('=================================================');

// Clear execution records
tracePerf.track(() => {}, { silent: true });

// Reset everything back to original functions
global.processData = processData;
global.calculateResults = calculateResults;
global.validateData = validateData;
global.simulateWork = simulateWork;

// Create tracked versions again
const trackedFetchData3 = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
const trackedProcessData3 = tracePerf.createTrackable(processData, { label: 'processData' });
const trackedCalculateResults3 = tracePerf.createTrackable(calculateResults, { label: 'calculateResults' });
const trackedValidateData3 = tracePerf.createTrackable(validateData, { label: 'validateData' });
const trackedSimulateWork3 = tracePerf.createTrackable(simulateWork, { label: 'simulateWork' });

// Replace references except for calculateResults
global.processData = trackedProcessData3;
global.validateData = trackedValidateData3;
global.simulateWork = trackedSimulateWork3;

console.log('\nRunning with enableNestedTracking set to false...\n');
// Disable nested tracking when executing fetchData
const result3 = trackedFetchData3();
console.log('\nResult:', result3);
console.log('\nFlow chart with enableNestedTracking enabled (default):');

// Clear and test with enableNestedTracking disabled
tracePerf.track(() => {}, { silent: true });

console.log('\nRunning with enableNestedTracking set to false...\n');
const result4 = tracePerf.track(() => fetchData(), { 
  label: 'fetchData',
  enableNestedTracking: false 
});
console.log('\nResult:', result4);
console.log('\nFlow chart with enableNestedTracking disabled:');

console.log('\n\nAll tests completed.'); 