import { FullStatus } from '../types';

export type ProviderErrorKind =
  | 'unavailable'
  | 'unsupported'
  | 'auth'
  | 'transient'
  | 'invalid-data';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderFetch = (force: boolean) => Promise<FullStatus>;

export function isUsableStatus(status: FullStatus): boolean {
  return status.quotas.length > 0 || status.credits !== null || !!status.planTier;
}
