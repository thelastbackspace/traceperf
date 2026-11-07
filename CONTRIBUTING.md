# Contributing to TracePerf

Thank you for considering contributing to TracePerf! This document outlines the process for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and considerate of others.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue on GitHub with the following information:

- A clear, descriptive title
- A detailed description of the issue
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Screenshots or code snippets (if applicable)
- Environment information (Node.js version, OS, etc.)

### Suggesting Features

We welcome feature suggestions! Please create an issue on GitHub with:

- A clear, descriptive title
- A detailed description of the proposed feature
- Any relevant examples or use cases
- If possible, a sketch of how the feature might be implemented

### Pull Requests

1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature-name`)
3. Make your changes
4. Run the checks:
   - `npm run build:all && npm test && npm run lint` - unit tests and lint (warnings fail)
   - `npm run verify` - publint/attw, the packed tarball in fresh CJS/ESM/TypeScript/bundler projects, and every README/docs example (with output comparison)
   - `npm run test:browser` - Playwright in Chromium, Firefox and WebKit (`npx playwright install` once)
   - `npm run bench:check` - overhead and bundle-size budgets
   If you change behaviour that the README shows, update the example and its output block; `verify:docs` will tell you if they drift.
5. Commit your changes with a descriptive commit message
6. Push to your branch (`git push origin feature/your-feature-name`)
7. Open a pull request

#### Pull Request Guidelines

- Follow the existing code style and conventions
- Include tests for new features or bug fixes
- Update documentation as needed
- Keep pull requests focused on a single change
- Link to any relevant issues

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run tests: `npm test`

## Project Structure

```
traceperf/
├── src/                      # Source code
│   ├── index.ts              # Main entry point
│   ├── core/                 # Core functionality
│   ├── trackers/             # Performance tracking modules
│   ├── formatters/           # Output formatting
│   ├── utils/                # Utility functions
│   └── types/                # TypeScript type definitions
├── test/                     # Test files
├── examples/                 # Example usage
└── docs/                     # Documentation
```

## Coding Standards

- Use TypeScript for all code
- Follow the existing code style (enforced by ESLint and Prettier)
- Write comprehensive JSDoc comments for all public APIs
- Maintain high test coverage

## Testing

- Write unit tests for all new functionality
- Ensure all tests pass before submitting a pull request
- Aim for high test coverage

## Documentation

- Update documentation for any changes to the public API
- Include examples for new features
- Keep the README up to date

## What to work on

The focus is `traceperf run`, `explain`, `traceperf/auto`, the driver integrations and the CI baseline. Changes to findings need a case in `examples/slow-apps` (a planted problem, or a `clean-*` app where the right answer is "no issues") and `npm run eval` must stay at every problem found and no false alarms. Driver changes need a check in `test/compat` that runs old and new majors against real servers.

The browser build, other runtimes, exporters and the decorator/logging APIs are in maintenance: bug fixes welcome, new features only when an issue asks for them.

## Release Process

At most one release a week (regression fixes excepted), batching what has landed. The maintainers will handle the release process, including:

1. Updating the version number
2. Updating the changelog
3. Creating a new release on GitHub
4. Publishing to npm

## License

By contributing to TracePerf, you agree that your contributions will be licensed under the project's MIT license. 