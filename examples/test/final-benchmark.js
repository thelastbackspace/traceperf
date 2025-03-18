/**
 * Final Benchmark for TracePerf Implementations
 * 
 * This benchmark compares all three implementations:
 * 1. Original TracePerf
 * 2. Enhanced TracePerf 
 * 3. Optimized Enhanced TracePerf (Final)
 * 
 * The benchmark focuses on high-frequency function calls, which is where
 * the most significant performance differences are observed.
 */

// Import all implementations
const tracePerf = require('../../dist/index.js');
const { optimizedEnhancedTracePerf: enhancedTracePerf } = require('./traceperf-enhanced-optimized.js');
const { optimizedEnhancedTracePerf: finalTracePerf, TrackingMode } = require('./traceperf-enhanced-optimized-final.js');

// Configure all implementations
tracePerf.setMode('prod'); // Silent mode

enhancedTracePerf.setConfig({
  showMemoryUsage: true,
  enableNestedTracking: true,
  silent: true // Set to silent for benchmark
});

finalTracePerf.setConfig({
  showMemoryUsage: true,
  enableNestedTracking: true,
  trackingMode: TrackingMode.BALANCED, // Default mode for fair comparison
  silent: true // Set to silent for benchmark
});

// Helper functions
function formatNumber(num) {
  return num.toLocaleString();
}

function formatTime(ns) {
  return `${(ns / 1000000).toFixed(3)} ms`;
}

// Simple function for testing
function add(a, b) {
  return a + b;
}

// Create trackable versions
const originalTracked = tracePerf.createTrackable(add, { label: 'add' });
const enhancedTracked = enhancedTracePerf.createTrackable(add, { label: 'add' });
const finalTracked = finalTracePerf.createTrackable(add, { label: 'add' });
const finalTrackedPerf = finalTracePerf.createTrackable(add, { 
  label: 'add',
  trackingMode: TrackingMode.PERFORMANCE 
});

