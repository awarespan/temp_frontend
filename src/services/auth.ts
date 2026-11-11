/**
 * AWARESPAN Volunteer Portal — Authentication Service
 * Manages operator authentication, TOTP verification, and short-lived session tokens.
 *
 * NOTE: As per AWARESPAN security requirements:
 * 1. Passwords, TOTP secrets, and long-lived tokens are NEVER persisted in localStorage.
 * 2. Session credentials are short-lived in-memory objects.
 * 3. In production mode, authentication is delegated to the Raspberry Pi backend.
 *    If the backend does not expose an authentication endpoint, the frontend reports
 *    the missing backend contract rather than faking security.
 */

import { AuthSession, PiNodeConfig } from '../types';

// In-memory active session reference (not persisted in localStorage)
let activeSession: AuthSession | null = null;

// Session duration: 15 minutes
const SESSION_TTL_MS = 15 * 60 * 1000;

export interface AuthResult {
  success: boolean;
  session?: AuthSession;
  errorMessage?: string;
}

export const authenticateOperator = async (
  operatorId: string,
  totpCode: string,
  config: PiNodeConfig
): Promise<AuthResult> => {
  const cleanId = operatorId.trim();
  const cleanCode = totpCode.trim();

  // Basic validation
  if (!cleanId) {
    return { success: false, errorMessage: 'Operator ID is required.' };
  }

  if (!/^\d{6}$/.test(cleanCode)) {
    return { success: false, errorMessage: 'TOTP code must be exactly 6 digits.' };
  }

  // MOCK / DEVELOPMENT MODE
  if (config.mockMode) {
    // In mock mode, 000000 is reserved to simulate invalid TOTP verification failure
    if (cleanCode === '000000') {
      return {
        success: false,
        errorMessage: 'Invalid TOTP authenticator code. Verification rejected.',
      };
    }

    const now = Date.now();
    const session: AuthSession = {
      token: `mock-vol-tok-${Math.random().toString(36).substring(2, 10)}-${now}`,
      operatorId: cleanId,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      isAuthenticated: true,
      nodeId: config.nodeId,
    };

    activeSession = session;
    return { success: true, session };
  }

  // PRODUCTION MODE:
  // Must authenticate against the actual Raspberry Pi edge node endpoint.
  // The existing node_runtime/main.py only exposes WebSocket on /ingest and /health.
  // It does NOT yet expose an HTTP or WebSocket TOTP verification endpoint.
  try {
    const protocol = config.useSsl ? 'https' : 'http';
    const authUrl = `${protocol}://${config.piHost}:${config.piPort}/api/v1/auth/volunteer-session`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_id: cleanId,
        totp_code: cleanCode,
        client_type: 'volunteer_portal',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const now = Date.now();
      const session: AuthSession = {
        token: data.session_token || data.token,
        operatorId: cleanId,
        issuedAt: now,
        expiresAt: data.expires_at || now + SESSION_TTL_MS,
        isAuthenticated: true,
        nodeId: config.nodeId,
      };
      activeSession = session;
      return { success: true, session };
    } else if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        errorMessage: 'Authentication rejected: Invalid Operator ID or TOTP code.',
      };
    } else if (response.status === 404 || response.status === 501) {
      return {
        success: false,
        errorMessage:
          'Raspberry Pi backend returned 404/501: Authentication contract not yet implemented in node_runtime. Enable Dev/Mock mode for simulation.',
      };
    } else {
      return {
        success: false,
        errorMessage: `Raspberry Pi authentication failed with status ${response.status}: ${response.statusText}`,
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorMessage: `Failed to contact Raspberry Pi node at ${config.piHost}:${config.piPort}. Ensure node is online or use Dev/Mock mode. Details: ${message}`,
    };
  }
};

export const getActiveSession = (): AuthSession | null => {
  if (!activeSession) return null;
  if (Date.now() >= activeSession.expiresAt) {
    activeSession = null;
    return null;
  }
  return activeSession;
};

export const clearSession = (): void => {
  activeSession = null;
};

export const isSessionValid = (session: AuthSession | null): boolean => {
  if (!session || !session.isAuthenticated) return false;
  return Date.now() < session.expiresAt;
};
