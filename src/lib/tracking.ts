import { useEffect, useSyncExternalStore } from 'react';
import {
  type DeviceState,
  type FingerName,
  type Handedness,
  type TrackingMode,
  type TrackingFrame,
  type TrackingSnapshot,
  type TrackingStatusSnapshot,
  type TrackedFinger,
  type TrackedHand,
  type Vec3,
} from './types';

const DEFAULT_WS_URL =
  import.meta.env.VITE_TRACKING_WS_URL ?? 'ws://127.0.0.1:6437/v6.json';
const DEFAULT_TRACKING_MODE = normalizeMode(
  import.meta.env.VITE_TRACKING_MODE,
) ?? 'desktop';

const EMPTY_FRAME: TrackingFrame = {
  hands: [],
  rawHandsCount: 0,
};

const INITIAL_SNAPSHOT: TrackingSnapshot = {
  phase: 'idle',
  url: DEFAULT_WS_URL,
  trackingMode: DEFAULT_TRACKING_MODE,
  frame: EMPTY_FRAME,
};

const INITIAL_STATUS_SNAPSHOT: TrackingStatusSnapshot = {
  phase: 'idle',
  url: DEFAULT_WS_URL,
  trackingMode: DEFAULT_TRACKING_MODE,
  handsCount: 0,
};

const BONE_NAMES = ['metacarpal', 'proximal', 'intermediate', 'distal'] as const;
const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