// Benchmark high-frequency function calls
async function benchmarkHighFrequency(iterations = 100000) {
  console.log(`\n==================================================`);
  console.log(`HIGH-FREQUENCY FUNCTION CALLS (${formatNumber(iterations)} iterations)`);
  console.log(`==================================================`);
  
  // Warm-up
  for (let i = 0; i < 1000; i++) {
    add(i, i + 1);
    originalTracked(i, i + 1);
    enhancedTracked(i, i + 1);
    finalTracked(i, i + 1);
    finalTrackedPerf(i, i + 1);
  }
  
  // Benchmark baseline
  console.log('Running baseline benchmark...');
  const baselineStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    add(i, i + 1);
  }
  const baselineEnd = process.hrtime.bigint();
  const baselineTime = Number(baselineEnd - baselineStart);
  
  // Benchmark original implementation
  console.log('Running original TracePerf benchmark...');
  const originalStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    tracePerf.track(() => {
      return add(i, i + 1);
    }, { label: 'highFrequencyBenchmark', silent: true });
  }
  const originalEnd = process.hrtime.bigint();
  const originalTime = Number(originalEnd - originalStart);
  
  // Benchmark enhanced implementation
  console.log('Running enhanced TracePerf benchmark...');
  const enhancedStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    enhancedTracePerf.track(() => {
      return add(i, i + 1);
    }, { label: 'highFrequencyBenchmark', silent: true });
  }
  const enhancedEnd = process.hrtime.bigint();
  const enhancedTime = Number(enhancedEnd - enhancedStart);
  
  // Benchmark final implementation (BALANCED mode)
  console.log('Running final TracePerf benchmark (BALANCED mode)...');
  const finalStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    finalTracePerf.track(() => {
      return add(i, i + 1);
    }, { label: 'highFrequencyBenchmark', silent: true });
  }
  const finalEnd = process.hrtime.bigint();
  const finalTime = Number(finalEnd - finalStart);
  
  // Benchmark final implementation (PERFORMANCE mode)
  console.log('Running final TracePerf benchmark (PERFORMANCE mode)...');
  const finalPerfStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    finalTracePerf.track(() => {
      return add(i, i + 1);
    }, { 
      label: 'highFrequencyBenchmark', 
      silent: true, 
      trackingMode: TrackingMode.PERFORMANCE 
    });
  }
  const finalPerfEnd = process.hrtime.bigint();
  const finalPerfTime = Number(finalPerfEnd - finalPerfStart);
  
  // Calculate operations per second
  const baselineOps = Math.floor(iterations / (baselineTime / 1000000000));
  const originalOps = Math.floor(iterations / (originalTime / 1000000000));
  const enhancedOps = Math.floor(iterations / (enhancedTime / 1000000000));
  const finalOps = Math.floor(iterations / (finalTime / 1000000000));
  const finalPerfOps = Math.floor(iterations / (finalPerfTime / 1000000000));
  
  // Calculate overhead percentage compared to baseline
  const originalOverhead = (originalTime / baselineTime - 1) * 100;
  const enhancedOverhead = (enhancedTime / baselineTime - 1) * 100;
  const finalOverhead = (finalTime / baselineTime - 1) * 100;
  const finalPerfOverhead = (finalPerfTime / baselineTime - 1) * 100;
  
  // Display results
  console.log('\n=== High-Frequency Function Call Results ===\n');
  console.log(`Baseline: ${formatTime(baselineTime)} (${formatNumber(baselineOps)} ops/sec)`);
  console.log(`Original TracePerf: ${formatTime(originalTime)} (${formatNumber(originalOps)} ops/sec) - ${originalOverhead.toFixed(2)}% overhead`);
  console.log(`Enhanced TracePerf: ${formatTime(enhancedTime)} (${formatNumber(enhancedOps)} ops/sec) - ${enhancedOverhead.toFixed(2)}% overhead`);
  console.log(`Final TracePerf (BALANCED): ${formatTime(finalTime)} (${formatNumber(finalOps)} ops/sec) - ${finalOverhead.toFixed(2)}% overhead`);
  console.log(`Final TracePerf (PERFORMANCE): ${formatTime(finalPerfTime)} (${formatNumber(finalPerfOps)} ops/sec) - ${finalPerfOverhead.toFixed(2)}% overhead`);
  
  // Calculate improvement percentages
  const enhancedVsOriginal = ((originalTime - enhancedTime) / originalTime) * 100;
  const finalVsEnhanced = ((enhancedTime - finalTime) / enhancedTime) * 100;
  const finalPerfVsEnhanced = ((enhancedTime - finalPerfTime) / enhancedTime) * 100;
  const finalPerfVsOriginal = ((originalTime - finalPerfTime) / originalTime) * 100;
  
  console.log('\n=== Performance Improvement ===\n');
  console.log(`Enhanced vs Original: ${enhancedVsOriginal.toFixed(2)}%`);
  console.log(`Final (BALANCED) vs Enhanced: ${finalVsEnhanced.toFixed(2)}%`);
  console.log(`Final (PERFORMANCE) vs Enhanced: ${finalPerfVsEnhanced.toFixed(2)}%`);
  console.log(`Final (PERFORMANCE) vs Original: ${finalPerfVsOriginal.toFixed(2)}%`);
  
  return {
    baseline: { time: baselineTime, ops: baselineOps },
    original: { time: originalTime, ops: originalOps, overhead: originalOverhead },
    enhanced: { time: enhancedTime, ops: enhancedOps, overhead: enhancedOverhead },
    final: { time: finalTime, ops: finalOps, overhead: finalOverhead },
    finalPerf: { time: finalPerfTime, ops: finalPerfOps, overhead: finalPerfOverhead },
    improvements: {
      enhancedVsOriginal,
      finalVsEnhanced,
      finalPerfVsEnhanced,
      finalPerfVsOriginal
    }
  };
}

// Benchmark module registration overhead
async function benchmarkModuleRegistration() {
  console.log(`\n==================================================`);
  console.log(`MODULE REGISTRATION OVERHEAD`);
  console.log(`==================================================`);
  
  // Create a module with multiple functions
  const testModule = {
    name: 'TestModule',
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b,
    power: (a, b) => Math.pow(a, b),
    runAll(a, b) {
      console.log(`${this.name}: Running all operations`);
      const results = {
        add: this.add(a, b),
        subtract: this.subtract(a, b),
        multiply: this.multiply(a, b),
        divide: this.divide(a, b),
        power: this.power(a, b)
      };
      return results;
    }
  };
  
  console.log('Registering module with Enhanced TracePerf...');
  const enhancedStart = process.hrtime.bigint();
  const enhancedModule = enhancedTracePerf.registerModule(testModule, { modulePrefix: 'test' });
  const enhancedEnd = process.hrtime.bigint();
  const enhancedTime = Number(enhancedEnd - enhancedStart);
  
  console.log('Registering module with Final TracePerf (BALANCED)...');
  const finalStart = process.hrtime.bigint();
  const finalModule = finalTracePerf.registerModule(testModule, { modulePrefix: 'test' });
  const finalEnd = process.hrtime.bigint();
  const finalTime = Number(finalEnd - finalStart);
  
  console.log('Registering module with Final TracePerf (PERFORMANCE)...');
  const finalPerfStart = process.hrtime.bigint();
  const finalPerfModule = finalTracePerf.registerModule(testModule, { 
    modulePrefix: 'test',
    trackingMode: TrackingMode.PERFORMANCE
  });
  const finalPerfEnd = process.hrtime.bigint();
  const finalPerfTime = Number(finalPerfEnd - finalPerfStart);
  
  // Display results
  console.log('\n=== Module Registration Results ===\n');
  console.log(`Enhanced TracePerf: ${formatTime(enhancedTime)}`);
  console.log(`Final TracePerf (BALANCED): ${formatTime(finalTime)}`);
  console.log(`Final TracePerf (PERFORMANCE): ${formatTime(finalPerfTime)}`);
  
  // Calculate improvement percentages
  const finalVsEnhanced = ((enhancedTime - finalTime) / enhancedTime) * 100;
  const finalPerfVsEnhanced = ((enhancedTime - finalPerfTime) / enhancedTime) * 100;
  
  console.log('\n=== Registration Improvement ===\n');
  console.log(`Final (BALANCED) vs Enhanced: ${finalVsEnhanced.toFixed(2)}%`);
  console.log(`Final (PERFORMANCE) vs Enhanced: ${finalPerfVsEnhanced.toFixed(2)}%`);
  
  return {
    enhanced: { time: enhancedTime },
    final: { time: finalTime },
    finalPerf: { time: finalPerfTime },
    improvements: {
      finalVsEnhanced,
      finalPerfVsEnhanced
    }
  };
}

