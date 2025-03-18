import { ConfigManager } from '../core/config';
import { LogLevel, LogMode } from '../types';
import { DEFAULT_CONFIG } from '../core/constants';

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    // Start with a fresh config manager for each test
    configManager = new ConfigManager();
  });

  describe('constructor', () => {
    test('should initialize with default config when no user config is provided', () => {
      const config = configManager.getConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test('should merge user config with defaults', () => {
      const userConfig = {
        mode: 'production' as LogMode,
        level: 'error' as LogLevel,
        colorize: false
      };
      
      const configManager = new ConfigManager(userConfig);
      const config = configManager.getConfig();
      
      expect(config.mode).toBe('production');
      expect(config.level).toBe('error');
      expect(config.colorize).toBe(false);
      
      // Other properties should be from defaults
      expect(config.performanceThreshold).toBe(DEFAULT_CONFIG.performanceThreshold);
    });
  });

  describe('updateConfig', () => {
    test('should update config with new values', () => {
      configManager.updateConfig({
        mode: 'development' as LogMode,
        level: 'debug' as LogLevel
      });
      
      const config = configManager.getConfig();
      expect(config.mode).toBe('development');
      expect(config.level).toBe('debug');
    });
    
    test('should keep existing values not specified in the update', () => {
      // First set some values
      configManager.updateConfig({
        colorize: false,
        indentSize: 4
      });
      
      // Then update only one property
      configManager.updateConfig({
        timestamp: false
      });
      
      const config = configManager.getConfig();
      expect(config.colorize).toBe(false);
      expect(config.indentSize).toBe(4);
      expect(config.timestamp).toBe(false);
    });
  });

  describe('getMode', () => {
    test('should return the current mode', () => {
      // Default mode
      expect(configManager.getMode()).toBe(DEFAULT_CONFIG.mode);
      
      // After setting a mode
      configManager.setMode('production' as LogMode);
      expect(configManager.getMode()).toBe('production');
    });

    test('should return default mode if current mode is undefined', () => {
      // Force an undefined mode
      configManager.updateConfig({ mode: undefined as unknown as LogMode });
      
      expect(configManager.getMode()).toBe(DEFAULT_CONFIG.mode);
    });
  });

  describe('setMode', () => {
    test('should set the mode correctly', () => {
      configManager.setMode('test' as LogMode);
      expect(configManager.getMode()).toBe('test');
      
      configManager.setMode('production' as LogMode);
      expect(configManager.getMode()).toBe('production');
    });
  });

  describe('shouldLog', () => {
    test('should allow logs with level higher than or equal to config level', () => {
      configManager.updateConfig({ level: 'warn' as LogLevel, mode: 'development' as LogMode });
      
      expect(configManager.shouldLog('error' as LogLevel)).toBe(true);
      expect(configManager.shouldLog('warn' as LogLevel)).toBe(true);
      expect(configManager.shouldLog('info' as LogLevel)).toBe(false);
      expect(configManager.shouldLog('debug' as LogLevel)).toBe(false);
      expect(configManager.shouldLog('trace' as LogLevel)).toBe(false);
    });
    
    test('should respect mode minimum levels', () => {
      // In production mode, minimum level is 'info' by default
      configManager.updateConfig({ mode: 'production' as LogMode, level: 'debug' as LogLevel });
      
      expect(configManager.shouldLog('debug' as LogLevel)).toBe(false); // Despite config being 'debug'
      expect(configManager.shouldLog('info' as LogLevel)).toBe(true);
      expect(configManager.shouldLog('warn' as LogLevel)).toBe(true);
      
      // In development mode, minimum is usually 'debug'
      configManager.updateConfig({ mode: 'development' as LogMode, level: 'info' as LogLevel });
      
      expect(configManager.shouldLog('debug' as LogLevel)).toBe(false); // Config level takes precedence
      expect(configManager.shouldLog('info' as LogLevel)).toBe(true);
    });
    
    test('should handle unknown modes', () => {
      // Unknown mode should default to 'info' minimum
      configManager.updateConfig({ mode: 'unknown' as LogMode, level: 'debug' as LogLevel });
      
      expect(configManager.shouldLog('debug' as LogLevel)).toBe(false);
      expect(configManager.shouldLog('info' as LogLevel)).toBe(true);
    });
    
    test('should handle undefined config level', () => {
      // Force undefined level
      configManager.updateConfig({ level: undefined as unknown as LogLevel, mode: 'development' as LogMode });
      
      // Should use default level
      expect(configManager.shouldLog('info' as LogLevel)).toBe(true);
    });
  });

  describe('getPerformanceThreshold', () => {
    test('should return the configured performance threshold', () => {
      expect(configManager.getPerformanceThreshold()).toBe(DEFAULT_CONFIG.performanceThreshold);
      
      configManager.updateConfig({ performanceThreshold: 200 });
      expect(configManager.getPerformanceThreshold()).toBe(200);
    });
    
    test('should handle undefined threshold', () => {
      configManager.updateConfig({ performanceThreshold: undefined });
      expect(configManager.getPerformanceThreshold()).toBe(DEFAULT_CONFIG.performanceThreshold);
    });
  });

  describe('getIndentSize', () => {
    test('should return the configured indent size', () => {
      expect(configManager.getIndentSize()).toBe(DEFAULT_CONFIG.indentSize);
      
      configManager.updateConfig({ indentSize: 4 });
      expect(configManager.getIndentSize()).toBe(4);
    });
    
    test('should handle undefined indent size', () => {
      configManager.updateConfig({ indentSize: undefined });
      expect(configManager.getIndentSize()).toBe(DEFAULT_CONFIG.indentSize);
    });
  });

  describe('isColorEnabled', () => {
    test('should return whether colors are enabled', () => {
      // Default is usually true
      expect(configManager.isColorEnabled()).toBe(DEFAULT_CONFIG.colorize);
      
      configManager.updateConfig({ colorize: false });
      expect(configManager.isColorEnabled()).toBe(false);
      
      configManager.updateConfig({ colorize: true });
      expect(configManager.isColorEnabled()).toBe(true);
    });
    
    test('should handle undefined colorize setting', () => {
      configManager.updateConfig({ colorize: undefined });
      expect(configManager.isColorEnabled()).toBe(DEFAULT_CONFIG.colorize);
    });
  });

  describe('isTimestampEnabled', () => {
    test('should return whether timestamps are enabled', () => {
      // Default is usually true
      expect(configManager.isTimestampEnabled()).toBe(DEFAULT_CONFIG.timestamp);
      
      configManager.updateConfig({ timestamp: false });
      expect(configManager.isTimestampEnabled()).toBe(false);
      
      configManager.updateConfig({ timestamp: true });
      expect(configManager.isTimestampEnabled()).toBe(true);
    });
    
    test('should handle undefined timestamp setting', () => {
      configManager.updateConfig({ timestamp: undefined });
      expect(configManager.isTimestampEnabled()).toBe(DEFAULT_CONFIG.timestamp);
    });
  });
}); 