class LeapTrackingStore {
  private snapshot: TrackingSnapshot = INITIAL_SNAPSHOT;
  private statusSnapshot: TrackingStatusSnapshot = INITIAL_STATUS_SNAPSHOT;
  private frameListeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private socket: WebSocket | undefined;
  private reconnectTimer: number | undefined;
  private rafHandle: number | undefined;
  private retainCount = 0;
  private latestFrame: TrackingFrame = EMPTY_FRAME;
  private started = false;
  private trackingMode: TrackingMode = DEFAULT_TRACKING_MODE;
  private lastStatusEmitAt = 0;
  private visibilityHandler = () => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.sendFocusState();
  };

  subscribeFrame = (listener: () => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };

  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  getFrameSnapshot = () => this.snapshot.frame ?? EMPTY_FRAME;

  getStatusSnapshot = () => this.statusSnapshot;

  retain = () => {
    this.retainCount += 1;
    if (!this.started) {
      this.start();
    }

    return () => {
      this.retainCount = Math.max(0, this.retainCount - 1);
      if (this.retainCount === 0) {
        this.stop();
      }
    };
  };

  private emitFrame() {
    for (const listener of this.frameListeners) {
      listener();
    }
  }

  private emitStatus() {
    for (const listener of this.statusListeners) {
      listener();
    }
  }

  private patchSnapshot(next: Partial<TrackingSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...next,
    };
    this.emitFrame();
  }

  private patchStatusSnapshot(next: Partial<TrackingStatusSnapshot>) {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...next,
    };
    this.emitStatus();
  }

  private start() {
    this.started = true;
    this.patchStatusSnapshot({
      phase: 'connecting',
      error: undefined,
      url: DEFAULT_WS_URL,
      trackingMode: this.trackingMode,
      handsCount: 0,
    });
    this.connect();
    this.startFramePump();
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('focus', this.visibilityHandler);
    window.addEventListener('blur', this.visibilityHandler);
  }

  private stop() {
    this.started = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.rafHandle) {
      window.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = undefined;
    }

    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('focus', this.visibilityHandler);
    window.removeEventListener('blur', this.visibilityHandler);

    if (this.socket) {
      const socket = this.socket;
      this.socket = undefined;
      socket.close();
    }

    this.latestFrame = EMPTY_FRAME;
    this.snapshot = {
      ...INITIAL_SNAPSHOT,
      url: DEFAULT_WS_URL,
      trackingMode: this.trackingMode,
    };
    this.statusSnapshot = {
      ...INITIAL_STATUS_SNAPSHOT,
      url: DEFAULT_WS_URL,
      trackingMode: this.trackingMode,
    };
    this.lastStatusEmitAt = 0;
    this.emitFrame();
    this.emitStatus();
  }

  private connect() {
    if (!this.started) {
      return;
    }

    let socket: WebSocket;

    try {
      socket = new WebSocket(DEFAULT_WS_URL);
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : 'Failed to open websocket.');
      return;
    }

    this.socket = socket;

    socket.addEventListener('open', () => {
      this.patchStatusSnapshot({
        phase: 'connected',
        error: undefined,
        trackingMode: this.trackingMode,
      });

      socket.send(JSON.stringify({ background: true }));
      this.sendTrackingMode();
      this.sendFocusState();
    });

    socket.addEventListener('message', (event) => {
      let payload: unknown;

      try {
        payload = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const now = Date.now();

      if (isVersionMessage(payload)) {
        this.patchStatusSnapshot({
          protocolVersion: payload.version,
          serviceVersion: payload.serviceVersion,
          lastMessageAt: now,
        });
        return;
      }

      if (isDeviceEvent(payload)) {
        const attached = payload.event.state.attached !== false;

        if (!attached) {
          this.latestFrame = EMPTY_FRAME;
          this.patchSnapshot({
            frame: EMPTY_FRAME,
          });
        }

        this.patchStatusSnapshot({
          phase: 'connected',
          device: payload.event.state,
          lastMessageAt: now,
          handsCount: attached ? this.statusSnapshot.handsCount : 0,
          fps: attached ? this.statusSnapshot.fps : undefined,
        });
        return;
      }

      if (isTrackingFrame(payload)) {
        if (this.statusSnapshot.device?.attached === false) {
          return;
        }

        this.latestFrame = normalizeFrame(payload);
        if (this.statusSnapshot.phase !== 'streaming' || this.statusSnapshot.error) {
          this.patchStatusSnapshot({
            phase: 'streaming',
            error: undefined,
            lastMessageAt: now,
          });
        }
      }
    });

    socket.addEventListener('close', () => {
      if (!this.started) {
        return;
      }

      this.scheduleReconnect(
        'Leap websocket disconnected. Check that npm run tracking:bridge and the Ultraleap service are running.',
      );
    });

    socket.addEventListener('error', () => {
      if (!this.started) {
        return;
      }

      this.patchStatusSnapshot({
        phase: 'error',
        error: 'Websocket error. Check that the bridge process is still running on port 6437.',
      });
    });
  }

  private startFramePump() {
    const tick = () => {
      if (!this.started) {
        return;
      }

      if (this.snapshot.frame !== this.latestFrame) {
        this.patchSnapshot({
          frame: this.latestFrame,
        });

        const now = Date.now();
        if (now - this.lastStatusEmitAt > 250) {
          const deviceAttached = this.statusSnapshot.device?.attached !== false;
          this.lastStatusEmitAt = now;
          this.patchStatusSnapshot({
            lastMessageAt: now,
            fps: deviceAttached ? this.latestFrame.fps : undefined,
            handsCount: deviceAttached ? this.latestFrame.hands.length : 0,
            phase: deviceAttached ? 'streaming' : 'connected',
            error: undefined,
          });
        }
      }

      this.rafHandle = window.requestAnimationFrame(tick);
    };

    this.rafHandle = window.requestAnimationFrame(tick);
  }

  private scheduleReconnect(message: string) {
    this.patchStatusSnapshot({
      phase: 'error',
      error: message,
      handsCount: 0,
    });

    if (this.socket) {
      this.socket = undefined;
    }

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.patchStatusSnapshot({
        phase: 'connecting',
      });
      this.connect();
    }, 1500);
  }

  private sendFocusState() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const isVisible = document.visibilityState === 'visible' && document.hasFocus();
    this.socket.send(JSON.stringify({ focused: isVisible }));
  }

  private sendTrackingMode() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    switch (this.trackingMode) {
      case 'screentop':
        this.socket.send(JSON.stringify({ optimizeScreentop: true }));
        break;
      case 'hmd':
        this.socket.send(JSON.stringify({ optimizeHMD: true }));
        break;
      case 'desktop':
      default:
        this.socket.send(JSON.stringify({ optimizeHMD: false }));
        break;
    }
  }

  setTrackingMode = (mode: TrackingMode) => {
    if (this.trackingMode === mode) {
      return;
    }

    this.trackingMode = mode;
    this.patchStatusSnapshot({
      trackingMode: mode,
    });
    this.sendTrackingMode();
  };
}

