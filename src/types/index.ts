/**
 * AWARESPAN Volunteer Portal — Type Definitions
 */

export type ConnectionState =
  | 'NOT_CONNECTED'
  | 'AUTHENTICATING'
  | 'CONNECTING'
  | 'AWAITING_PI_ACK'
  | 'CAMERA_CONNECTED'
  | 'MICROPHONE_CONNECTED'
  | 'BOTH_CONNECTED'
  | 'RECONNECTING'
  | 'CONNECTION_LOST'
  | 'STOPPED_BY_USER'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'BACKEND_UNAVAILABLE';

export type VolunteerMode = 'camera' | 'microphone' | 'both';

export interface AuthSession {
  token: string;
  operatorId: string;
  issuedAt: number;
  expiresAt: number;
  isAuthenticated: boolean;
  nodeId: string;
}

export interface AvailableDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  selectedCameraId: string;
  selectedMicrophoneId: string;
}

export interface MediaPermissionState {
  camera: 'prompt' | 'granted' | 'denied' | 'unavailable';
  microphone: 'prompt' | 'granted' | 'denied' | 'unavailable';
}

export interface SessionTelemetry {
  durationSeconds: number;
  framesSent: number;
  fps: number;
  latencyMs: number;
  bytesSent: number;
  audioPeakLevel: number; // 0-100
  audioRmsLevel: number;  // 0-100
  lastHeartbeatTs: number | null;
  reconnectAttempts: number;
  cameraActive: boolean;
  microphoneActive: boolean;
  piNodeId: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogCategory = 'system' | 'auth' | 'network' | 'media' | 'ack';

export interface PortalLog {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
}

export interface FramePayload {
  type: 'frame';
  frame_id: number;
  ts_ms: number;
  jpeg_b64: string;
}

export interface PiNodeConfig {
  piHost: string;
  piPort: number;
  useSsl: boolean;
  nodeId: string;
  mockMode: boolean;
}
