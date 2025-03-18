/**
 * TracePerf API Consistency Test
 * 
 * This script tests the unified API functionality across Node.js and browser bundles.
 */

// Test Node.js bundle
console.log('=== Testing Node.js bundle ===');
try {
  // Import the Node.js bundle
  const nodeTracePerf = require('./dist/index.js');
  console.log('✅ Imported Node.js bundle successfully');
  
  // Test basic createTracePerf functionality
  const customTracer = nodeTracePerf.createTracePerf({
    trackingMode: 'balanced',
    silent: true
  });
  console.log('✅ Created custom tracer instance using createTracePerf()');
  
  // Test basic tracking functionality - sync
  const syncResult = customTracer.track(() => {
    return 'sync result';
  }, { label: 'syncTest', silent: true });
  
  console.log(`✅ Tracked sync function execution: ${syncResult}`);
  
  // Test basic tracking functionality - async
  const asyncTest = async () => {
    return await customTracer.track(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'async result';
    }, { label: 'asyncTest', silent: true });
  };
  
  asyncTest().then(result => {
    console.log(`✅ Tracked async function execution: ${result}`);
  });
  
  // Test createTrackable
  const originalFn = (x, y) => x + y;
  const trackedFn = customTracer.createTrackable(originalFn, {
    label: 'addFunction',
    silent: true
  });
  
  const trackedResult = trackedFn(5, 7);
  console.log(`✅ Created trackable function: ${trackedResult}`);
  
  // Test registerModule if available
  if (typeof customTracer.registerModule === 'function') {
    const myModule = {
      add: (a, b) => a + b,
      multiply: (a, b) => a * b
    };
    
    const trackedModule = customTracer.registerModule(myModule, {
      prefix: 'math.',
      silent: true
    });
    
    console.log(`✅ Registered module, testing function: ${trackedModule.add(3, 4)}`);
  } else {
    console.log('❌ registerModule not available in current version');
  }
  
  // Test tracking modes
  console.log('✅ Available tracking modes:');
  Object.entries(nodeTracePerf.TrackingMode).forEach(([key, value]) => {
    console.log(`  - ${key}: ${value}`);
  });
  
  // Test API shape
  console.log('✅ Node.js bundle API shape:');
  console.log('  - Default export is instance:', typeof nodeTracePerf === 'object');
  console.log('  - createTracePerf exists:', typeof nodeTracePerf.createTracePerf === 'function');
  console.log('  - Has TrackingMode enum:', !!nodeTracePerf.TrackingMode);
} catch (error) {
  console.error('❌ Error testing Node.js bundle:', error);
}

// Test Browser bundle
console.log('\n=== Testing Browser bundle ===');
try {
  // Import the browser bundle
  const browserTracePerf = require('./dist/browser.js');
  console.log('✅ Imported browser bundle successfully');
  
  // Test basic createTracePerf functionality
  const browserCustomTracer = browserTracePerf.createTracePerf({
    mode: 'dev',
    performanceThreshold: 50
  });
  console.log('✅ Created custom browser tracer instance using createTracePerf()');
  
  // Test API consistency 
  console.log('✅ Browser bundle API shape:');
  console.log('  - Default export is instance:', typeof browserTracePerf === 'object');
  console.log('  - createTracePerf exists:', typeof browserTracePerf.createTracePerf === 'function');
  console.log('  - Has TrackingMode enum:', !!browserTracePerf.TrackingMode);
  console.log('  - createBrowserLogger exists (browser-specific):', typeof browserTracePerf.createBrowserLogger === 'function');
  
  // Test tracking method exists
  console.log('  - track method exists:', typeof browserCustomTracer.track === 'function');
  console.log('  - createTrackable method exists:', typeof browserCustomTracer.createTrackable === 'function');
} catch (error) {
  console.error('❌ Error testing browser bundle:', error);
}

console.log('\n=== API Consistency Check ===');
try {
  const nodeTracePerf = require('./dist/index.js');
  const browserTracePerf = require('./dist/browser.js');
  
  // Check that both bundles export the same core functionality
  const nodeApis = ['createTracePerf', 'TrackingMode'];
  const browserApis = ['createTracePerf', 'TrackingMode'];
  
  const consistent = nodeApis.every(api => typeof nodeTracePerf[api] !== 'undefined') &&
                    browserApis.every(api => typeof browserTracePerf[api] !== 'undefined');
  
  if (consistent) {
    console.log('✅ Core APIs are consistent across Node.js and Browser bundles');
  } else {
    console.log('❌ API inconsistency detected between Node.js and Browser bundles');
  }
  
  // Check specific methods on instances
  const nodeTracer = nodeTracePerf.createTracePerf({silent: true});
  const browserTracer = browserTracePerf.createTracePerf({mode: 'dev'});
  
  const instanceMethods = ['track', 'createTrackable'];
  const instanceConsistent = instanceMethods.every(method => 
    typeof nodeTracer[method] === 'function' && 
    typeof browserTracer[method] === 'function'
  );
  
  if (instanceConsistent) {
    console.log('✅ Instance methods are consistent across Node.js and Browser bundles');
  } else {
    console.log('❌ Instance method inconsistency detected');
  }
  
  // Verify TrackingMode is the same
  const modeMatch = Object.keys(nodeTracePerf.TrackingMode).length === 
                    Object.keys(browserTracePerf.TrackingMode).length;
  
  if (modeMatch) {
    console.log('✅ TrackingMode enum is consistent across bundles');
  } else {
    console.log('❌ TrackingMode enum differs between bundles');
  }
  
  console.log('\n🎉 API Consistency Test Complete');
} catch (error) {
  console.error('❌ Error during API consistency check:', error);
} 