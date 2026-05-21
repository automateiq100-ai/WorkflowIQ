import type { ConnectorId, ERPConnector } from './types';
import { TallyConnector } from './tally';

const REGISTRY: Record<ConnectorId, ERPConnector | null> = {
  tally: new TallyConnector(),
  busy: null,
  quickbooks: null,
};

export function getConnector(id: ConnectorId): ERPConnector {
  const c = REGISTRY[id];
  if (!c) throw new Error(`Connector "${id}" not implemented yet`);
  return c;
}

export function listAvailableConnectors(): Array<{ id: ConnectorId; label: string }> {
  return Object.entries(REGISTRY)
    .filter(([, c]) => c !== null)
    .map(([id, c]) => ({ id: id as ConnectorId, label: (c as ERPConnector).label }));
}
