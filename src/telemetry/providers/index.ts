import { FullStatus } from '../types';
import { ProviderFetch, isUsableStatus } from './types';

export { ProviderError } from './types';
export type { ProviderErrorKind, ProviderFetch } from './types';

export async function runProviderChain(
  force: boolean,
  providers: ProviderFetch[],
): Promise<FullStatus> {
  for (const provider of providers) {
    try {
      const status = await provider(force);
      if (isUsableStatus(status)) {
        return status;
      }
    } catch {
      // Keep provider-specific details internal and try the next source.
    }
  }

  throw new Error(
    'Antigravity quota unavailable. Sign in with agy or start Antigravity IDE.',
  );
}
