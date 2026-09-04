import { FullStatus } from './types';
import { fetchFromProviders } from './providers';

export * from './types';
export { formatAbsoluteTime, resolveQuotaModelName } from './parser';

type StatusFetch = (force: boolean) => Promise<FullStatus>;

export function createSingleFlight(source: StatusFetch): StatusFetch {
  let inFlight: Promise<FullStatus> | null = null;

  return (force: boolean): Promise<FullStatus> => {
    if (inFlight) return inFlight;

    inFlight = source(force).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

const fetchSingleFlight = createSingleFlight(fetchFromProviders);

export function fetchFullStatus(force: boolean = false): Promise<FullStatus> {
  return fetchSingleFlight(force).then((status) => {
    if (status.quotas.length > 0) {
      status.recentlyUsedModel = status.quotas[0].model;
    }
    return status;
  });
}
