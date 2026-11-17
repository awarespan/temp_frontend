/**
 * AWARESPAN Volunteer Portal — Raspberry Pi Integration Client
 *
 * Implements communication with the AWARESPAN edge node runtime:
 * - Production Mode: Connects directly to verified Raspberry Pi endpoints
 *   (ws://<host>:8766/ingest and ws://<host>:8766/health).
 *   Strictly adheres to node_runtime protocol: NEVER fabricates responses.
 * - Dev/Mock Mode: High-fidelity simulator for end-to-end testing without hardware.
 */

import { AnnotatedFramePayload, FramePayload, PiDetectionEvent, PiNodeCapabilities, PiNodeConfig, VolunteerMode } from '../types';

export interface PiClientCallbacks {
  onStatusChange: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'rejected') => void;
  onSourceAcknowledged: (source: 'camera' | 'microphone') => void;
  onLatencyUpdate: (latencyMs: number) => void;
  onHeartbeat: (timestamp: number) => void;
  onError: (error: string) => void;
  onClose: (reason: string) => void;
  onAnnotatedFrame?: (frame: AnnotatedFramePayload) => void;
  onDetectionEvent?: (event: PiDetectionEvent) => void;
  onCapabilities?: (capabilities: PiNodeCapabilities) => void;
  onSourceRejected?: (source: 'camera' | 'microphone', reason: string) => void;
}

export class PiConnectionClient {
  private config: PiNodeConfig;
  private callbacks: PiClientCallbacks;
  private ws: WebSocket | null = null;
  private dashboardWs: WebSocket | null = null;
  private dashboardReconnectTimer: number | null = null;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private isVolunteering: boolean = false;
  private activeMode: VolunteerMode = 'camera';
  private pingInterval: number | null = null;
  private mockHeartbeatInterval: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private manualStop: boolean = false;
  private isRejected: boolean = false;
  private lastPingSentTs: number = 0;

  constructor(config: PiNodeConfig, callbacks: PiClientCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  public updateConfig(config: PiNodeConfig): void {
    this.config = config;
  }

  /**
   * Check if Raspberry Pi node is online by probing /health.
   */
  public async checkHealth(): Promise<{ online: boolean; nodeId?: string; capabilities?: PiNodeCapabilities; error?: string }> {
    if (this.config.mockMode) {
      return { online: true, nodeId: this.config.nodeId };
    }

    return new Promise((resolve) => {
      try {
        const protocol = this.config.useSsl ? 'wss' : 'ws';
        const url = `${protocol}://${this.config.piHost}:${this.config.piPort}/health`;
        const socket = new WebSocket(url);
        let resolved = false;

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try { socket.close(); } catch (_) { /* ignore */ }
            resolve({ online: false, error: 'Health probe timed out (2500ms)' });
          }
        }, 2500);

        socket.onmessage = (event) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            try {
              const data = JSON.parse(event.data);
              const capabilities = data.capabilities as PiNodeCapabilities | undefined;
              if (capabilities) this.callbacks.onCapabilities?.(capabilities);
              resolve({ online: data.status === 'ok', nodeId: data.node, capabilities });
            } catch {
              resolve({ online: true, nodeId: this.config.nodeId });
            }
          }
        };

