# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2025-03-18

### Fixed
- Fixed implementation of nested function tracking
- Added proper support for the `createTrackable` method to reliably track nested function calls
- Improved code to maintain references to tracked functions
- Updated README.md with clearer examples of proper nested function tracking
- Removed misleading references to automatic tracking of nested function calls

### Added
- Added comprehensive test examples in `examples/test/` directory
- Added test for browser module CommonJS compatibility
- Added test for object methods tracking with proper `this` context
- Added example for disabling nested tracking with `enableNestedTracking` option

### Changed
- Clarified that `createTrackable` approach requires explicitly replacing function references
- Updated examples to show the most reliable patterns for nested function tracking
- Simplified API documentation for nested tracking options
- Renamed auto-tracking-example.js to nested-function-example.js to better reflect its purpose
- Updated README.md to reference the new example files

### Removed
- Removed unsupported `autoTracking` functionality that wasn't fully implemented
- Cleaned up unnecessary and redundant example files from the repository
- Removed redundant nested-tracking.js and execution-flow.js examples in favor of the more comprehensive nested-function-example.js

## [0.1.5] - 2025-03-16

### Changed
- Updated README.md to accurately reflect nested function tracking implementation
- Removed misleading examples that suggested automatic tracking of nested functions
- Improved documentation clarity for both `createTrackable` and nested `track` approaches
- Added API reference section for nested tracking options

## [0.1.4] - 2025-03-16

### Added
- New `createTrackable` method for creating tracked versions of functions
- Improved nested function tracking with a simpler, more reliable approach
- Updated documentation with examples of nested function tracking
- New example file demonstrating nested function tracking

### Changed
- Simplified the execution tracking implementation
- Removed the experimental proxy-based tracking approach
- Updated the README with clearer examples and documentation

## [0.1.3] - 2025-03-16

### Added
- Automatic tracking of nested function calls without manual instrumentation
- New `autoTracking` option to control automatic function detection
- Source code analysis to identify and track nested function calls

### Enhanced
- Improved nested function detection with regex-based source code analysis
- Better handling of global scope functions in both Node.js and browser environments

## [0.1.2] - 2025-03-16

### Added
- Automatic tracking of nested function calls without manual instrumentation
- New `autoTracking` option to control automatic function detection
- Source code analysis to identify and track nested function calls
- Support for tracking nested function calls with two recommended approaches
- New `enableNestedTracking` option in `ITrackOptions` interface
- Comprehensive documentation for nested function tracking in README
- Example script demonstrating different approaches to nested function tracking

### Fixed
- Fixed issue with nested function calls not being properly tracked in execution flow
- Improved parent-child relationship tracking in execution records
- Enhanced flow chart visualization for nested function calls

## [0.1.1] - 2025-03-16

### Added
- Improved module compatibility for both CommonJS and ESM environments
- Added explicit CommonJS support in browser module
- Enhanced TypeScript configuration for better module interoperability

### Changed
- Updated browser module to use CommonJS format for better compatibility
- Improved export structure to support both `require()` and `import` syntax

### Fixed
- Fixed module resolution issues in different JavaScript environments
- Resolved potential compatibility issues with older bundlers

## [0.1.0] - 2025-03-16

### Added
- Initial release of TracePerf
- Core logging functionality with `info()`, `warn()`, `error()`, and `debug()` methods
- Execution flow tracking with ASCII visualization
- Performance monitoring with bottleneck detection
- Conditional logging modes (development, staging, production)
- Nested logging with group support
- Production optimization features
- Multiple output formats (CLI, JSON)
- Transport system for flexible output handling
- Comprehensive documentation and examples
- Browser support for frontend applications (React, Next.js)
- Comprehensive test suite with high coverage

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- N/A (initial release) 