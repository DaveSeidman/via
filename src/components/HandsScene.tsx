import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, Line, useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { SkeletonUtils } from 'three-stdlib';
import {
  type FingerName,
  type TrackingFrame,
  type TrackedFinger,
  type TrackedHand,
  type Vec3,
} from '../lib/types';
import { type PoseControlsState } from '../lib/poseControls';
import { useLeapFrame } from '../lib/tracking';
import { HeadCoupledCamera } from './HeadCoupledCamera';

const MM_TO_WORLD = 0.0075;
const LEFT_COLOR = '#ff8f70';
const RIGHT_COLOR = '#71d6ff';
const HAND_CLEAR_DELAY_MS = 160;
const DEFAULT_LIVE_HAND_SCALE = 5.8;
const MIN_LIVE_HAND_SCALE = 3.2;
const MAX_LIVE_HAND_SCALE = 8.5;
const LIVE_HAND_SCALE_LERP = 0.35;
const GHOST_RIM_POWER = 2.15;
const GHOST_RIM_STRENGTH = 1.65;
const FLOATING_OBJECT_COUNT = 9;
const FLOATING_OBJECT_DAMPING = 0.988;
const FLOATING_OBJECT_BOUNDS = {
  min: new Vector3(-1.55, 0.48, -1.05),
  max: new Vector3(1.55, 2.35, 1.25),
};
const FLOOR_GRID_POSITION = [0, 0.02, 0.15] as const;
const WALL_GRID_POSITION = [0, 1.35, -1.4] as const;
const TARGET_DIRECTION = new Vector3();
const TARGET_QUATERNION = new Quaternion();
const COLLISION_DELTA = new Vector3();
const COLLISION_NORMAL = new Vector3();
const ROOT_DIRECTION = new Vector3();
const ROOT_NORMAL = new Vector3();
const ROOT_SIDE = new Vector3();
const ROOT_QUATERNION = new Quaternion();
const ROOT_MATRIX = new Matrix4();
const REST_WRIST_OFFSET = new Vector3();

const FINGER_JOINT_NAMES: Record<FingerName, string[]> = {
  thumb: [
    'thumb-metacarpal',
    'thumb-phalanx-proximal',
    'thumb-phalanx-distal',
    'thumb-tip',
  ],
  index: [
    'index-finger-metacarpal',
    'index-finger-phalanx-proximal',
    'index-finger-phalanx-intermediate',
    'index-finger-phalanx-distal',
    'index-finger-tip',
  ],
  middle: [
    'middle-finger-metacarpal',
    'middle-finger-phalanx-proximal',
    'middle-finger-phalanx-intermediate',
    'middle-finger-phalanx-distal',
    'middle-finger-tip',
  ],
  ring: [
    'ring-finger-metacarpal',
    'ring-finger-phalanx-proximal',
    'ring-finger-phalanx-intermediate',
    'ring-finger-phalanx-distal',
    'ring-finger-tip',
  ],
  pinky: [
    'pinky-finger-metacarpal',
    'pinky-finger-phalanx-proximal',
    'pinky-finger-phalanx-intermediate',
    'pinky-finger-phalanx-distal',
    'pinky-finger-tip',
  ],
};

interface SceneTransform {
  offset: [number, number, number];
  poseControls: PoseControlsState;
}

export function HandsScene({ poseControls }: { poseControls: PoseControlsState }) {
  const trackingFrame = useLeapFrame();
  const liveHands = trackingFrame.hands ?? [];
  const hands = useStickyHands(liveHands);
  const transform = useSceneTransform(hands, poseControls);

  return (
    <Canvas
      camera={{ position: [0, 1.55, 2.05], fov: 35 }}
      dpr={[1, 1.25]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#060816']} />
      <fog attach="fog" args={['#060816', 3.2, 8.5]} />

      <ambientLight intensity={0.7} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.3} color="#fff7e7" />
      <directionalLight position={[-2.5, 2.5, -3]} intensity={0.55} color="#79d4ff" />
      <pointLight position={[0, 1.25, 0]} intensity={12} distance={4.5} color="#13203c" />

      <HeadCoupledCamera />
      <SceneGrids />
      <SceneFrame />
      <FloatingPlayObjects hands={hands} transform={transform} />

      <Suspense fallback={null}>
        {hands.length > 0 ? (
          hands.map((hand) => (
            <group key={hand.id}>
              <SkinnedHandMesh hand={hand} transform={transform} />
            </group>
          ))
        ) : (
          <IdleHands />
        )}
      </Suspense>

    </Canvas>
  );
}

