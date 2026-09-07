import { AgentRecoveryError } from "./transport";

/** A reloaded tab may briefly overlap the closing page's expiring editor lease. */
export async function recoverAfterTabClose<T>(
  recover: () => Promise<T>,
  eligible: () => boolean,
  wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
): Promise<T | undefined> {
  const delays = [100, 250, 500];
  for (let attempt = 0; ; attempt++) {
    if (!eligible()) return undefined;
    try {
      const result = await recover();
      return eligible() ? result : undefined;
    } catch (error) {
      if (!eligible()) return undefined;
      if (!(error instanceof AgentRecoveryError) || !error.retryable || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}
