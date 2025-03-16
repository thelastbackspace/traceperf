/**
 * Nested Function Tracking Example
 * 
 * This example demonstrates how to track nested function calls using TracePerf.
 */

const tracePerf = require('../dist');

// Initialize the tracer with development mode
tracePerf.setMode('dev');

/**
 * Example 1: Using createTrackable with standalone functions
 */
function example1() {
  console.log('\n--- Example 1: Using createTrackable with standalone functions ---\n');
  
  // Original functions
  function fetchData() {
    console.log('Fetching data...');
    simulateWork(200);
    processData();
    return 'Data fetched';
  }
  
  function processData() {
    console.log('Processing data...');
    simulateWork(500);
    calculateResults();
    return 'Data processed';
  }
  
  function calculateResults() {
    console.log('Calculating results...');
    simulateWork(300);
    return 'Results calculated';
  }
  
  function simulateWork(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait to simulate CPU-bound work
    }
  }
  
  // Create tracked versions
  const trackedFetchData = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
  const trackedProcessData = tracePerf.createTrackable(processData, { label: 'processData' });
  const trackedCalculateResults = tracePerf.createTrackable(calculateResults, { label: 'calculateResults' });
  const trackedSimulateWork = tracePerf.createTrackable(simulateWork, { label: 'simulateWork' });
  
  // Replace the global references
  global.processData = trackedProcessData;
  global.calculateResults = trackedCalculateResults;
  global.simulateWork = trackedSimulateWork;
  
  // Execute the top-level function
  const result = trackedFetchData();
  console.log('Result:', result);
}

/**
 * Example 2: Using createTrackable with object methods
 */
function example2() {
  console.log('\n--- Example 2: Using createTrackable with object methods ---\n');
  
  // Define our application functions
  const app = {
    // Original functions
    _fetchData() {
      console.log('Fetching data...');
      this.simulateWork(200);
      this.processData();
      return 'Data fetched';
    },
    
    _processData() {
      console.log('Processing data...');
      this.simulateWork(500);
      this.calculateResults();
      return 'Data processed';
    },
    
    _calculateResults() {
      console.log('Calculating results...');
      this.simulateWork(300);
      return 'Results calculated';
    },
    
    _simulateWork(ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        // Busy wait to simulate CPU-bound work
      }
    },
    
    // Tracked versions
    fetchData: null,
    processData: null,
    calculateResults: null,
    simulateWork: null
  };
  
  // Create tracked versions of all functions
  app.fetchData = tracePerf.createTrackable(app._fetchData.bind(app), { label: 'fetchData' });
  app.processData = tracePerf.createTrackable(app._processData.bind(app), { label: 'processData' });
  app.calculateResults = tracePerf.createTrackable(app._calculateResults.bind(app), { label: 'calculateResults' });
  app.simulateWork = tracePerf.createTrackable(app._simulateWork.bind(app), { label: 'simulateWork' });
  
  // Execute the top-level function
  const result = app.fetchData();
  console.log('Result:', result);
}

// Run the examples
example1();
example2(); 