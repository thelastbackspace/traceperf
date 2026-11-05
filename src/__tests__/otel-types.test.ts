/**
 * Regression: openTelemetryExporter must accept the real @opentelemetry/api
 * (its structural types used to reject it, so `openTelemetryExporter(otel)`
 * did not compile for TypeScript users). This file failing to compile fails
 * the suite.
 */
import * as otel from '@opentelemetry/api';
import { createTracePerf, openTelemetryExporter } from '../index';

test('openTelemetryExporter accepts the real @opentelemetry/api', () => {
  const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(otel)] });
  // No SDK registered: the API's no-op tracer must work without errors
  expect(tp.track(() => tp.track(() => 2, { label: 'child' }), { label: 'root' })).toBe(2);
});
