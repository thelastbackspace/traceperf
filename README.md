# TracePerf

Advanced console logging & performance tracking for Node.js applications.

[![npm version](https://img.shields.io/npm/v/traceperf.svg)](https://www.npmjs.com/package/traceperf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

- **Structured and Visually Appealing Logs**: A better alternative to `console.log()` with colors, icons, and formatting.
- **Execution Flow Tracing**: Track function calls and visualize the execution flow with ASCII art.
- **Performance Bottleneck Detection**: Identify slow functions and get suggestions for optimization.
- **Conditional Logging Modes**: Different logging levels for development, staging, and production.
- **Nested Logging**: Group related logs with indentation for better readability.
- **Auto-Remove Debug Logs**: Automatically filter out debug logs in production.

## Installation

```bash
npm install traceperf
```

## Basic Usage

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

```javascript
// Import the browser version
import tracePerf from 'traceperf/browser';

// Use it just like the Node.js version
tracePerf.info('This works in the browser!');

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