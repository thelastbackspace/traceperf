/**
 * TracePerf Browser Example
 * 
 * This example demonstrates how to use TracePerf in a browser environment.
 * To use this example:
 * 1. Build the library with 'npm run build:all'
 * 2. Include this file in an HTML page along with the browser bundle
 * 3. Open the browser console to see the output
 */

// This code assumes the browser bundle is available as 'TracePerf'
(function() {
  // Get the browser-compatible version
  const { createTracePerf, TrackingMode } = TracePerf;
  
  // Create a custom tracker for the browser environment
  const browserTracker = createTracePerf({
    trackingMode: TrackingMode.BALANCED,
    trackMemory: true,
    threshold: 0, // Track everything
    silent: false
  });
  
  console.log('TracePerf Browser Example - Check console for performance data');
  
  // Example 1: Basic DOM operation tracking
  function updateDOMElement() {
    // Simulate some DOM operations
    const start = performance.now();
    while (performance.now() - start < 20) {}
    
    // Update a DOM element if we're in a browser environment
    if (typeof document !== 'undefined') {
      const element = document.getElementById('output');
      if (element) {
        element.textContent = 'Updated at ' + new Date().toISOString();
      }
    }
    
    return 'DOM updated';
  }
  
  // Track the DOM operation
  browserTracker.track(updateDOMElement, { label: 'updateDOM' });
  
  // Example 2: Tracking async operations in browser
  async function fetchSomeData() {
    // Simulate an API call
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({ success: true, data: [1, 2, 3, 4, 5] });
      }, 100);
    });
  }
  
  browserTracker.track(async () => {
    const data = await fetchSomeData();
    console.log('Fetched data:', data);
    
    // Update DOM with the data if available
    if (typeof document !== 'undefined') {
      const element = document.getElementById('data-output');
      if (element) {
        element.textContent = JSON.stringify(data);
      }
    }
    
    return data;
  }, { label: 'fetchAndDisplayData' });
  
  // Example 3: Tracking event handlers
  function setupEventListeners() {
    if (typeof document === 'undefined') return;
    
    // Get button element
    const button = document.getElementById('action-button');
    if (!button) return;
    
    // Create a tracked event handler
    const handleClick = browserTracker.createTrackable(function() {
      console.log('Button clicked!');
      // Simulate some work
      const start = performance.now();
      while (performance.now() - start < 30) {}
      
      // Update UI
      const result = document.getElementById('click-result');
      if (result) {
        result.textContent = 'Button clicked at ' + new Date().toISOString();
      }
    }, { label: 'buttonClickHandler' });
    
    // Attach the tracked event handler
    button.addEventListener('click', handleClick);
    console.log('Event listeners set up - click the button to see tracking');
  }
  
  // Set up the event listeners
  setupEventListeners();
  
  // Example 4: Tracking multiple operations with different thresholds
  function runComplexOperation() {
    console.log('Running complex browser operations with different thresholds');
    
    // Fast operation - won't be tracked with higher threshold
    browserTracker.track(() => {
      const start = performance.now();
      while (performance.now() - start < 5) {}
      return 'Fast operation';
    }, { 
      label: 'fastOperation',
      threshold: 10 // This operation takes ~5ms, so it won't be tracked
    });
    
    // Medium operation - will be tracked
    browserTracker.track(() => {
      const start = performance.now();
      while (performance.now() - start < 20) {}
      return 'Medium operation';
    }, { 
      label: 'mediumOperation',
      threshold: 10 // This operation takes ~20ms, so it will be tracked
    });
    
    // Slow operation - will definitely be tracked
    browserTracker.track(() => {
      const start = performance.now();
      while (performance.now() - start < 50) {}
      return 'Slow operation';
    }, { 
      label: 'slowOperation',
      threshold: 10 // This operation takes ~50ms, so it will be tracked
    });
  }
  
  // Run the complex operations
  runComplexOperation();
  
  // Expose the tracker for manual testing in the console
  window.traceperf = browserTracker;
  console.log('TracePerf is available in the console as `traceperf`');
})(); 