const trackingStore = new LeapTrackingStore();

export function useLeapFrame() {
  useEffect(() => trackingStore.retain(), []);
  return useSyncExternalStore(
    trackingStore.subscribeFrame,
    trackingStore.getFrameSnapshot,
    trackingStore.getFrameSnapshot,
  );
}

export function useLeapTrackingStatus() {
  useEffect(() => trackingStore.retain(), []);
  return useSyncExternalStore(
    trackingStore.subscribeStatus,
    trackingStore.getStatusSnapshot,
    trackingStore.getStatusSnapshot,
  );
}

export function setTrackingMode(mode: TrackingMode) {
  trackingStore.setTrackingMode(mode);
}

function normalizeFrame(payload: Record<string, unknown>): TrackingFrame {
  const rawHands = Array.isArray(payload.hands) ? payload.hands : [];
  const rawPointables = Array.isArray(payload.pointables) ? payload.pointables : [];

  return {
    id: typeof payload.id === 'number' ? payload.id : undefined,
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : undefined,
    fps:
      typeof payload.currentFrameRate === 'number'
        ? payload.currentFrameRate
        : undefined,
    rawHandsCount: rawHands.length,
    hands: rawHands
      .map((rawHand) => normalizeHand(rawHand, rawPointables))
      .filter((hand): hand is TrackedHand => hand !== undefined),
  };
}

function normalizeHand(
  rawHand: unknown,
  rawPointables: unknown[],
): TrackedHand | undefined {
  if (!isRecord(rawHand)) {
    return undefined;
  }

  const handId = rawHand.id;
  const fingersFromHand = Array.isArray(rawHand.fingers) ? rawHand.fingers : [];
  const fingersFromPointables = rawPointables.filter((pointable) => {
    if (!isRecord(pointable)) {
      return false;
    }

    return pointable.handId === handId && !pointable.tool;
  });

  const rawFingers = fingersFromHand.length > 0 ? fingersFromHand : fingersFromPointables;
  const fingers = rawFingers
    .map((rawFinger, index) => normalizeFinger(rawFinger, index))
    .filter((finger): finger is TrackedFinger => finger !== undefined);

  const palmPosition = asVec3(rawHand.palmPosition) ?? [0, 0, 0];
  const wristPosition =
    asVec3(rawHand.wrist) ??
    asVec3(rawHand.arm?.wristPosition) ??
    palmPosition;

  return {
    id: String(rawHand.id ?? `${rawHand.type ?? 'hand'}-${fingers.length}`),
    type: toHandedness(rawHand.type),
    confidence: asNumber(rawHand.confidence),
    grabStrength: asNumber(rawHand.grabStrength),
    pinchStrength: asNumber(rawHand.pinchStrength),
    palmPosition,
    palmNormal: asVec3(rawHand.palmNormal),
    direction: asVec3(rawHand.direction),
    wristPosition,
    elbowPosition: asVec3(rawHand.elbow) ?? asVec3(rawHand.arm?.elbowPosition),
    fingers,
  };
}

