import { FullStatus } from '../types';
import { fetchAgyCli } from './agyCli';
import { fetchCloudCode, fetchCloudCodePlanTier } from './cloudCode';
import { fetchLanguageServer } from './languageServer';
import { ProviderFetch, isUsableStatus } from './types';

export { ProviderError } from './types';
export type { ProviderErrorKind, ProviderFetch } from './types';

export type PrimaryEnricher = (status: FullStatus, force: boolean) => Promise<void>;

export async function runProviderChain(
  force: boolean,
  providers: ProviderFetch[],
  enrichPrimary?: PrimaryEnricher,
): Promise<FullStatus> {
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    try {
      const status = await provider(force);
      if (isUsableStatus(status)) {
        if (index === 0 && enrichPrimary) {
          try {
            await enrichPrimary(status, force);
          } catch {
            // Subscription enrichment is optional; quota data remains authoritative.
          }
        }
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

export function fetchFromProvidersWith(
  force: boolean,
  cli: ProviderFetch,
  cloud: ProviderFetch,
  language: ProviderFetch,
  enrichPrimary?: PrimaryEnricher,
): Promise<FullStatus> {
  return runProviderChain(force, [cli, cloud, language], enrichPrimary);
}

async function enrichCliSubscription(status: FullStatus, force: boolean): Promise<void> {
  const planTier = await fetchCloudCodePlanTier(force);
  if (planTier) {
    status.planTier = planTier;
  }
}

export function fetchFromProviders(force: boolean): Promise<FullStatus> {
  return fetchFromProvidersWith(
    force,
    fetchAgyCli,
    fetchCloudCode,
    fetchLanguageServer,
    enrichCliSubscription,
  );
}
