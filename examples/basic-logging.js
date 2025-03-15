// Import the default logger
const tracePerf = require('../dist').default;

// Basic logging
tracePerf.info('This is an info message');
tracePerf.warn('This is a warning message');
tracePerf.error('This is an error message');
tracePerf.debug('This is a debug message');

// Logging with objects
tracePerf.info('User data:', { id: 1, name: 'John Doe', email: 'john@example.com' });

// Nested logging with groups
tracePerf.group('User Authentication');
tracePerf.info('Checking credentials');
tracePerf.warn('Invalid password attempt');
tracePerf.group('Security Checks');
tracePerf.info('Checking IP address');
tracePerf.info('Checking device fingerprint');
tracePerf.groupEnd();
tracePerf.groupEnd();

// Different logging modes
console.log('\n--- Development Mode ---');
tracePerf.setMode('dev');
tracePerf.debug('Debug message in dev mode');
tracePerf.info('Info message in dev mode');
tracePerf.warn('Warning message in dev mode');
tracePerf.error('Error message in dev mode');

console.log('\n--- Staging Mode ---');
tracePerf.setMode('staging');
tracePerf.debug('Debug message in staging mode'); // This will not be shown
tracePerf.info('Info message in staging mode');   // This will not be shown
tracePerf.warn('Warning message in staging mode');
tracePerf.error('Error message in staging mode');

console.log('\n--- Production Mode ---');
tracePerf.setMode('prod');
tracePerf.debug('Debug message in prod mode');    // This will not be shown
tracePerf.info('Info message in prod mode');      // This will not be shown
tracePerf.warn('Warning message in prod mode');   // This will not be shown
tracePerf.error('Error message in prod mode'); 