import { JsonFormatter } from '../formatters/json';
import { AsciiArtGenerator, ExecutionData } from '../formatters/ascii';
import { CliFormatter } from '../formatters/cli';
import { LogLevel } from '../types';

describe('JsonFormatter', () => {
  let formatter: JsonFormatter;
  
  beforeEach(() => {
    formatter = new JsonFormatter();
  });
  
  test('format should return a JSON string', () => {
    const timestamp = new Date();
    const result = formatter.format(
      'info',
      'Test message',
      [],
      { timestamp, indentLevel: 0, level: 'info' }
    );
    
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('level', 'info');
    expect(parsed).toHaveProperty('message', 'Test message');
    expect(parsed).toHaveProperty('args');
    expect(Array.isArray(parsed.args)).toBe(true);
  });
  
  test('format should handle object messages', () => {
    const timestamp = new Date();
    const message = { key: 'value', nested: { prop: true } };
    
    const result = formatter.format(
      'info',
      message,
      [],
      { timestamp, indentLevel: 0, level: 'info' }
    );
    
    const parsed = JSON.parse(result);
    expect(parsed.message).toEqual(message);
  });
  
  test('format should handle array arguments', () => {
    const timestamp = new Date();
    const args = [1, 'string', { key: 'value' }];
    
    const result = formatter.format(
      'info',
      'Test message',
      args,
      { timestamp, indentLevel: 0, level: 'info' }
    );
    
    const parsed = JSON.parse(result);
    expect(parsed.args).toEqual(args);
  });
  
  test('format should handle non-serializable objects', () => {
    const timestamp = new Date();
    
    // Create a circular reference
    const circular: any = { name: 'circular' };
    circular.self = circular;
    
    const result = formatter.format(
      'info',
      circular,
      [circular],
      { timestamp, indentLevel: 0, level: 'info' }
    );
    
    // Should not throw
    expect(() => JSON.parse(result)).not.toThrow();
    
    const parsed = JSON.parse(result);
    expect(parsed.message).toHaveProperty('value');
    expect(parsed.args[0]).toHaveProperty('value');
  });
  
  test('format should include extra metadata', () => {
    const timestamp = new Date();
    const meta = {
      timestamp,
      indentLevel: 0,
      level: 'info' as LogLevel,
      userId: '123',
      requestId: 'abc-123',
      custom: { value: true }
    };
    
    const result = formatter.format(
      'info',
      'Test message',
      [],
      meta
    );
    
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('userId', '123');
    expect(parsed).toHaveProperty('requestId', 'abc-123');
    expect(parsed).toHaveProperty('custom');
    expect(parsed.custom).toEqual({ value: true });
  });
});

describe('AsciiArtGenerator', () => {
  let generator: AsciiArtGenerator;
  
  beforeEach(() => {
    generator = new AsciiArtGenerator();
  });
  
  test('generateFlowChart should return a string with ASCII art', () => {
    const executions: ExecutionData[] = [
      {
        name: 'Function1',
        duration: 100,
        isSlow: false,
        memoryUsage: 1024,
        level: 0
      }
    ];
    
    const result = generator.generateFlowChart(executions);
    
    expect(typeof result).toBe('string');
    expect(result).toContain('Function1');
    expect(result).toContain('┌');
    expect(result).toContain('└');
  });
  
  test('generateFlowChart should handle multiple executions', () => {
    const executions: ExecutionData[] = [
      {
        name: 'Function1',
        duration: 100,
        isSlow: false,
        memoryUsage: 1024,
        level: 0
      },
      {
        name: 'Function2',
        duration: 200,
        isSlow: true,
        memoryUsage: 2048,
        level: 1
      }
    ];
    
    const result = generator.generateFlowChart(executions);
    
    expect(result).toContain('Function1');
    expect(result).toContain('Function2');
    expect(result).toContain('SLOW');
  });
});

describe('CliFormatter', () => {
  let formatter: CliFormatter;
  
  beforeEach(() => {
    formatter = new CliFormatter();
  });
  
  test('format should return a string with CLI formatting', () => {
    const timestamp = new Date();
    const result = formatter.format(
      'info',
      'Test message',
      [],
      { timestamp, indentLevel: 0, level: 'info' as LogLevel }
    );
    
    expect(typeof result).toBe('string');
    expect(result).toContain('Test message');
    expect(result).toContain('INFO');
  });
  
  test('format should handle different log levels', () => {
    const timestamp = new Date();
    const levels: LogLevel[] = ['info', 'warn', 'error', 'debug'];
    
    levels.forEach(level => {
      const result = formatter.format(
        level,
        `${level} message`,
        [],
        { timestamp, indentLevel: 0, level }
      );
      
      expect(result).toContain(`${level.toUpperCase()}`);
      expect(result).toContain(`${level} message`);
    });
  });
  
  test('format should handle indentation', () => {
    const timestamp = new Date();
    
    const noIndent = formatter.format(
      'info',
      'No indent',
      [],
      { timestamp, indentLevel: 0, level: 'info' as LogLevel }
    );
    
    const withIndent = formatter.format(
      'info',
      'With indent',
      [],
      { timestamp, indentLevel: 2, level: 'info' as LogLevel }
    );
    
    // The indented message should have more spaces at the beginning
    expect(withIndent.length).toBeGreaterThan(noIndent.length);
  });
  
  test('format should handle object messages', () => {
    const timestamp = new Date();
    const message = { key: 'value' };
    
    const result = formatter.format(
      'info',
      message,
      [],
      { timestamp, indentLevel: 0, level: 'info' as LogLevel }
    );
    
    expect(result).toContain('key');
    expect(result).toContain('value');
  });
  
  test('format should handle array arguments', () => {
    const timestamp = new Date();
    const args = [1, 'string', { key: 'value' }];
    
    const result = formatter.format(
      'info',
      'Test message',
      args,
      { timestamp, indentLevel: 0, level: 'info' as LogLevel }
    );
    
    expect(result).toContain('Test message');
    expect(result).toContain('1');
    expect(result).toContain('string');
    expect(result).toContain('key');
    expect(result).toContain('value');
  });
  
  test('format should handle custom formatter options', () => {
    const timestamp = new Date();
    
    // Create formatter with custom options
    const customFormatter = new CliFormatter({
      colorEnabled: true,
      indentSize: 4
    });
    
    const result = customFormatter.format(
      'info',
      'Test message',
      [],
      { timestamp, indentLevel: 0, level: 'info' as LogLevel }
    );
    
    expect(result).toContain('Test message');
    expect(result).toContain('INFO');
  });
}); 