// Benchmark different tracking modes in final implementation
async function benchmarkTrackingModes(iterations = 10000) {
  console.log(`\n==================================================`);
  console.log(`TRACKING MODES COMPARISON (${formatNumber(iterations)} iterations)`);
  console.log(`==================================================`);
  
  // Simple function to track
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }
  
  // Warm-up
  fibonacci(10);
  
  // Baseline
  console.log('Running baseline benchmark...');
  const baselineStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fibonacci(10);
  }
  const baselineEnd = process.hrtime.bigint();
  const baselineTime = Number(baselineEnd - baselineStart);
  
  // Track function with different modes
  const results = {};
  const modes = [
    TrackingMode.PERFORMANCE,
    TrackingMode.BALANCED,
    TrackingMode.DETAILED,
    TrackingMode.DEBUG
  ];
  
  for (const mode of modes) {
    console.log(`Running ${mode} mode benchmark...`);
    const trackedFn = finalTracePerf.createTrackable(fibonacci, { 
      label: 'fibonacci',
      trackingMode: mode
    });
    
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      finalTracePerf.track(() => {
        return trackedFn(10);
      }, { label: 'fibonacci', trackingMode: mode, silent: true });
    }
    const end = process.hrtime.bigint();
    const time = Number(end - start);
    
    results[mode] = {
      time,
      ops: Math.floor(iterations / (time / 1000000000)),
      overhead: (time / baselineTime - 1) * 100
    };
  }
  
  // Display results
  console.log('\n=== Tracking Mode Results ===\n');
  console.log(`Baseline: ${formatTime(baselineTime)} (${formatNumber(Math.floor(iterations / (baselineTime / 1000000000)))} ops/sec)`);
  
  for (const mode of modes) {
    console.log(`${mode.toUpperCase()}: ${formatTime(results[mode].time)} (${formatNumber(results[mode].ops)} ops/sec) - ${results[mode].overhead.toFixed(2)}% overhead`);
  }
  
  return {
    baseline: { time: baselineTime, ops: Math.floor(iterations / (baselineTime / 1000000000)) },
    modes: results
  };
}

// Run all benchmarks
async function runAllBenchmarks() {
  console.log('\n==================================================');
  console.log('FINAL TRACEPERF PERFORMANCE BENCHMARKS');
  console.log('==================================================');
  console.log('\nRunning benchmarks, please wait...');
  
  // Run high-frequency benchmark
  const highFrequencyResults = await benchmarkHighFrequency();
  
  // Run module registration benchmark
  const moduleResults = await benchmarkModuleRegistration();
  
  // Run tracking modes benchmark
  const modesResults = await benchmarkTrackingModes();
  
  console.log('\n==================================================');
  console.log('ALL BENCHMARKS COMPLETED');
  console.log('==================================================');
  
  // Overall summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`High-Frequency Performance Improvement (PERFORMANCE mode vs Original): ${highFrequencyResults.improvements.finalPerfVsOriginal.toFixed(2)}%`);
  console.log(`Module Registration Improvement (PERFORMANCE mode vs Enhanced): ${moduleResults.improvements.finalPerfVsEnhanced.toFixed(2)}%`);
  console.log(`PERFORMANCE Mode Overhead: ${modesResults.modes.performance.overhead.toFixed(2)}%`);
  console.log(`DEBUG Mode Overhead: ${modesResults.modes.debug.overhead.toFixed(2)}%`);
  
  return {
    highFrequency: highFrequencyResults,
    moduleRegistration: moduleResults,
    trackingModes: modesResults
  };
}

// Run the benchmarks
runAllBenchmarks(); 