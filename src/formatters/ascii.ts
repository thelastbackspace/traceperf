import { BOX_CHARS, PERFORMANCE_ICONS } from '../core/constants';
import { formatDuration } from '../utils/timing';

/**
 * Execution data for a function call
 */
export interface ExecutionData {
  name: string;
  duration: number;
  isSlow: boolean;
  memoryUsage?: number;
  level: number;
}

/**
 * ASCII art generator for execution flow charts
 */
export class AsciiArtGenerator {
  private _boxWidth: number;

  /**
   * Create a new AsciiArtGenerator instance
   * 
   * @param options - Generator options
   */
  constructor(options: { boxWidth?: number } = {}) {
    this._boxWidth = options.boxWidth ?? 30;
  }

  /**
   * Generate a flow chart for a sequence of function executions
   * 
   * @param executions - Array of execution data
   * @returns ASCII art flow chart
   */
  public generateFlowChart(executions: ExecutionData[]): string {
    let chart = '';
    
    for (let i = 0; i < executions.length; i++) {
      const execution = executions[i];
      
      // Generate box for function
      chart += this.generateFunctionBox(execution);
      
      // Add arrow to next function if not the last one
      if (i < executions.length - 1) {
        chart += this.generateArrow(executions[i + 1].level - execution.level);
      }
    }
    
    return chart;
  }

  /**
   * Generate a box for a function execution
   * 
   * @param execution - The execution data
   * @returns ASCII art box
   */
  private generateFunctionBox(execution: ExecutionData): string {
    const { name, duration, isSlow, memoryUsage } = execution;
    
    // Calculate padding for the function name
    const nameLength = name.length;
    const padding = Math.max(0, this._boxWidth - nameLength - 2);
    const leftPadding = Math.floor(padding / 2);
    const rightPadding = padding - leftPadding;
    
    // Generate the box
    let box = '';
    
    // Top border
    box += BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(this._boxWidth) + BOX_CHARS.topRight + '\n';
    
    // Function name
    box += BOX_CHARS.vertical + ' '.repeat(leftPadding) + name + ' '.repeat(rightPadding) + BOX_CHARS.vertical;
    
    // Performance metrics
    box += `  ${PERFORMANCE_ICONS.timer}  ${formatDuration(duration)}`;
    
    if (isSlow) {
      box += ` ${PERFORMANCE_ICONS.slow} SLOW`;
    }
    
    if (memoryUsage !== undefined) {
      box += ` ${PERFORMANCE_ICONS.memory} ${this.formatMemory(memoryUsage)}`;
    }
    
    box += '\n';
    
    // Bottom border
    box += BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(this._boxWidth) + BOX_CHARS.bottomRight + '\n';
    
    return box;
  }

  /**
   * Generate an arrow between function boxes
   * 
   * @param levelDiff - Difference in nesting level
   * @returns ASCII art arrow
   */
  private generateArrow(levelDiff: number): string {
    let arrow = '';
    
    // Indent based on level difference
    const indent = '  '.repeat(Math.max(0, levelDiff));
    
    // Vertical line
    arrow += indent + ' '.repeat(this._boxWidth / 2) + BOX_CHARS.vertical + '\n';
    
    // Arrow
    arrow += indent + ' '.repeat(this._boxWidth / 2) + BOX_CHARS.downArrow + '\n';
    
    return arrow;
  }

  /**
   * Format memory usage in a human-readable format
   * 
   * @param bytes - Memory usage in bytes
   * @returns Formatted memory usage
   */
  private formatMemory(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)}${units[unitIndex]}`;
  }
} 