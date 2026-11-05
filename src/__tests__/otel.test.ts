/**
 * OpenTelemetry exporter against the real SDK.
 */
import * as api from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { createTracePerf, openTelemetryExporter } from '../index';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const contextManager = new AsyncLocalStorageContextManager().enable();

beforeAll(() => {
  api.context.setGlobalContextManager(contextManager);
  api.trace.setGlobalTracerProvider(provider);
});
afterAll(() => {
  api.context.disable();
  api.trace.disable();
});
beforeEach(() => exporter.reset());

const byName = (name: string): ReadableSpan => {
  const span = exporter.getFinishedSpans().find(s => s.name === name);
  if (!span) throw new Error(`no span ${name}: ${exporter.getFinishedSpans().map(s => s.name)}`);
  return span;
};
const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;

// What auto-instrumentation (e.g. a pg or http instrumentation) does
const instrumentedLibraryCall = () => api.trace.getTracer('pg').startActiveSpan('pg.query', async span => {
  await sleep(2);
  span.end();
});

test('live mode: other instrumentation nests under traceperf spans, across await', async () => {
  const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(api, { live: true })] });
  const repo = tp.createTrackable(async () => {
    await sleep(1);
    await instrumentedLibraryCall();
  }, { label: 'userRepo.find' });

  await api.trace.getTracer('http').startActiveSpan('GET /users', async request => {
    await tp.track(async () => {
      await sleep(1);
      await repo();
    }, { label: 'handler' });
    request.end();
  });

  const request = byName('GET /users');
  const handler = byName('handler');
  const find = byName('userRepo.find');
  const query = byName('pg.query');
  expect(parentOf(handler)).toBe(request.spanContext().spanId);
  expect(parentOf(find)).toBe(handler.spanContext().spanId);
  expect(parentOf(query)).toBe(find.spanContext().spanId);
  expect(find.spanContext().traceId).toBe(request.spanContext().traceId);
  expect(find.attributes['traceperf.async']).toBe(true);
});

test('live mode: errors set span status, renamed spans keep the final label', async () => {
  const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(api, { live: true })] });
  const span = tp.start('GET /items');
  await expect(span.run(() => tp.track(async () => { throw new Error('db down'); }, { label: 'db' }))).rejects.toThrow('db down');
  span.setLabel('GET /items/:id');
  span.end();
  expect(byName('db').status.code).toBe(api.SpanStatusCode.ERROR);
  expect(parentOf(byName('db'))).toBe(byName('GET /items/:id').spanContext().spanId);
});

test('default mode: spans are created at the end with real timing and parent links', async () => {
  const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(api)] });
  await api.trace.getTracer('http').startActiveSpan('request', async request => {
    await tp.track(async () => {
      await tp.track(() => sleep(10), { label: 'child' });
    }, { label: 'root' });
    request.end();
  });
  const root = byName('root');
  const child = byName('child');
  expect(parentOf(root)).toBe(byName('request').spanContext().spanId);
  expect(parentOf(child)).toBe(root.spanContext().spanId);
  const ms = (t: api.HrTime) => t[0] * 1e3 + t[1] / 1e6;
  expect(ms(child.endTime) - ms(child.startTime)).toBeGreaterThanOrEqual(9);
});

test('a plugin wrap() that throws never breaks tracked code', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation();
  try {
    const tp = createTracePerf({ silent: true });
    tp.use({ name: 'bad-wrap', wrap: () => { throw new Error('nope'); } });
    expect(tp.track(() => 5)).toBe(5);
    expect(() => tp.track(() => { throw new Error('user error'); })).toThrow('user error');
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
