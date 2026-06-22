export type Vec3 = [number, number, number];

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type Handedness = 'left' | 'right' | 'unknown';
export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error';
export type TrackingMode = 'desktop' | 'screentop' | 'hmd';

export interface TrackedBone {
  type: 'metacarpal' | 'proximal' | 'intermediate' | 'distal';
  start: Vec3;
  end: Vec3;
  width: number;
}

export interface TrackedFinger {
  id: string;
  type: FingerName;
  extended: boolean;
  joints: Vec3[];
  bones: TrackedBone[];
}

export interface TrackedHand {
  id: string;
  type: Handedness;
  confidence?: number;
  grabStrength?: number;
  pinchStrength?: number;
  palmPosition: Vec3;
  palmNormal?: Vec3;
  direction?: Vec3;
  wristPosition: Vec3;
  elbowPosition?: Vec3;
  fingers: TrackedFinger[];
}

export interface TrackingFrame {
  id?: number;
  timestamp?: number;
  fps?: number;
  rawHandsCount: number;
  hands: TrackedHand[];
}

export interface DeviceState {
  attached?: boolean;
  streaming?: boolean;
  type?: string;
  id?: string;
}

export interface TrackingSnapshot {
  phase: ConnectionPhase;
  url: string;
  trackingMode: TrackingMode;
  protocolVersion?: number;
  serviceVersion?: string;
  error?: string;
  device?: DeviceState;
  frame?: TrackingFrame;
  lastMessageAt?: number;
}

export interface TrackingStatusSnapshot {
  phase: ConnectionPhase;
  url: string;
  trackingMode: TrackingMode;
  protocolVersion?: number;
  serviceVersion?: string;
  error?: string;
  device?: DeviceState;
  lastMessageAt?: number;
  handsCount: number;
  fps?: number;
}
