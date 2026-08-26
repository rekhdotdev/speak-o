export class SourcePageUrlTracker {
  private lastUrl: string;

  constructor(initialUrl: string) {
    this.lastUrl = initialUrl;
  }

  synchronize(currentUrl: string): void {
    this.lastUrl = currentUrl;
  }

  observe(currentUrl: string, hasActiveSession: boolean): boolean {
    if (currentUrl === this.lastUrl) return false;
    this.lastUrl = currentUrl;
    return hasActiveSession;
  }
}
