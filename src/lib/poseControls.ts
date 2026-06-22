export type SourceAxis = 'x' | 'y' | 'z';

export interface AxisMapping {
  source: SourceAxis;
  sign: 1 | -1;
}

export interface PoseControlsState {
  sceneX: AxisMapping;
  sceneY: AxisMapping;
  sceneZ: AxisMapping;
  useRootPosition: boolean;
  usePalmRotation: boolean;
  rootRotationBlend: number;
  reverseBoneDirection: boolean;
}

export const DEFAULT_POSE_CONTROLS: PoseControlsState = {
  sceneX: { source: 'x', sign: 1 },
  sceneY: { source: 'y', sign: 1 },
  sceneZ: { source: 'z', sign: 1 },
  useRootPosition: true,
  usePalmRotation: true,
  rootRotationBlend: 1,
  reverseBoneDirection: false,
};