function SceneGrids() {
  return (
    <group>
      <Grid
        position={FLOOR_GRID_POSITION}
        rotation={[-Math.PI / 2, 0, 0]}
        cellSize={0.18}
        sectionSize={0.9}
        cellThickness={0.85}
        sectionThickness={1.35}
        cellColor="#23416c"
        sectionColor="#4f86c7"
        fadeDistance={2.8}
        fadeStrength={2}
        fadeFrom={0.42}
        infiniteGrid
        side={DoubleSide}
      />

      <Grid
        position={WALL_GRID_POSITION}
        cellSize={0.18}
        sectionSize={0.9}
        cellThickness={0.55}
        sectionThickness={1.1}
        cellColor="#173152"
        sectionColor="#6aa9ff"
        fadeDistance={2.5}
        fadeStrength={2.1}
        fadeFrom={0.54}
        side={DoubleSide}
      />
    </group>
  );
}

function IdleHands() {
  return (
    <group position={[0, 1.05, 0.15]}>
      <IdleHandModel
        modelPath="/models/hands/left.glb"
        color={LEFT_COLOR}
        emissive="#4c160e"
        position={[-0.42, 0, 0]}
        rotation={[0.18, 0, -0.36]}
        scale={5.8}
      />
      <IdleHandModel
        modelPath="/models/hands/right.glb"
        color={RIGHT_COLOR}
        emissive="#0b3348"
        position={[0.42, 0, 0]}
        rotation={[0.18, 0, 0.36]}
        scale={5.8}
      />
    </group>
  );
}

function IdleHandModel({
  modelPath,
  color,
  emissive,
  position,
  rotation,
  scale,
}: {
  modelPath: string;
  color: string;
  emissive: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}) {
  const gltf = useGLTF(modelPath);
  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(gltf.scene) as Group;
    applyHandMaterial(clone, color, emissive, 0.72);
    clone.position.set(...position);
    clone.rotation.set(...rotation);
    clone.scale.setScalar(scale);
    return clone;
  }, [
    color,
    emissive,
    gltf.scene,
    position[0],
    position[1],
    position[2],
    rotation[0],
    rotation[1],
    rotation[2],
    scale,
  ]);

  return <primitive object={model} />;
}

function SkinnedHandMesh({
  hand,
  transform,
}: {
  hand: TrackedHand;
  transform: SceneTransform;
}) {
  const modelPath =
    hand.type === 'left'
      ? '/models/hands/left.glb'
      : hand.type === 'right'
        ? '/models/hands/right.glb'
        : undefined;

  if (!modelPath) {
    return null;
  }

  return <TrackedHandModel modelPath={modelPath} hand={hand} transform={transform} />;
}

function TrackedHandModel({
  modelPath,
  hand,
  transform,
}: {
  modelPath: string;
  hand: TrackedHand;
  transform: SceneTransform;
}) {
  const root = useRef<Group>(null);
  const gltf = useGLTF(modelPath);
  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(gltf.scene) as Group;
    clone.traverse((node) => {
      if (!isMeshLike(node)) {
        return;
      }
      node.frustumCulled = false;
    });

    applyHandMaterial(
      clone,
      hand.type === 'left' ? LEFT_COLOR : RIGHT_COLOR,
      hand.type === 'left' ? '#4c160e' : '#0b3348',
      0.62,
    );

    return clone;
  }, [gltf.scene, hand.type]);

  const bones = useMemo(() => collectBones(model), [model]);

  useFrame(() => {
    if (root.current) {
      poseSkinnedHand(root.current, model, bones, hand, transform);
    }
  });

  return (
    <group ref={root}>
      <primitive object={model} />
    </group>
  );
}

type FloatingShape = 'box' | 'sphere' | 'tetrahedron' | 'octahedron' | 'torus';

interface FloatingObjectState {
  id: string;
  shape: FloatingShape;
  radius: number;
  color: string;
  position: Vector3;
  velocity: Vector3;
  angularVelocity: Vector3;
}

interface HandCollider {
  key: string;
  position: Vector3;
  radius: number;
  velocity: Vector3;
}

