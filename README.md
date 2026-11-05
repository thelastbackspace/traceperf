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

- `PERFORMANCE`: lowest overhead. No memory sampling and **no console output**, even with `silent: false`.
- `BALANCED` (default): prints an execution tree with duration and heap change.
- `DETAILED` / `DEBUG`: like `BALANCED`, and failed calls also show their error message (`✖ message`).

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

Output (one tree per outermost tracked call, printed when it finishes):

```
└─ addition: 0.088 ms 📊 +2.48 KB
```

### Logging Arguments

Pass `captureArgs: true` to include a short, safe rendering of the arguments in the output:

```javascript
const getUser = traceperf.createTrackable((id, opts) => ({ id }), {
  label: 'getUser',
  captureArgs: true
});
getUser(123, { cache: true });
// └─ getUser(123, {"cache":true}): 0.051 ms 📊 +0.98 KB
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
  
  // Only report calls that take at least this long (milliseconds).
  // Default 0: report every call.
  threshold: 50,
  
  // Percentage of function calls to track (0.0 to 1.0)
  sampleRate: 1.0
});
```

## Browser Support

TracePerf provides a browser implementation with the same `track` / `createTrackable` API and options (`silent`, `trackMemory`, `threshold`, `trackingMode`, `enableNestedTracking`):

```javascript
import { createTracePerf, BrowserLogger } from 'traceperf/browser';

// Create a browser-optimized instance
const browserTracker = createTracePerf({
  logger: new BrowserLogger({
    silent: false,
    trackMemory: true
  })
});

// Track function execution
browserTracker.track(() => {
  // Your browser-side code
}, { label: 'browserOperation' });

// Create trackable functions
const trackedFn = browserTracker.createTrackable(() => {
  // Function implementation
}, { label: 'trackedBrowserFn' });

// Track async operations
await browserTracker.track(async () => {
  const response = await fetch('/api/data');
  return response.json();
}, { label: 'fetchData' });
```

You can also use it via script tag:

```html
<script src="dist/traceperf.browser.js"></script>
<script>
  const { createTracePerf, BrowserLogger } = TracePerf;
  
  const browserTracker = createTracePerf({
    logger: new BrowserLogger({
      silent: false,
      trackMemory: true
    })
  });
  
  // Use the same API as in Node.js
  browserTracker.track(() => {
    // DOM operations or other browser-side logic
  }, { label: 'domOperation' });
</script>
```

## Synchronized Features

TracePerf now provides a consistent API across Node.js and browser environments:

- **Unified Tracking API**: `track()` and `createTrackable()` work the same way in both environments (`registerModule`, `setConfig` and the other configuration helpers are Node.js-only for now)
- **Consistent Configuration**: Logger and tracker options are synchronized
- **Memory Tracking**: Both environments support memory usage tracking
- **Performance Optimization**: Browser-specific optimizations while maintaining API compatibility
- **Execution Flow**: Track complex execution flows consistently across environments

Example of cross-environment usage:

<!-- docs:skip -->
```javascript
// Node.js
const { createTracePerf } = require('traceperf');
const nodeTracker = createTracePerf();

// Browser
import { createTracePerf } from 'traceperf/browser';
const browserTracker = createTracePerf();

// Both environments support the same API
async function trackOperation(tracker) {
  return await tracker.track(async () => {
    const result = await someAsyncOperation();
    return processResult(result);
  }, { 
    label: 'mainOperation',
    trackMemory: true
  });
}
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
    // Tracked calls made inside a tracked call are recorded as its children
    // (on Node.js this also works across `await`; in browsers only for calls
    // made before the first `await`)
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

processData();
```

Calling `processData()` prints a single tree once it finishes:

```
└─ processData: 12.908 ms 📊 +2.12 KB
  ├─ fetchData: 12.197 ms 📊 +1.03 KB
  └─ transformData: 0.075 ms 📊 +0.41 KB
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
// Note: PERFORMANCE mode never prints; use BALANCED with a threshold and a
// low sampleRate if you want slow calls reported in production.
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

// Only log calls that take at least 50ms (faster calls print nothing)
tracker.track(slowFunction, { threshold: 50 });

// Different thresholds for different functions
tracker.track(criticalFunction, { threshold: 10 }); // Low threshold for critical paths
tracker.track(backgroundTask, { threshold: 200 }); // Higher threshold for background tasks
```