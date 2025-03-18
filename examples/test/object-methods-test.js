/**
 * Object Methods Tracking Test
 * 
 * This example tests tracking object methods and verifies that 'this' context is maintained.
 */

// Load the TracePerf module from the parent directory
const tracePerf = require('../../dist');

// Initialize the tracer with development mode
tracePerf.setMode('dev');

// Clear any previous execution records
tracePerf.track(() => {}, { silent: true });

console.log('==========================================================');
console.log('Testing createTrackable with object methods and this context');
console.log('==========================================================');

// Create a class with methods to test
class DataProcessor {
  constructor(name) {
    this.name = name;
    this.data = [];
    
    // Bind the tracked methods
    this.fetchData = tracePerf.createTrackable(this.fetchData.bind(this), { label: 'fetchData' });
    this.processData = tracePerf.createTrackable(this.processData.bind(this), { label: 'processData' });
    this.analyzeData = tracePerf.createTrackable(this.analyzeData.bind(this), { label: 'analyzeData' });
    this.validateData = tracePerf.createTrackable(this.validateData.bind(this), { label: 'validateData' });
    this.simulateWork = tracePerf.createTrackable(this.simulateWork.bind(this), { label: 'simulateWork' });
  }
  
  fetchData() {
    console.log(`[${this.name}] Fetching data...`);
    this.data = [1, 2, 3, 4, 5];
    this.simulateWork(100);
    this.processData();
    this.validateData();
    return this.data;
  }
  
  processData() {
    console.log(`[${this.name}] Processing data...`);
    this.simulateWork(150);
    this.data = this.data.map(x => x * 2);
    this.analyzeData();
    return this.data;
  }
  
  analyzeData() {
    console.log(`[${this.name}] Analyzing data...`);
    this.simulateWork(80);
    const sum = this.data.reduce((a, b) => a + b, 0);
    console.log(`[${this.name}] Sum of data: ${sum}`);
    return sum;
  }
  
  validateData() {
    console.log(`[${this.name}] Validating data...`);
    this.simulateWork(60);
    const isValid = this.data.every(x => x > 0);
    console.log(`[${this.name}] Data is ${isValid ? 'valid' : 'invalid'}`);
    return isValid;
  }
  
  simulateWork(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait to simulate CPU-bound work
    }
  }
}

// Create an instance of the processor
const processor = new DataProcessor('TestProcessor');

// Execute the tracked method
console.log('\nRunning the processor with tracked methods...\n');
const result = processor.fetchData();
console.log('\nResult:', result);
console.log('\nFlow chart for object methods:');

// Test factory pattern
console.log('\n\n=================================================');
console.log('Testing factory pattern with tracked methods');
console.log('=================================================');

// Clear execution records
tracePerf.track(() => {}, { silent: true });

// Factory function that creates an object with tracked methods
function createTrackedProcessor(name) {
  // Create the base object
  const processor = {
    name,
    data: [],
    
    _fetchData() {
      console.log(`[${this.name}] Fetching data...`);
      this.data = [1, 2, 3, 4, 5];
      this.simulateWork(100);
      this.processData();
      this.validateData();
      return this.data;
    },
    
    _processData() {
      console.log(`[${this.name}] Processing data...`);
      this.simulateWork(150);
      this.data = this.data.map(x => x * 2);
      this.analyzeData();
      return this.data;
    },
    
    _analyzeData() {
      console.log(`[${this.name}] Analyzing data...`);
      this.simulateWork(80);
      const sum = this.data.reduce((a, b) => a + b, 0);
      console.log(`[${this.name}] Sum of data: ${sum}`);
      return sum;
    },
    
    _validateData() {
      console.log(`[${this.name}] Validating data...`);
      this.simulateWork(60);
      const isValid = this.data.every(x => x > 0);
      console.log(`[${this.name}] Data is ${isValid ? 'valid' : 'invalid'}`);
      return isValid;
    },
    
    _simulateWork(ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        // Busy wait to simulate CPU-bound work
      }
    }
  };
  
  // Create tracked versions of all methods
  processor.fetchData = tracePerf.createTrackable(processor._fetchData.bind(processor), { label: 'fetchData' });
  processor.processData = tracePerf.createTrackable(processor._processData.bind(processor), { label: 'processData' });
  processor.analyzeData = tracePerf.createTrackable(processor._analyzeData.bind(processor), { label: 'analyzeData' });
  processor.validateData = tracePerf.createTrackable(processor._validateData.bind(processor), { label: 'validateData' });
  processor.simulateWork = tracePerf.createTrackable(processor._simulateWork.bind(processor), { label: 'simulateWork' });
  
  return processor;
}

// Create a tracked processor
const factoryProcessor = createTrackedProcessor('FactoryProcessor');

// Execute the tracked method
console.log('\nRunning the factory processor with tracked methods...\n');
const factoryResult = factoryProcessor.fetchData();
console.log('\nResult:', factoryResult);
console.log('\nFlow chart for factory object methods:');

console.log('\n\nAll object method tests completed.'); 