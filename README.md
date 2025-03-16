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

## Execution Flow Tracking

```javascript
function fetchData() {
  processData();
}

function processData() {
  calculateResults();
}

function calculateResults() {
  return 'done';
}

// Track the execution of the fetchData function
const result = tracePerf.track(fetchData);
```

Output:

```
Execution Flow:
┌──────────────────────────────┐
│         fetchData            │  ⏱  200ms
└──────────────────────────────┘
                │  
                ▼  
┌──────────────────────────────┐
│        processData           │  ⏱  500ms ⚠️ SLOW
└──────────────────────────────┘
                │  
                ▼  
┌──────────────────────────────┐
│      calculateResults        │  ⏱  300ms
└──────────────────────────────┘
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

## Advanced Configuration

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

## Advanced Usage

### Tracking Nested Function Calls

TracePerf provides several approaches to track nested function calls:

#### Approach 1: Manual Tracking (Recommended)

The most reliable way to track nested function calls is to manually track each function:

```javascript
function fetchData() {
  // Simulate API call
  const data = { items: [1, 2, 3, 4, 5] };
  
  // Process the data with manual tracking
  const processedData = tracePerf.track(() => {
    // Data processing logic
    return data.items.map(item => item * 2);
  }, { label: "processData" });
  
  // Calculate results with manual tracking
  const results = tracePerf.track(() => {
    // Calculation logic
    return processedData.reduce((sum, item) => sum + item, 0);
  }, { label: "calculateResults" });
  
  return results;
}

// Track the main function
tracePerf.track(fetchData, { label: "fetchData" });
```

This approach gives you the most control and provides accurate timing for each function.

#### Approach 2: Wrapper Functions

You can create tracked versions of your functions:

```javascript
// Original functions
function processData(data) {
  return data.items.map(item => item * 2);
}

function calculateResults(processedData) {
  return processedData.reduce((sum, item) => sum + item, 0);
}

// Create tracked versions
const trackedProcessData = (data) => {
  return tracePerf.track(() => processData(data), { label: "processData" });
};

const trackedCalculateResults = (data) => {
  return tracePerf.track(() => calculateResults(data), { label: "calculateResults" });
};

// Use tracked versions in your main function
function fetchData() {
  const data = { items: [1, 2, 3, 4, 5] };
  const processedData = trackedProcessData(data);
  const results = trackedCalculateResults(processedData);
  return results;
}

// Track the main function
tracePerf.track(fetchData, { label: "fetchData" });
```

This approach allows you to keep your original functions clean while still tracking their performance.

### Customizing Performance Thresholds

// ... existing code ... 