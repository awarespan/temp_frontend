/**
 * AWARESPAN Volunteer Portal — Configuration Service
 * Reads environment variables with secure defaults.
 */

import { PiNodeConfig } from '../types';

export const getInitialConfig = (): PiNodeConfig => {
  const envHost = import.meta.env.VITE_PI_HOST as string | undefined;
  const envPort = import.meta.env.VITE_PI_PORT as string | undefined;
  const envSsl = import.meta.env.VITE_PI_USE_SSL as string | undefined;
  const envNodeId = import.meta.env.VITE_PI_NODE_ID as string | undefined;
  const envMockMode = import.meta.env.VITE_MOCK_MODE as string | undefined;

  // In development, default to mock mode if not explicitly disabled
  const isDev = import.meta.env.DEV;
  const defaultMock = envMockMode !== undefined ? envMockMode === 'true' : isDev;

  return {
    piHost: envHost || '192.168.1.50',
    piPort: envPort ? parseInt(envPort, 10) : 8766, // 8766 matches node_runtime default RUNTIME_PORT
    useSsl: envSsl === 'true',
    nodeId: envNodeId || 'sip-pi-001',
    mockMode: defaultMock,
  };
};

export const formatWsUrl = (config: PiNodeConfig, path: string = '/ingest'): string => {
  const protocol = config.useSsl ? 'wss' : 'ws';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${config.piHost}:${config.piPort}${cleanPath}`;
};