        socket.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({ online: false, error: `Connection refused at ${url}` });
          }
        };

        socket.onclose = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({ online: false, error: 'Health socket closed without response' });
          }
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({ online: false, error: msg });
      }
    });
  }

  /**
   * Connect and initiate volunteer media session.
   */
  public async connectAndVolunteer(
    mode: VolunteerMode,
    sessionToken: string
  ): Promise<boolean> {
    this.manualStop = false;
    this.isRejected = false;
    this.activeMode = mode;
    this.reconnectAttempts = 0;

    return this.initiateSession(sessionToken);
  }

  private async initiateSession(sessionToken: string): Promise<boolean> {
    this.isConnecting = true;
    this.callbacks.onStatusChange('connecting');

    // ───────────────────────────────────────────────
    // DEV / MOCK MODE SIMULATION
    // ───────────────────────────────────────────────
    if (this.config.mockMode) {
      return this.initiateMockSession(sessionToken);
    }

    // ───────────────────────────────────────────────
    // PRODUCTION MODE: REAL PI WEBSOCKET
    // ───────────────────────────────────────────────
    return new Promise((resolve) => {
      try {
        const protocol = this.config.useSsl ? 'wss' : 'ws';
        // Connect to the verified /ingest endpoint from node_runtime/main.py
        const url = `${protocol}://${this.config.piHost}:${this.config.piPort}/ingest`;
        this.ws = new WebSocket(url);

        const connectionTimeout = setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            if (this.ws) {
              try { this.ws.close(); } catch (_) { /* ignore */ }
            }
            this.callbacks.onError(`Connection to Pi node at ${url} timed out (5000ms).`);
            this.callbacks.onStatusChange('disconnected');
            resolve(false);
          }
        }, 5000);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.isConnecting = false;
          this.isConnected = true;
          this.isVolunteering = true;
          this.callbacks.onStatusChange('connected');
          this.connectDashboardFeed();

          // Send session handshake header / metadata if supported
          try {
            this.ws?.send(JSON.stringify({
              type: 'volunteer_handshake',
              session_token: sessionToken,
              mode: this.activeMode,
              client: 'awarespan-volunteer-portal',
              ts_ms: Date.now(),
            }));
          } catch (e) {
            console.warn('[PiClient] Handshake send failed:', e);
          }

          // Start ping/latency monitoring
          this.startHeartbeatMonitor();
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'capabilities') {
              this.callbacks.onCapabilities?.(data as PiNodeCapabilities);
            }
            if (data.type === 'source_rejected' && (data.source === 'camera' || data.source === 'microphone')) {
              this.callbacks.onSourceRejected?.(data.source, String(data.reason || 'Source rejected by Pi.'));
            }
            if (data.type === 'pong' && this.lastPingSentTs > 0) {
              const rtt = Date.now() - this.lastPingSentTs;
              this.callbacks.onLatencyUpdate(rtt);
            }
            if (data.type === 'ack' && data.source) {
              this.callbacks.onSourceAcknowledged(data.source);
            }
            if (data.type === 'heartbeat') {
              this.callbacks.onHeartbeat(Date.now());
            }
            if (data.type === 'reject') {
              this.isRejected = true;
              this.callbacks.onError(data.message || 'Connection rejected by Pi node');
              this.callbacks.onStatusChange('rejected');
              this.disconnect(true);
            }
          } catch {
            // Non-JSON message from Pi
          }
        };

        this.ws.onerror = (event) => {
          console.warn('[PiClient] WebSocket error:', event);
          if (this.isConnecting) {
            clearTimeout(connectionTimeout);
            this.isConnecting = false;
            this.callbacks.onError(`Failed to connect to Raspberry Pi at ${url}`);
            this.callbacks.onStatusChange('disconnected');
            resolve(false);
          }
        };

        this.ws.onclose = (event) => {
          const wasConnected = this.isConnected;
          this.isConnected = false;
          this.isConnecting = false;
          this.stopHeartbeatMonitor();
          this.closeDashboardFeed();

          if (this.isRejected) {
            this.callbacks.onClose(event.reason || 'Session rejected by node');
            return;
          }

          if (!this.manualStop && wasConnected) {
            this.handleUnexpectedDisconnect(event.reason || 'WebSocket closed unexpectedly');
          } else {
            this.callbacks.onStatusChange('disconnected');
            this.callbacks.onClose(event.reason || 'Session closed');
          }
        };
      } catch (err: unknown) {
        this.isConnecting = false;
        const msg = err instanceof Error ? err.message : String(err);
        this.callbacks.onError(`WebSocket instantiation error: ${msg}`);
        this.callbacks.onStatusChange('disconnected');
        resolve(false);
      }
    });
  }

  /**
   * Subscribe to the Pi's read-only dashboard stream. Annotated JPEG frames
   * already contain boxes drawn by the Pi's inference pipeline.
   */
  private connectDashboardFeed(): void {
    if (this.config.mockMode || !this.isConnected || this.manualStop) return;
    if (!this.callbacks.onAnnotatedFrame && !this.callbacks.onDetectionEvent) return;
    if (this.dashboardWs && (this.dashboardWs.readyState === WebSocket.OPEN || this.dashboardWs.readyState === WebSocket.CONNECTING)) return;
    const protocol = this.config.useSsl ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.piHost}:${this.config.piPort}/`;
    try {
      const socket = new WebSocket(url);
      this.dashboardWs = socket;
      socket.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data);
          if (data.type === 'capabilities') {
            this.callbacks.onCapabilities?.(data as PiNodeCapabilities);
          } else if (data.type === 'frame' && typeof data.annotated_b64 === 'string') {
            this.callbacks.onAnnotatedFrame?.(data as AnnotatedFramePayload);
          } else if (data.type === 'log' && data.event?.event_id) {
            this.callbacks.onDetectionEvent?.(data.event as PiDetectionEvent);
          }
        } catch { /* Ignore unrelated dashboard messages. */ }
      };
      socket.onclose = () => {
        if (this.dashboardWs === socket) this.dashboardWs = null;
        if (this.isConnected && !this.manualStop) {
          this.dashboardReconnectTimer = window.setTimeout(() => this.connectDashboardFeed(), 2000);
        }
      };
      socket.onerror = () => { /* Dashboard reconnects independently of media ingest. */ };
    } catch {
      this.dashboardWs = null;
    }
  }

  private closeDashboardFeed(): void {
    if (this.dashboardReconnectTimer !== null) {
      clearTimeout(this.dashboardReconnectTimer);
      this.dashboardReconnectTimer = null;
    }
    if (this.dashboardWs) {
      const socket = this.dashboardWs;
      this.dashboardWs = null;
      socket.onclose = null;
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  /**
   * Mock implementation for development & testing without live hardware.
   */
  private async initiateMockSession(_sessionToken: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.manualStop) {
          resolve(false);
          return;
        }

        this.isConnecting = false;
        this.isConnected = true;
        this.isVolunteering = true;
        this.callbacks.onStatusChange('connected');

        // Simulate Pi node individual source acknowledgements
        if (this.activeMode === 'camera' || this.activeMode === 'both') {
          setTimeout(() => {
            this.callbacks.onSourceAcknowledged('camera');
          }, 150);
        }

        if (this.activeMode === 'microphone' || this.activeMode === 'both') {
          setTimeout(() => {
            this.callbacks.onSourceAcknowledged('microphone');
          }, 300);
        }

        // Start mock heartbeat and latency updates
        this.startMockHeartbeat();
        resolve(true);
      }, 400);
    });
  }

  private startMockHeartbeat(): void {
    this.stopHeartbeatMonitor();
    this.mockHeartbeatInterval = window.setInterval(() => {
      if (this.isConnected) {
        const simulatedRtt = Math.floor(18 + Math.random() * 20); // 18-38 ms
        this.callbacks.onLatencyUpdate(simulatedRtt);
        this.callbacks.onHeartbeat(Date.now());
      }
    }, 4000);
  }

  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentTs = Date.now();
        try {
          this.ws.send(JSON.stringify({ type: 'ping', ts_ms: this.lastPingSentTs }));
        } catch {
          // ignore
        }
      }
    }, 5000);
  }

  private stopHeartbeatMonitor(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.mockHeartbeatInterval !== null) {
      clearInterval(this.mockHeartbeatInterval);
      this.mockHeartbeatInterval = null;
    }
  }

  /**
   * Handle unexpected network drops with exponential backoff.
   */
  private handleUnexpectedDisconnect(reason: string): void {
    if (this.manualStop) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts += 1;
      const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
      this.callbacks.onStatusChange('reconnecting');
      this.callbacks.onError(`Connection lost (${reason}). Retrying in ${delayMs / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      this.reconnectTimer = window.setTimeout(() => {
        this.initiateSession('reconnect-token');
      }, delayMs);
    } else {
      this.callbacks.onStatusChange('disconnected');
      this.callbacks.onError(`Connection failed after ${this.maxReconnectAttempts} reconnect attempts. Raspberry Pi unreachable.`);
      this.disconnect();
    }
  }

  /**
   * Transmit captured video frame to Raspberry Pi.
   * Conforms exactly to node_runtime/main.py protocol:
   * { "type": "frame", "frame_id": int, "ts_ms": int, "jpeg_b64": string }
   */
  public sendFrame(payload: FramePayload): boolean {
    if (!this.isConnected) return false;

    if (this.config.mockMode) {
      // In mock mode, simply simulate transmission latency
      return true;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch (e) {
        console.warn('[PiClient] Frame send error:', e);
        return false;
      }
    }

    return false;
  }

  /**
   * Transmit audio chunk to Raspberry Pi (when audio ingestion endpoint is available).
   */
  public sendAudioChunk(chunk: ArrayBuffer | Blob): boolean {
    if (!this.isConnected) return false;

    if (this.config.mockMode) {
      return true;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(chunk);
        return true;
      } catch (e) {
        console.warn('[PiClient] Audio chunk send error:', e);
        return false;
      }
    }

    return false;
  }

  /**
   * Gracefully stop volunteering and close connection.
   */
  public disconnect(suppressStatusUpdate: boolean = false): void {
    this.manualStop = true;
    this.isVolunteering = false;
    this.isConnected = false;
    this.isConnecting = false;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeatMonitor();
    this.closeDashboardFeed();

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'volunteer_stop', ts_ms: Date.now() }));
        }
        this.ws.close();
      } catch (e) {
        console.warn('[PiClient] Disconnect error:', e);
      }
      this.ws = null;
    }

    if (!suppressStatusUpdate) {
      this.callbacks.onStatusChange('disconnected');
    }
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getIsVolunteering(): boolean {
    return this.isVolunteering;
  }
}
