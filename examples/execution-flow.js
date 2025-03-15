// Import the default logger
const tracePerf = require('../dist').default;

// Define some functions to track
function fetchData() {
  console.log('Fetching data...');
  // Simulate a network request
  const start = Date.now();
  while (Date.now() - start < 200) {
    // Busy wait to simulate work
  }
  return processData();
}

function processData() {
  console.log('Processing data...');
  // Simulate processing
  const start = Date.now();
  while (Date.now() - start < 500) {
    // Busy wait to simulate work
  }
  return calculateResults();
}

function calculateResults() {
  console.log('Calculating results...');
  // Simulate calculation
  const start = Date.now();
  while (Date.now() - start < 300) {
    // Busy wait to simulate work
  }
  return 'done';
}

// Track the execution of the fetchData function
console.log('\n--- Execution Flow Tracking ---');
const result = tracePerf.track(fetchData);
console.log('Result:', result);

// Track with custom options
console.log('\n--- Custom Tracking Options ---');
tracePerf.track(() => {
  console.log('Running with custom options...');
  // Simulate work
  const start = Date.now();
  while (Date.now() - start < 150) {
    // Busy wait to simulate work
  }
}, {
  label: 'CustomFunction',
  threshold: 100,
  includeMemory: true,
});

// Track nested functions with different thresholds
console.log('\n--- Nested Function Tracking ---');
tracePerf.track(() => {
  console.log('Outer function');
  
  // Simulate work
  const start1 = Date.now();
  while (Date.now() - start1 < 100) {
    // Busy wait to simulate work
  }
  
  tracePerf.track(() => {
    console.log('Middle function');
    
    // Simulate work
    const start2 = Date.now();
    while (Date.now() - start2 < 200) {
      // Busy wait to simulate work
    }
    
    tracePerf.track(() => {
      console.log('Inner function');
      
      // Simulate work
      const start3 = Date.now();
      while (Date.now() - start3 < 300) {
        // Busy wait to simulate work
      }
    }, { label: 'InnerFunction', threshold: 200 });
  }, { label: 'MiddleFunction', threshold: 150 });
}, { label: 'OuterFunction', threshold: 50 }); 