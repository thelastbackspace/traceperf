import { ILoggerConfig, LogLevel, LogMode } from '../types';
import { DEFAULT_CONFIG, LOG_LEVEL_PRIORITY, MODE_MIN_LEVELS } from './constants';

/**
 * Configuration manager for the logger
 * Handles merging user config with defaults and provides utility methods
 */
export class ConfigManager {
  private _config: ILoggerConfig;

  /**
   * Create a new ConfigManager instance
   * 
   * @param userConfig - User-provided configuration options
   */
  constructor(userConfig: Partial<ILoggerConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...userConfig };
  }

  /**
   * Get the current configuration
   * 
   * @returns The current configuration
   */
  public getConfig(): ILoggerConfig {
    return { ...this._config };
  }

  /**
   * Update the configuration
   * 
   * @param newConfig - New configuration options to merge
   */
  public updateConfig(newConfig: Partial<ILoggerConfig>): void {
    this._config = { ...this._config, ...newConfig };
  }

  /**
   * Get the current mode
   * 
   * @returns The current mode
   */
  public getMode(): LogMode {
    return this._config.mode ?? DEFAULT_CONFIG.mode as LogMode;
  }

  /**
   * Set the current mode
   * 
   * @param mode - The mode to set
   */
  public setMode(mode: LogMode): void {
    this._config.mode = mode;
  }

  /**
   * Check if a log level should be displayed based on the current mode and level
   * 
   * @param level - The log level to check
   * @returns Whether the log level should be displayed
   */
  public shouldLog(level: LogLevel): boolean {
    const currentMode = this.getMode();
    const configLevel = this._config.level ?? DEFAULT_CONFIG.level as LogLevel;
    
    // Get the minimum level for the current mode
    const modeMinLevel = MODE_MIN_LEVELS[currentMode] || 'info';
    
    // Use the higher of the mode's minimum level and the configured level
    const effectiveMinLevel = this.getHigherPriorityLevel(modeMinLevel, configLevel);
    
    // Check if the provided level meets the minimum threshold
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[effectiveMinLevel];
  }

  /**
   * Get the higher priority level between two log levels
   * 
   * @param levelA - First log level
   * @param levelB - Second log level
   * @returns The higher priority level
   */
  private getHigherPriorityLevel(levelA: LogLevel, levelB: LogLevel): LogLevel {
    return LOG_LEVEL_PRIORITY[levelA] >= LOG_LEVEL_PRIORITY[levelB] ? levelA : levelB;
  }

  /**
   * Get the performance threshold
   * 
   * @returns The performance threshold in milliseconds
   */
  public getPerformanceThreshold(): number {
    return this._config.performanceThreshold ?? DEFAULT_CONFIG.performanceThreshold as number;
  }

  /**
   * Get the indentation size
   * 
   * @returns The number of spaces for each indentation level
   */
  public getIndentSize(): number {
    return this._config.indentSize ?? DEFAULT_CONFIG.indentSize as number;
  }

  /**
   * Check if colorization is enabled
   * 
   * @returns Whether colorization is enabled
   */
  public isColorEnabled(): boolean {
    return this._config.colorize ?? DEFAULT_CONFIG.colorize as boolean;
  }

  /**
   * Check if timestamps are enabled
   * 
   * @returns Whether timestamps are enabled
   */
  public isTimestampEnabled(): boolean {
    return this._config.timestamp ?? DEFAULT_CONFIG.timestamp as boolean;
  }
} 