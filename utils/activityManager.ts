type ActivityManagerOptions = {
  getNow?: () => number
}

/**
 * ActivityManager handles generic activity tracking for both user and CLI operations.
 * It automatically deduplicates overlapping activities and exposes activity state.
 *
 * Phase F removed the OTel `active_time` metric emission; the manager still tracks
 * timestamps so getActivityStates() (used for UI/idle detection) keeps working.
 */
export class ActivityManager {
  private activeOperations = new Set<string>()

  private lastUserActivityTime: number = 0 // Start with 0 to indicate no activity yet

  private isCLIActive: boolean = false

  private readonly USER_ACTIVITY_TIMEOUT_MS = 5000 // 5 seconds

  private readonly getNow: () => number

  private static instance: ActivityManager | null = null

  constructor(options?: ActivityManagerOptions) {
    this.getNow = options?.getNow ?? (() => Date.now())
  }

  static getInstance(): ActivityManager {
    if (!ActivityManager.instance) {
      ActivityManager.instance = new ActivityManager()
    }
    return ActivityManager.instance
  }

  /**
   * Reset the singleton instance (for testing purposes)
   */
  static resetInstance(): void {
    ActivityManager.instance = null
  }

  /**
   * Create a new instance with custom options (for testing purposes)
   */
  static createInstance(options?: ActivityManagerOptions): ActivityManager {
    ActivityManager.instance = new ActivityManager(options)
    return ActivityManager.instance
  }

  /**
   * Called when user interacts with the CLI (typing, commands, etc.)
   */
  recordUserActivity(): void {
    this.lastUserActivityTime = this.getNow()
  }

  /**
   * Starts tracking CLI activity (tool execution, AI response, etc.)
   */
  startCLIActivity(operationId: string): void {
    if (this.activeOperations.has(operationId)) {
      this.endCLIActivity(operationId)
    }

    const wasEmpty = this.activeOperations.size === 0
    this.activeOperations.add(operationId)

    if (wasEmpty) {
      this.isCLIActive = true
    }
  }

  /**
   * Stops tracking CLI activity
   */
  endCLIActivity(operationId: string): void {
    this.activeOperations.delete(operationId)

    if (this.activeOperations.size === 0) {
      this.isCLIActive = false
    }
  }

  /**
   * Convenience method to track an async operation automatically (mainly for testing/debugging)
   */
  async trackOperation<T>(
    operationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.startCLIActivity(operationId)
    try {
      return await fn()
    } finally {
      this.endCLIActivity(operationId)
    }
  }

  /**
   * Gets current activity states (mainly for testing/debugging)
   */
  getActivityStates(): {
    isUserActive: boolean
    isCLIActive: boolean
    activeOperationCount: number
  } {
    const now = this.getNow()
    const timeSinceUserActivity = (now - this.lastUserActivityTime) / 1000
    const isUserActive =
      timeSinceUserActivity < this.USER_ACTIVITY_TIMEOUT_MS / 1000

    return {
      isUserActive,
      isCLIActive: this.isCLIActive,
      activeOperationCount: this.activeOperations.size,
    }
  }
}

// Export singleton instance
export const activityManager = ActivityManager.getInstance()
