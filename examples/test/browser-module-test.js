/**
 * Browser Module CommonJS Compatibility Test
 * 
 * This example tests CommonJS compatibility of the browser module.
 */

// Testing CommonJS require format
console.log('Testing CommonJS require format...');
try {
  const tracePerfBrowser = require('../../dist/browser');
  console.log('✅ Successfully imported browser module with require()');
  console.log('   Module type:', typeof tracePerfBrowser);
  console.log('   Has track method:', typeof tracePerfBrowser.track === 'function');
  console.log('   Has createTrackable method:', typeof tracePerfBrowser.createTrackable === 'function');
  
  // Test basic functions
  console.log('\nTesting basic functions...');
  tracePerfBrowser.info('This is an info message from browser module');
  tracePerfBrowser.warn('This is a warning message from browser module');
  
  // Test nested function tracking with createTrackable
  console.log('\nTesting nested function tracking with createTrackable...');
  
  function fetchData() {
    console.log('Browser: Fetching data...');
    processData();
    return 'Data fetched';
  }
  
  function processData() {
    console.log('Browser: Processing data...');
    calculateResults();
    return 'Data processed';
  }
  
  function calculateResults() {
    console.log('Browser: Calculating results...');
    return 'Results calculated';
  }
  
  // Create tracked versions
  const trackedFetchData = tracePerfBrowser.createTrackable(fetchData, { label: 'fetchData' });
  const trackedProcessData = tracePerfBrowser.createTrackable(processData, { label: 'processData' });
  const trackedCalculateResults = tracePerfBrowser.createTrackable(calculateResults, { label: 'calculateResults' });
  
  // Replace the global references
  global.processData = trackedProcessData;
  global.calculateResults = trackedCalculateResults;
  
  // Execute the tracked function
  console.log('\nExecuting tracked functions...');
  const result = trackedFetchData();
  console.log('Result:', result);
  console.log('\nAll browser module tests completed successfully.');
  
} catch (error) {
  console.error('❌ Error importing browser module with require():', error.message);
}

console.log('\nTesting createBrowserLogger function...');
try {
  const { createBrowserLogger } = require('../../dist/browser');
  const customLogger = createBrowserLogger({
    mode: 'dev',
    performanceThreshold: 50
  });
  
  console.log('✅ Successfully created custom browser logger');
  console.log('   Logger mode:', customLogger.getMode());
  
  // Test basic functions of custom logger
  customLogger.info('This is an info message from custom browser logger');
  customLogger.warn('This is a warning message from custom browser logger');
  
  console.log('\nCustom browser logger tests completed successfully.');
} catch (error) {
  console.error('❌ Error creating custom browser logger:', error.message);
} 