function normalizeFinger(rawFinger: unknown, index: number): TrackedFinger | undefined {
  if (!isRecord(rawFinger)) {
    return undefined;
  }

  const fingerName = toFingerName(rawFinger.type, index);
  const bones = Array.isArray(rawFinger.bones)
    ? rawFinger.bones
        .map((bone, boneIndex) => normalizeBone(bone, boneIndex))
        .filter((bone): bone is NonNullable<ReturnType<typeof normalizeBone>> => bone !== undefined)
    : [];

  const joints =
    bones.length > 0
      ? jointsFromBones(bones)
      : jointsFromPointable(rawFinger);

  if (joints.length === 0) {
    return undefined;
  }

  return {
    id: String(rawFinger.id ?? `${fingerName}-${index}`),
    type: fingerName,
    extended: Boolean(rawFinger.extended),
    joints,
    bones,
  };
}

function normalizeBone(rawBone: unknown, boneIndex: number) {
  if (!isRecord(rawBone)) {
    return undefined;
  }

  const start = asVec3(rawBone.prevJoint);
  const end = asVec3(rawBone.nextJoint);

  if (!start || !end) {
    return undefined;
  }

  return {
    type: BONE_NAMES[boneIndex] ?? 'distal',
    start,
    end,
    width: asNumber(rawBone.width) ?? 12,
  };
}

function jointsFromBones(
  bones: {
    start: Vec3;
    end: Vec3;
  }[],
) {
  if (bones.length === 0) {
    return [];
  }

  return [bones[0].start, ...bones.map((bone) => bone.end)];
}

function jointsFromPointable(rawFinger: Record<string, unknown>) {
  const candidates = [
    asVec3(rawFinger.carpPosition),
    asVec3(rawFinger.mcpPosition),
    asVec3(rawFinger.pipPosition),
    asVec3(rawFinger.dipPosition),
    asVec3(rawFinger.btipPosition) ?? asVec3(rawFinger.tipPosition),
  ].filter((joint): joint is Vec3 => joint !== undefined);

  return dedupeJoints(candidates);
}

function dedupeJoints(joints: Vec3[]) {
  return joints.filter((joint, index) => {
    const previous = joints[index - 1];
    if (!previous) {
      return true;
    }

    return (
      joint[0] !== previous[0] ||
      joint[1] !== previous[1] ||
      joint[2] !== previous[2]
    );
  });
}

function toFingerName(rawType: unknown, fallbackIndex: number): FingerName {
  if (typeof rawType === 'string') {
    const lowered = rawType.toLowerCase();
    if (
      lowered === 'thumb' ||
      lowered === 'index' ||
      lowered === 'middle' ||
      lowered === 'ring' ||
      lowered === 'pinky'
    ) {
      return lowered;
    }
  }

  if (typeof rawType === 'number' && FINGER_NAMES[rawType]) {
    return FINGER_NAMES[rawType];
  }

  return FINGER_NAMES[fallbackIndex] ?? 'index';
}

function toHandedness(rawType: unknown): Handedness {
  if (rawType === 'left' || rawType === 'right') {
    return rawType;
  }

  return 'unknown';
}

function asVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }

  const [x, y, z] = value;

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number'
  ) {
    return undefined;
  }

  return [x, y, z];
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}

function isVersionMessage(
  payload: unknown,
): payload is { version: number; serviceVersion?: string } {
  return (
    isRecord(payload) &&
    typeof payload.version === 'number' &&
    !Array.isArray(payload.hands)
  );
}

function isDeviceEvent(
  payload: unknown,
): payload is { event: { state: DeviceState; type: 'deviceEvent' } } {
  return (
    isRecord(payload) &&
    isRecord(payload.event) &&
    payload.event.type === 'deviceEvent' &&
    isRecord(payload.event.state)
  );
}

function isTrackingFrame(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload) && ('hands' in payload || 'pointables' in payload);
}

function normalizeMode(value: unknown): TrackingMode | undefined {
  if (value === 'desktop' || value === 'screentop' || value === 'hmd') {
    return value;
  }

  return undefined;
}
