# TracePerf

Advanced console logging & performance tracking for Node.js applications.

[![npm version](https://img.shields.io/npm/v/traceperf.svg)](https://www.npmjs.com/package/traceperf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

- **Structured and Visually Appealing Logs**: A better alternative to `console.log()` with colors, icons, and formatting.
- **Execution Flow Tracing**: Track function calls and visualize the execution flow with ASCII art.
- **Nested Function Tracking**: Multiple approaches to track nested function calls with detailed visualization.
- **Performance Bottleneck Detection**: Identify slow functions and get suggestions for optimization.
- **Conditional Logging Modes**: Different logging levels for development, staging, and production.
- **Nested Logging**: Group related logs with indentation for better readability.
- **Auto-Remove Debug Logs**: Automatically filter out debug logs in production.
- **Universal Module Compatibility**: Works with both CommonJS and ESM environments.

## Installation

```bash
npm install traceperf
```

## Basic Usage

### CommonJS (Node.js)

```javascript
const tracePerf = require('traceperf');

// Basic logging
tracePerf.info('This is an info message');
tracePerf.warn('This is a warning message');
tracePerf.error('This is an error message');
tracePerf.debug('This is a debug message');

// Logging with objects
tracePerf.info('User data:', { id: 1, name: 'John Doe' });

// Nested logging with groups
tracePerf.group('User Authentication');
tracePerf.info('Checking credentials');
tracePerf.warn('Invalid password attempt');
tracePerf.groupEnd();
```

### ESM (ECMAScript Modules)

```javascript
import tracePerf from 'traceperf';

// Use the same API as with CommonJS
tracePerf.info('This is an info message');
```



## Conditional Logging Modes

```javascript
// Development mode (default)
tracePerf.setMode('dev');
tracePerf.debug('Debug message'); // Shown
tracePerf.info('Info message');   // Shown
tracePerf.warn('Warning message'); // Shown
tracePerf.error('Error message'); // Shown

// Staging mode
tracePerf.setMode('staging');
tracePerf.debug('Debug message'); // Not shown
tracePerf.info('Info message');   // Not shown
tracePerf.warn('Warning message'); // Shown
tracePerf.error('Error message'); // Shown

// Production mode
tracePerf.setMode('prod');
tracePerf.debug('Debug message'); // Not shown
tracePerf.info('Info message');   // Not shown
tracePerf.warn('Warning message'); // Not shown
tracePerf.error('Error message'); // Shown
```

## Browser Usage (React, Next.js, etc.)

TracePerf also provides a browser-compatible version for use in frontend applications:

### ESM (Modern Browsers)

```javascript
// Import the browser version
import tracePerf from 'traceperf/browser';

// Use it just like the Node.js version
tracePerf.info('This works in the browser!');
```

### CommonJS (Bundlers with CommonJS support)

```javascript
// Import the browser version with require
const tracePerf = require('traceperf/browser');

// Use it just like the Node.js version
tracePerf.info('This works in the browser with CommonJS bundlers!');
```

### Browser Example

```javascript
// Import using your preferred method
import tracePerf from 'traceperf/browser';

// Track function performance
function expensiveCalculation() {
  // ...complex logic
  return result;
}

const result = tracePerf.track(expensiveCalculation);
```

### React Component Example

```jsx
import React, { useEffect } from 'react';
import tracePerf from 'traceperf/browser';

function DataComponent() {
  useEffect(() => {
    tracePerf.group('Component Lifecycle');
    tracePerf.info('Component mounted');
    
    // Fetch data with performance tracking
    tracePerf.track(async () => {
      const data = await fetchData();
      // Process data...
    }, { label: 'fetchAndProcessData', threshold: 300 });
    
    return () => {
      tracePerf.info('Component unmounting');
      tracePerf.groupEnd();
    };
  }, []);
  
  // Component rendering...
}
```

## Advanced Usage

### Tracking Nested Function Calls

TracePerf provides two reliable approaches for tracking nested function calls, allowing you to visualize the complete execution flow of your application:

1. **Using the `createTrackable` method** (recommended)
2. **Using nested `track` calls**

#### Using createTrackable (Recommended)

The `createTrackable` method creates tracked versions of your functions that can be used in place of the original functions. This approach requires explicitly replacing function references but provides the most reliable nested tracking:

```javascript
// Original functions
function fetchData() {
  processData();
  calculateResults();
}

function processData() {
  // Some processing logic
}

function calculateResults() {
  // Some calculation logic
}

// Create tracked versions of all functions
const trackedFetchData = tracePerf.createTrackable(fetchData, { label: 'fetchData' });
const trackedProcessData = tracePerf.createTrackable(processData, { label: 'processData' });
const trackedCalculateResults = tracePerf.createTrackable(calculateResults, { label: 'calculateResults' });

// Replace the original function references to enable tracking
// This step is crucial for tracking nested calls
global.processData = trackedProcessData;
global.calculateResults = trackedCalculateResults;

// Execute the tracked top-level function
trackedFetchData();
```

This will produce a complete execution flow chart showing all nested function calls:

```
Execution Flow:
┌──────────────────────────────┐
│         fetchData          │  ⏱  200ms
└──────────────────────────────┘
                │  
                ▼  
┌──────────────────────────────┐
│        processData         │  ⏱  500ms ⚠️ SLOW
└──────────────────────────────┘
                │  
                ▼  
┌──────────────────────────────┐
│      calculateResults      │  ⏱  300ms
└──────────────────────────────┘
```

#### Using Nested Track Calls

For more complex scenarios or when you don't want to replace function references, you can explicitly use nested `track` calls:

```javascript
tracePerf.track(() => {
  // Top-level function logic
  
  tracePerf.track(() => {
    // Nested function logic
    
    tracePerf.track(() => {
      // Deeply nested function logic
    }, { label: 'deeplyNestedFunction' });
    
  }, { label: 'nestedFunction' });
  
}, { label: 'topLevelFunction' });
```

This method requires more manual instrumentation but gives you precise control over what gets tracked.

#### Controlling Nested Tracking

You can control nested tracking behavior with the following option:

```javascript
// Disable nested tracking entirely for a specific function call
tracePerf.track(fetchData, { enableNestedTracking: false });
```

For more examples, see the `examples/nested-function-example.js` and `examples/test/nested-function-test.js` files in the repository.

## API Reference for Nested Tracking

### createTrackable

```javascript
tracePerf.createTrackable(fn, options)
```

Creates a tracked version of a function that can be used for nested function tracking.

- `fn`: The function to make trackable
- `options`: Options for tracking
  - `label`: Custom label for the function (defaults to function name)
  - `threshold`: Performance threshold in milliseconds
  - `includeMemory`: Whether to include memory usage tracking
  - `enableNestedTracking`: Whether to enable nested tracking (default: true)

Returns a new function that, when called, will track the execution of the original function.

### Track Options for Nested Tracking

When using the `track` method, you can control nested tracking with these options:

```javascript
tracePerf.track(fn, {
  // ... other options
  enableNestedTracking: true, // Enable/disable nested tracking
});
```

## Creating a Custom Logger

```javascript
const { createLogger } = require('traceperf');

// Create a custom logger instance
const logger = createLogger({
  mode: 'dev',
  level: 'debug',
  colorize: true,
  timestamp: true,
  performanceThreshold: 100, // ms
  indentSize: 2,
});

// Use the custom logger
logger.info('Custom logger');
```

## API Reference

### Logging Methods

- `info(message, ...args)`: Log an informational message
- `warn(message, ...args)`: Log a warning message
- `error(message, ...args)`: Log an error message
- `debug(message, ...args)`: Log a debug message (filtered in production)

### Grouping

- `group(label)`: Start a new log group with the given label
- `groupEnd()`: End the current log group

### Execution Tracking

- `track(fn, options)`: Track the execution of a function and log performance metrics
  - `options.label`: Custom label for the tracked function
  - `options.threshold`: Performance threshold in milliseconds
  - `options.includeMemory`: Whether to include memory usage tracking
  - `options.silent`: Whether to suppress logging for this tracking

### Configuration

- `setMode(mode)`: Set the operational mode ('dev', 'staging', 'prod')
- `getMode()`: Get the current operational mode

## License

MIT 

