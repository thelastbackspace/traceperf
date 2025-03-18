/**
 * Simple import test to diagnose the issue
 */

console.log('Attempting to import TracePerf...');

try {
  // Try the optimized import
  const tracePerf = require('./dist/index.js');
  console.log('Successfully imported from ./dist/index.js');
  console.log('Available exports:', Object.keys(tracePerf));
} catch (err) {
  console.error('Error importing from ./dist/index.js:', err);
}

try {
  // Try importing from browser bundle
  const browserTracePerf = require('./dist/browser.js');
  console.log('Successfully imported from ./dist/browser.js');
  console.log('Available browser exports:', Object.keys(browserTracePerf));
} catch (err) {
  console.error('Error importing from ./dist/browser.js:', err);
}

// Try individual imports
try {
  const types = require('./dist/types/index.js');
  console.log('Successfully imported types from ./dist/types/index.js');
  console.log('Available types:', Object.keys(types));
  console.log('TrackingMode:', types.TrackingMode);
} catch (err) {
  console.error('Error importing types:', err);
}

try {
  const core = require('./dist/core/index.js');
  console.log('Successfully imported core from ./dist/core/index.js');
  console.log('Available core exports:', Object.keys(core));
} catch (err) {
  console.error('Error importing core:', err);
}

console.log('Import test complete'); 