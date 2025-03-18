# TracePerf

Advanced performance tracking and execution monitoring for Node.js applications.

[![npm version](https://img.shields.io/npm/v/traceperf.svg)](https://www.npmjs.com/package/traceperf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

- **High-Performance Execution Monitoring**: Track function execution time with minimal overhead
- **Memory Usage Tracking**: Monitor memory consumption of your functions and identify memory leaks
- **Flexible Tracking Modes**: Choose between performance, balanced, and detailed tracking based on your needs
- **Execution Flow Visualization**: Visualize execution flows with intelligent formatting
- **Nested Function Tracking**: Track function calls within other functions to understand complex flows
- **Customizable Threshold Detection**: Focus on functions that exceed specific execution time thresholds
- **Sampling Control**: Adjust sampling rates to minimize performance impact in production
- **Universal Module Compatibility**: Works with both CommonJS and ESM environments

## Installation

```bash
npm install traceperf
```

## Quick Start

```javascript
const traceperf = require('traceperf');

// Track a synchronous function
const result = traceperf.track(() => {
  // Your code here
  return 'result';
}, { label: 'myFunction' });

// Track an asynchronous function
async function main() {
  const result = await traceperf.track(async () => {
    // Your async code here
    return 'async result';
  }, { label: 'asyncFunction' });
}
```

## Tracking Modes

TracePerf provides different tracking modes to balance performance with detail:

```javascript
const { TrackingMode, createTracePerf } = require('traceperf');

// Create a custom instance with performance-focused tracking
const performanceTracker = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE,
  silent: true,
  threshold: 100, // only track functions that take more than 100ms
  sampleRate: 0.1 // only track 10% of function calls
});

// Create a custom instance with detailed tracking for development
const devTracker = createTracePerf({
  trackingMode: TrackingMode.DETAILED,
  trackMemory: true,
  enableNestedTracking: true
});
```

## Tracking Individual Functions

```javascript
// Track a single function execution
const result = traceperf.track(() => {
  // Function body
  return someValue;
}, {
  label: 'functionName',
  threshold: 50, // ms
  trackMemory: true
});

// Create a trackable version of an existing function
const myFunction = (a, b) => a + b;
const trackedFunction = traceperf.createTrackable(myFunction, { 
  label: 'addition' 
});

// Now use it normally
const sum = trackedFunction(5, 3); // will be tracked
```

## Tracking Methods in a Module

```javascript
const userService = {
  getUser: async (id) => { /* implementation */ },
  updateUser: async (id, data) => { /* implementation */ },
  deleteUser: async (id) => { /* implementation */ }
};

// Register all methods for tracking
const trackedUserService = traceperf.registerModule(userService);

// Now all method calls will be tracked
const user = await trackedUserService.getUser(123);
```

## Advanced Configuration

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');

const customTracker = createTracePerf({
  // Tracking mode affects detail level and performance impact
  trackingMode: TrackingMode.BALANCED,
  
  // Enable or disable performance statistics in console
  silent: false,
  
  // Track memory usage (slight performance impact)
  trackMemory: true,
  
  // Enable tracking of nested function calls
  enableNestedTracking: true,
  
  // Minimum execution time to track (milliseconds)
  threshold: 50,
  
  // Percentage of function calls to track (0.0 to 1.0)
  sampleRate: 1.0
});
```

## Browser Support

TracePerf includes a browser-compatible version:

```javascript
import traceperf from 'traceperf/browser';

// Use the same API as in Node.js
traceperf.track(() => {
  // Your code
});
```

## Examples

TracePerf includes several example files to help you get started:

- **`examples/optimized-tracking-example.js`**: Demonstrates various ways to use the optimized tracking implementation
- **`examples/browser-example.js`**: Shows how to use TracePerf in browser environments

### Tracking an Async Function

```javascript
const { createTracePerf } = require('traceperf');
const traceperf = createTracePerf();

async function fetchData(url) {
  return traceperf.track(async () => {
    const response = await fetch(url);
    return response.json();
  }, { 
    label: 'fetchData',
    trackMemory: true
  });
}
```

### Tracking Nested Functions

```javascript
const { createTracePerf } = require('traceperf');
const traceperf = createTracePerf({ enableNestedTracking: true });

async function processData() {
  return await traceperf.track(async () => {
    // This function call will be automatically tracked as a child
    const data = await fetchData();
    return transformData(data);
  }, { 
    label: 'processData'
  });
}

async function fetchData() {
  return await traceperf.track(async () => {
    // Implementation
  }, { label: 'fetchData' });
}

function transformData(data) {
  return traceperf.track(() => {
    // Implementation
  }, { label: 'transformData' });
}
```

### Optimizing for Production

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');

// Development environment
const devTracker = createTracePerf({
  trackingMode: TrackingMode.DETAILED,
  silent: false,
  trackMemory: true,
  threshold: 0 // track everything
});

// Production environment
const prodTracker = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE,
  silent: true, // don't log to console
  trackMemory: false, // minimize overhead
  threshold: 100, // only track slow functions
  sampleRate: 0.01 // track only 1% of function calls
});

// Use based on environment
const traceperf = process.env.NODE_ENV === 'production' ? prodTracker : devTracker;
```

## Browser Usage

To use TracePerf in the browser:

```html
<script src="dist/traceperf.browser.js"></script>
<script>
  const { createTracePerf, TrackingMode } = TracePerf;
  
  const browserTracker = createTracePerf({
    trackingMode: TrackingMode.BALANCED,
    trackMemory: true
  });
  
  // Now use it to track your functions
  browserTracker.track(() => {
    // DOM operations or other browser-side logic
  }, { label: 'domOperation' });
</script>
```

Or with ES modules:

```javascript
import { createTracePerf, TrackingMode } from 'traceperf/browser';

const browserTracker = createTracePerf({
  trackingMode: TrackingMode.BALANCED
});

// Track a DOM operation
browserTracker.track(() => {
  document.getElementById('output').textContent = 'Updated';
}, { label: 'updateDOM' });
```

## Advanced Tracking Features

### Tracking with Different Modes

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');

// Performance mode - minimal overhead
const performanceTracker = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE
});

// Balanced mode - moderate detail with reasonable overhead
const balancedTracker = createTracePerf({
  trackingMode: TrackingMode.BALANCED
});

// Detailed mode - maximum information
const detailedTracker = createTracePerf({
  trackingMode: TrackingMode.DETAILED
});
```

### Using Thresholds to Filter Results

```javascript
const { createTracePerf } = require('traceperf');
const tracker = createTracePerf();

// Only log functions that take more than 50ms
tracker.track(slowFunction, { threshold: 50 });

// Different thresholds for different functions
tracker.track(criticalFunction, { threshold: 10 }); // Low threshold for critical paths
tracker.track(backgroundTask, { threshold: 200 }); // Higher threshold for background tasks
```

### Memory Tracking

```javascript
const { createTracePerf } = require('traceperf');
const tracker = createTracePerf({ trackMemory: true });

// Track memory usage for memory-intensive operations
const result = tracker.track(() => {
  // Memory-intensive operations
  const largeArray = new Array(1000000).fill(Math.random());
  return processArray(largeArray);
}, { label: 'memoryIntensiveOperation' });
```

For more examples, see the example files in the `examples/` directory.

## License

MIT 

## Website

Visit our website at [traceperf.com](https://traceperf.com) for more information, interactive examples, and detailed documentation. 