function FloatingPlayObjects({
  hands,
  transform,
}: {
  hands: TrackedHand[];
  transform: SceneTransform;
}) {
  const objects = useMemo(createFloatingObjects, []);
  const meshRefs = useRef<Array<Mesh | null>>([]);
  const previousColliders = useRef(new Map<string, Vector3>());

  useFrame((_, delta) => {
    const safeDelta = clamp(delta, 0.001, 0.033);
    const colliders = withColliderVelocities(
      createHandColliders(hands, transform),
      previousColliders.current,
      safeDelta,
    );
    const nextColliders = new Map<string, Vector3>();

    for (const collider of colliders) {
      nextColliders.set(collider.key, collider.position.clone());
    }

    previousColliders.current = nextColliders;

    objects.forEach((object, index) => {
      const mesh = meshRefs.current[index];

      object.position.addScaledVector(object.velocity, safeDelta);
      object.velocity.multiplyScalar(Math.pow(FLOATING_OBJECT_DAMPING, safeDelta * 60));
      object.angularVelocity.multiplyScalar(Math.pow(0.994, safeDelta * 60));

      for (const collider of colliders) {
        COLLISION_DELTA.subVectors(object.position, collider.position);
        const distance = COLLISION_DELTA.length();
        const minDistance = object.radius + collider.radius;

        if (distance >= minDistance) {
          continue;
        }

        if (distance > 0.0001) {
          COLLISION_NORMAL.copy(COLLISION_DELTA).divideScalar(distance);
        } else {
          COLLISION_NORMAL.set(0, 1, 0);
        }

        const penetration = minDistance - distance;
        object.position.addScaledVector(COLLISION_NORMAL, penetration + 0.002);
        object.velocity.addScaledVector(COLLISION_NORMAL, penetration * 18);
        object.velocity.addScaledVector(collider.velocity, 0.22);
        object.angularVelocity.x += COLLISION_NORMAL.z * 2.2 + collider.velocity.y * 0.16;
        object.angularVelocity.y += -COLLISION_NORMAL.x * 2.2 + collider.velocity.x * 0.16;
        object.angularVelocity.z += collider.velocity.x * 0.08 - collider.velocity.y * 0.08;
      }

      constrainFloatingObject(object);

      if (mesh) {
        mesh.position.copy(object.position);
        mesh.rotation.x += object.angularVelocity.x * safeDelta;
        mesh.rotation.y += object.angularVelocity.y * safeDelta;
        mesh.rotation.z += object.angularVelocity.z * safeDelta;
      }
    });
  });

  return (
    <group>
      {objects.map((object, index) => (
        <mesh
          key={object.id}
          ref={(node) => {
            meshRefs.current[index] = node;
          }}
          position={object.position}
        >
          <FloatingObjectGeometry object={object} />
          <meshStandardMaterial
            color={object.color}
            emissive={object.color}
            emissiveIntensity={0.08}
            metalness={0.08}
            opacity={0.72}
            roughness={0.34}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
}

function FloatingObjectGeometry({ object }: { object: FloatingObjectState }) {
  switch (object.shape) {
    case 'box':
      return (
        <boxGeometry
          args={[object.radius * 1.6, object.radius * 1.16, object.radius * 1.34]}
        />
      );
    case 'tetrahedron':
      return <tetrahedronGeometry args={[object.radius * 1.55, 0]} />;
    case 'octahedron':
      return <octahedronGeometry args={[object.radius * 1.36, 0]} />;
    case 'torus':
      return <torusGeometry args={[object.radius * 0.72, object.radius * 0.25, 10, 26]} />;
    case 'sphere':
    default:
      return <sphereGeometry args={[object.radius, 24, 16]} />;
  }
}

interface HandRig {
  bones: Map<string, Bone>;
  restBasis: Quaternion;
  restLengths: Map<string, number>;
  restDirections: Map<string, Vector3>;
  restRollCorrections: Map<string, Quaternion>;
  restWristPosition: Vector3;
}

type MeshLike = Object3D & {
  castShadow: boolean;
  frustumCulled: boolean;
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  material: unknown;
  receiveShadow: boolean;
};

function collectBones(model: Group): HandRig {
  const bones = new Map<string, Bone>();
  const restBasis = new Quaternion();
  const restLengths = new Map<string, number>();
  const restDirections = new Map<string, Vector3>();
  const restRollCorrections = new Map<string, Quaternion>();
  const restWristPosition = new Vector3();

  // Ensure world matrices are current before reading bone positions/rotations.
  model.updateMatrixWorld(true);

  model.traverse((node) => {
    if (!(node instanceof Bone)) {
      return;
    }

    bones.set(node.name, node);
  });

  for (const jointNames of Object.values(FINGER_JOINT_NAMES)) {
    for (let index = 0; index < jointNames.length - 1; index++) {
      const name = jointNames[index];
      const bone = bones.get(name);
      const nextBone = bones.get(jointNames[index + 1]);

      if (!bone || !nextBone) {
        continue;
      }

      // These joints are flat siblings under Armature. Preserve the baked bind
      // roll separately so live aiming does not twist the skinned mesh at joints.
      const boneWorld = bone.getWorldPosition(new Vector3());
      const nextBoneWorld = nextBone.getWorldPosition(new Vector3());
      const boneParent = bone.parent;
      const boneParentLocal = boneParent
        ? boneParent.worldToLocal(boneWorld.clone())
        : boneWorld.clone();
      const nextParentLocal = boneParent
        ? boneParent.worldToLocal(nextBoneWorld.clone())
        : nextBoneWorld.clone();

      restLengths.set(name, boneWorld.distanceTo(nextBoneWorld));

      const parentDir = nextParentLocal.sub(boneParentLocal).normalize();
      // Rotate the parent-space rest direction into the bone's own local frame
      // via Q_rest^-1.
      const restDir = parentDir.clone().applyQuaternion(bone.quaternion.clone().invert());
      restDirections.set(name, restDir);
      restRollCorrections.set(
        name,
        getRestRollCorrection(restDir, parentDir, bone.quaternion),
      );
    }
  }

  const wrist = bones.get('wrist');
  const indexMetacarpal = bones.get('index-finger-metacarpal');
  const pinkyMetacarpal = bones.get('pinky-finger-metacarpal');

  if (wrist && indexMetacarpal && pinkyMetacarpal) {
    restWristPosition.copy(wrist.position);

    const wristWorld = wrist.getWorldPosition(new Vector3());
    const indexWorld = indexMetacarpal.getWorldPosition(new Vector3());
    const pinkyWorld = pinkyMetacarpal.getWorldPosition(new Vector3());
    const midpointWorld = indexWorld.clone().add(pinkyWorld).multiplyScalar(0.5);
    const wristParent = wrist.parent;
    const wristParentLocal = wristParent
      ? wristParent.worldToLocal(wristWorld.clone())
      : wristWorld.clone();
    const midpointParentLocal = wristParent
      ? wristParent.worldToLocal(midpointWorld.clone())
      : midpointWorld.clone();
    const parentDir = midpointParentLocal.sub(wristParentLocal).normalize();
    // Same Q_rest^-1 transform for the wrist's natural axis.
    const restDir = parentDir.clone().applyQuaternion(wrist.quaternion.clone().invert());
    restDirections.set('wrist', restDir);
    restRollCorrections.set(
      'wrist',
      getRestRollCorrection(restDir, parentDir, wrist.quaternion),
    );
  }

  const middleTip = bones.get('middle-finger-tip');
  const middleMetacarpal = bones.get('middle-finger-metacarpal');

  if (wrist && middleTip && indexMetacarpal && pinkyMetacarpal) {
    const wristWorld = wrist.getWorldPosition(new Vector3());
    const middleTipWorld = middleTip.getWorldPosition(new Vector3());
    const indexWorld = indexMetacarpal.getWorldPosition(new Vector3());
    const pinkyWorld = pinkyMetacarpal.getWorldPosition(new Vector3());

    const forward = middleTipWorld.clone().sub(wristWorld).normalize();
    const side = indexWorld.clone().sub(pinkyWorld).normalize();
    const normal = new Vector3().crossVectors(forward, side).normalize();

    setQuaternionFromBasis(restBasis, side, normal, forward);
  } else if (wrist && middleMetacarpal && indexMetacarpal && pinkyMetacarpal) {
    const wristWorld = wrist.getWorldPosition(new Vector3());
    const middleMetaWorld = middleMetacarpal.getWorldPosition(new Vector3());
    const indexWorld = indexMetacarpal.getWorldPosition(new Vector3());
    const pinkyWorld = pinkyMetacarpal.getWorldPosition(new Vector3());

    const forward = middleMetaWorld.clone().sub(wristWorld).normalize();
    const side = indexWorld.clone().sub(pinkyWorld).normalize();
    const normal = new Vector3().crossVectors(forward, side).normalize();

    setQuaternionFromBasis(restBasis, side, normal, forward);
  }

  return {
    bones,
    restBasis,
    restLengths,
    restDirections,
    restRollCorrections,
    restWristPosition,
  };
}

function applyHandMaterial(
  model: Group,
  color: string,
  emissive: string,
  opacity: number,
) {
  model.traverse((node) => {
    if (!isMeshLike(node)) {
      return;
    }

    node.frustumCulled = false;
    node.castShadow = true;
    node.receiveShadow = true;
    const material = new MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.18,
      metalness: 0,
      roughness: 0.24,
      transparent: true,
      opacity: opacity * 0.22,
      side: DoubleSide,
    });
    material.depthWrite = false;
    material.alphaTest = 0.015;
    material.toneMapped = false;
    applyGhostRimShader(material, color);
    node.material = material;
  });
}

function applyGhostRimShader(material: MeshStandardMaterial, rimColor: string) {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.ghostRimColor = { value: new Color(rimColor) };
    shader.uniforms.ghostRimPower = { value: GHOST_RIM_POWER };
    shader.uniforms.ghostRimStrength = { value: GHOST_RIM_STRENGTH };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `
uniform vec3 ghostRimColor;
uniform float ghostRimPower;
uniform float ghostRimStrength;

void main() {
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `
#include <emissivemap_fragment>
float ghostRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), ghostRimPower);
totalEmissiveRadiance += ghostRimColor * ghostRim * ghostRimStrength;
diffuseColor.a = max(diffuseColor.a, ghostRim * 0.46);
        `,
      );
  };
  material.customProgramCacheKey = () => `ghost-rim-${rimColor}`;
}

function poseSkinnedHand(
  root: Group,
  model: Group,
  rig: HandRig,
  hand: TrackedHand,
  transform: SceneTransform,
) {
  const targets = createJointTargets(hand, transform);
  const wristTarget = targets.get('wrist');

  if (!wristTarget) {
    model.visible = false;
    return;
  }

  model.visible = true;
  updateLiveHandScale(model, rig, targets);
  updateRootTransform(root, model, rig, hand, wristTarget, transform);
  root.updateMatrixWorld(true);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);

  const wristAimTarget =
    getWristAimTarget(targets) ?? toSceneVector(hand.palmPosition, transform);

  poseBone(
    rig.bones.get('wrist'),
    toModelLocal(root, model, wristTarget),
    toModelLocal(root, model, wristAimTarget),
    rig.restDirections.get('wrist'),
    rig.restRollCorrections.get('wrist'),
    transform.poseControls,
    model,
  );

  for (const finger of hand.fingers) {
    const names = FINGER_JOINT_NAMES[finger.type];

    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const target = targets.get(name);

      if (!target) {
        continue;
      }

      poseBone(
        rig.bones.get(name),
        toModelLocal(root, model, target),
        toModelLocal(root, model, targets.get(names[index + 1])),
        rig.restDirections.get(name),
        rig.restRollCorrections.get(name),
        transform.poseControls,
        model,
      );
    }
  }
}

function updateLiveHandScale(
  model: Group,
  rig: HandRig,
  targets: Map<string, Vector3>,
) {
  const liveScale = estimateLiveHandScale(rig, targets);
  const previousScale =
    typeof model.userData.liveHandScale === 'number'
      ? model.userData.liveHandScale
      : liveScale;
  const nextScale = previousScale + (liveScale - previousScale) * LIVE_HAND_SCALE_LERP;

  model.userData.liveHandScale = nextScale;
  model.scale.setScalar(nextScale);
}

function updateRootTransform(
  root: Group,
  model: Group,
  rig: HandRig,
  hand: TrackedHand,
  wristTarget: Vector3,
  transform: SceneTransform,
) {
  const controls = transform.poseControls;

  if (controls.usePalmRotation && hand.direction && hand.palmNormal) {
    const liveBasis = getLivePalmBasis(hand, transform);

    if (liveBasis) {
      ROOT_QUATERNION.copy(liveBasis).multiply(rig.restBasis.clone().invert());
      root.quaternion.slerp(ROOT_QUATERNION, controls.rootRotationBlend);
    }
  } else {
    root.quaternion.identity();
  }

  if (controls.useRootPosition) {
    REST_WRIST_OFFSET.copy(rig.restWristPosition)
      .multiplyScalar(model.scale.x)
      .applyQuaternion(root.quaternion);
    root.position.copy(wristTarget).sub(REST_WRIST_OFFSET);
  } else {
    root.position.set(0, 0, 0);
  }
}

function toModelLocal(root: Group, model: Group, point: Vector3 | undefined) {
  if (!point) {
    return undefined;
  }

  return root.worldToLocal(point.clone()).divide(model.scale);
}

function getLivePalmBasis(hand: TrackedHand, transform: SceneTransform) {
  if (!hand.direction || !hand.palmNormal) {
    return undefined;
  }

  ROOT_DIRECTION.copy(toSceneDirection(hand.direction, transform)).normalize();
  ROOT_NORMAL.copy(toSceneDirection(hand.palmNormal, transform)).normalize();
  ROOT_SIDE.crossVectors(ROOT_NORMAL, ROOT_DIRECTION).normalize();

  if (
    ROOT_DIRECTION.lengthSq() < 0.000001 ||
    ROOT_NORMAL.lengthSq() < 0.000001 ||
    ROOT_SIDE.lengthSq() < 0.000001
  ) {
    return undefined;
  }

  ROOT_NORMAL.crossVectors(ROOT_DIRECTION, ROOT_SIDE).normalize();
  return setQuaternionFromBasis(ROOT_QUATERNION, ROOT_SIDE, ROOT_NORMAL, ROOT_DIRECTION);
}

function estimateLiveHandScale(rig: HandRig, targets: Map<string, Vector3>) {
  const ratios: number[] = [];

  for (const jointNames of Object.values(FINGER_JOINT_NAMES)) {
    for (let index = 0; index < jointNames.length - 1; index++) {
      const name = jointNames[index];
      const restLength = rig.restLengths.get(name);
      const start = targets.get(name);
      const end = targets.get(jointNames[index + 1]);

      if (!restLength || !start || !end) {
        continue;
      }

      const liveLength = start.distanceTo(end);

      if (liveLength > 0.0001) {
        ratios.push(liveLength / restLength);
      }
    }
  }

  if (ratios.length === 0) {
    return DEFAULT_LIVE_HAND_SCALE;
  }

  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];

  return clamp(median, MIN_LIVE_HAND_SCALE, MAX_LIVE_HAND_SCALE);
}

function createFloatingObjects(): FloatingObjectState[] {
  const random = mulberry32(0x5c3ee11);
  const shapes: FloatingShape[] = ['sphere', 'box', 'tetrahedron', 'octahedron', 'torus'];
  const colors = [
    '#b8f7ff',
    '#ffd27a',
    '#ff9ec7',
    '#a2ffba',
    '#c6a6ff',
    '#ffb38f',
  ];

  return Array.from({ length: FLOATING_OBJECT_COUNT }, (_, index) => {
    const radius = randomBetween(random, 0.085, 0.16);

    return {
      id: `floating-object-${index}`,
      shape: shapes[index % shapes.length],
      radius,
      color: colors[index % colors.length],
      position: new Vector3(
        randomBetween(random, -1.05, 1.05),
        randomBetween(random, 0.82, 2.08),
        randomBetween(random, -0.62, 0.85),
      ),
      velocity: new Vector3(
        randomBetween(random, -0.08, 0.08),
        randomBetween(random, -0.06, 0.06),
        randomBetween(random, -0.08, 0.08),
      ),
      angularVelocity: new Vector3(
        randomBetween(random, -0.8, 0.8),
        randomBetween(random, -0.8, 0.8),
        randomBetween(random, -0.8, 0.8),
      ),
    };
  });
}

function createHandColliders(hands: TrackedHand[], transform: SceneTransform) {
  const colliders: Omit<HandCollider, 'velocity'>[] = [];

  for (const hand of hands) {
    colliders.push({
      key: `${hand.id}-palm`,
      position: toSceneVector(hand.palmPosition, transform),
      radius: 0.2,
    });
    colliders.push({
      key: `${hand.id}-wrist`,
      position: toSceneVector(hand.wristPosition, transform),
      radius: 0.17,
    });

    for (const finger of hand.fingers) {
      finger.joints.forEach((joint, index) => {
        colliders.push({
          key: `${hand.id}-${finger.type}-${index}`,
          position: toSceneVector(joint, transform),
          radius: index === finger.joints.length - 1 ? 0.105 : 0.088,
        });
      });
    }
  }

  return colliders;
}

function withColliderVelocities(
  colliders: Omit<HandCollider, 'velocity'>[],
  previousColliders: Map<string, Vector3>,
  delta: number,
): HandCollider[] {
  return colliders.map((collider) => {
    const previous = previousColliders.get(collider.key);
    const velocity = previous
      ? collider.position.clone().sub(previous).divideScalar(delta)
      : new Vector3();

    return {
      ...collider,
      velocity,
    };
  });
}

function constrainFloatingObject(object: FloatingObjectState) {
  constrainAxis(object, 'x');
  constrainAxis(object, 'y');
  constrainAxis(object, 'z');
}

function constrainAxis(object: FloatingObjectState, axis: 'x' | 'y' | 'z') {
  const min = FLOATING_OBJECT_BOUNDS.min[axis] + object.radius;
  const max = FLOATING_OBJECT_BOUNDS.max[axis] - object.radius;

  if (object.position[axis] < min) {
    object.position[axis] = min;
    object.velocity[axis] = Math.abs(object.velocity[axis]) * 0.72;
  } else if (object.position[axis] > max) {
    object.position[axis] = max;
    object.velocity[axis] = -Math.abs(object.velocity[axis]) * 0.72;
  }
}

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(random: () => number, min: number, max: number) {
  return min + (max - min) * random();
}

function createJointTargets(hand: TrackedHand, transform: SceneTransform) {
  const targets = new Map<string, Vector3>();
  targets.set('wrist', toSceneVector(hand.wristPosition, transform));

  for (const finger of hand.fingers) {
    const names = FINGER_JOINT_NAMES[finger.type];
    const joints = jointsForHandModel(finger);

    for (let index = 0; index < names.length; index++) {
      const joint = joints[index];

      if (joint) {
        targets.set(names[index], toSceneVector(joint, transform));
      }
    }
  }

  return targets;
}

function getWristAimTarget(targets: Map<string, Vector3>) {
  const indexBase = targets.get('index-finger-metacarpal');
  const pinkyBase = targets.get('pinky-finger-metacarpal');

  if (!indexBase || !pinkyBase) {
    return undefined;
  }

  return indexBase.clone().add(pinkyBase).multiplyScalar(0.5);
}

function jointsForHandModel(finger: TrackedFinger) {
  if (finger.type === 'thumb' && finger.joints.length >= 5) {
    return [
      finger.joints[0],
      finger.joints[1],
      finger.joints[3],
      finger.joints[4],
    ];
  }

  return finger.joints;
}

function poseBone(
  bone: Bone | undefined,
  modelLocalPosition: Vector3 | undefined,
  nextModelLocalPosition: Vector3 | undefined,
  restDirection: Vector3 | undefined,
  restRollCorrection: Quaternion | undefined,
  controls: PoseControlsState,
  model: Group,
) {
  if (!bone || !modelLocalPosition) {
    return;
  }

  const parent = bone.parent;

  if (parent) {
    parent.updateMatrixWorld(true);
    bone.position.copy(parent.worldToLocal(model.localToWorld(modelLocalPosition.clone())));
  } else {
    bone.position.copy(modelLocalPosition);
  }

  if (parent && nextModelLocalPosition && restDirection) {
    const localStart = parent.worldToLocal(model.localToWorld(modelLocalPosition.clone()));
    const localEnd = parent.worldToLocal(model.localToWorld(nextModelLocalPosition.clone()));

    if (controls.reverseBoneDirection) {
      TARGET_DIRECTION.subVectors(localStart, localEnd);
    } else {
      TARGET_DIRECTION.subVectors(localEnd, localStart);
    }

    if (TARGET_DIRECTION.lengthSq() > 0.000001) {
      TARGET_DIRECTION.normalize();
      TARGET_QUATERNION.setFromUnitVectors(restDirection, TARGET_DIRECTION);
      if (restRollCorrection) {
        TARGET_QUATERNION.multiply(restRollCorrection);
      }
      bone.quaternion.copy(TARGET_QUATERNION);
    }
  }

  bone.updateMatrixWorld(true);
}

function toSceneVector(position: Vec3, transform: SceneTransform) {
  return new Vector3(...toScenePoint(position, transform));
}

function toSceneDirection(direction: Vec3, transform: SceneTransform) {
  return new Vector3(
    readMappedAxis(direction, transform.poseControls.sceneX),
    readMappedAxis(direction, transform.poseControls.sceneY),
    readMappedAxis(direction, transform.poseControls.sceneZ),
  );
}

function isMeshLike(node: Object3D): node is MeshLike {
  const maybeMesh = node as MeshLike;
  return maybeMesh.isMesh === true || maybeMesh.isSkinnedMesh === true;
}

function useStickyHands(hands: TrackingFrame['hands']) {
  const [stickyHands, setStickyHands] = useState(hands);
  const clearTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (hands.length > 0) {
      if (clearTimer.current) {
        window.clearTimeout(clearTimer.current);
        clearTimer.current = undefined;
      }

      setStickyHands(hands);
      return;
    }

    if (clearTimer.current) {
      return;
    }

    clearTimer.current = window.setTimeout(() => {
      setStickyHands([]);
      clearTimer.current = undefined;
    }, HAND_CLEAR_DELAY_MS);
  }, [hands]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) {
        window.clearTimeout(clearTimer.current);
      }
    };
  }, []);

  return stickyHands;
}

function SceneFrame() {
  return (
    <group>
      <mesh position={[0, -0.04, 0.15]}>
        <boxGeometry args={[0.92, 0.08, 0.28]} />
        <meshStandardMaterial color="#10192d" metalness={0.35} roughness={0.5} />
      </mesh>

      <mesh position={[0, -0.005, 0.15]}>
        <boxGeometry args={[1.02, 0.01, 0.42]} />
        <meshStandardMaterial color="#1b2f52" emissive="#0f203c" roughness={0.95} />
      </mesh>

      <Line
        color="#244a82"
        lineWidth={1}
        transparent
        opacity={0.75}
        points={[
          [-1.2, 0, 0.15],
          [1.2, 0, 0.15],
        ]}
      />

      <Line
        color="#244a82"
        lineWidth={1}
        transparent
        opacity={0.55}
        points={[
          [0, 0, -1.05],
          [0, 0, 1.35],
        ]}
      />
    </group>
  );
}

function useSceneTransform(
  hands: TrackedHand[],
  poseControls: PoseControlsState,
): SceneTransform {
  const anchorPalm = useRef<Vec3 | undefined>(undefined);

  if (hands.length === 0) {
    anchorPalm.current = undefined;
    return {
      offset: [0, 0, 0.15],
      poseControls,
    };
  }

  if (!anchorPalm.current) {
    anchorPalm.current = averagePalmPosition(hands);
  }

  const palmScene = toBaseScenePoint(anchorPalm.current, poseControls);

  return {
    offset: [-palmScene[0], 1.65 - palmScene[1], 0.2 - palmScene[2]],
    poseControls,
  };
}

function averagePalmPosition(hands: TrackedHand[]): Vec3 {
  const averagePalm = hands.reduce<Vec3>(
    (accumulator, hand) => [
      accumulator[0] + hand.palmPosition[0],
      accumulator[1] + hand.palmPosition[1],
      accumulator[2] + hand.palmPosition[2],
    ],
    [0, 0, 0],
  );
  const count = hands.length;

  return [
    averagePalm[0] / count,
    averagePalm[1] / count,
    averagePalm[2] / count,
  ];
}

function getRestRollCorrection(
  restDirection: Vector3,
  parentDirection: Vector3,
  restQuaternion: Quaternion,
) {
  const shortestRestRotation = new Quaternion().setFromUnitVectors(
    restDirection,
    parentDirection,
  );
  return shortestRestRotation.invert().multiply(restQuaternion).normalize();
}

function toBaseScenePoint(position: Vec3, controls: PoseControlsState): [number, number, number] {
  return [
    readMappedAxis(position, controls.sceneX) * MM_TO_WORLD,
    readMappedAxis(position, controls.sceneY) * MM_TO_WORLD,
    readMappedAxis(position, controls.sceneZ) * MM_TO_WORLD,
  ];
}

function toScenePoint(position: Vec3, transform: SceneTransform): [number, number, number] {
  const [x, y, z] = toBaseScenePoint(position, transform.poseControls);
  return [
    x + transform.offset[0],
    y + transform.offset[1],
    z + transform.offset[2],
  ];
}

function readMappedAxis(position: Vec3, mapping: PoseControlsState['sceneX']) {
  const axisIndex = mapping.source === 'x' ? 0 : mapping.source === 'y' ? 1 : 2;
  return position[axisIndex] * mapping.sign;
}

function setQuaternionFromBasis(
  target: Quaternion,
  side: Vector3,
  normal: Vector3,
  forward: Vector3,
) {
  ROOT_MATRIX.makeBasis(side, normal, forward);
  return target.setFromRotationMatrix(ROOT_MATRIX);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

useGLTF.preload('/models/hands/left.glb');
useGLTF.preload('/models/hands/right.glb');
