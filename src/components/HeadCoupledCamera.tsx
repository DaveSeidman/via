import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import type {
  FaceLandmarker as FaceLandmarkerImpl,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const FACE_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const BASE_CAMERA_POSITION = new Vector3(0, 1.55, 2.05);
const CAMERA_TARGET = new Vector3(0, 1.35, 0.15);
const HEAD_OFFSET_SCALE = new Vector3(1.1, 0.72, 5.2);
const HEAD_OFFSET_LIMIT = new Vector3(0.62, 0.42, 0.38);
const CAMERA_LERP = 0.18;

export function HeadCoupledCamera() {
  const camera = useThree((state) => state.camera);
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const landmarkerRef = useRef<FaceLandmarkerImpl | undefined>(undefined);
  const baselineEyeDistance = useRef<number | undefined>(undefined);
  const desiredPosition = useMemo(() => new Vector3(), []);
  const smoothedPosition = useMemo(
    () => BASE_CAMERA_POSITION.clone(),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function startHeadTracking() {
      if (!navigator.mediaDevices?.getUserMedia) {
        return;
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      videoRef.current = video;

      try {
        const [{ FilesetResolver, FaceLandmarker }, stream] = await Promise.all([
          import('@mediapipe/tasks-vision'),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
          }),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        const vision = await FilesetResolver.forVisionTasks(FACE_WASM_BASE);
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
      } catch (error) {
        console.warn('Head-coupled camera unavailable.', error);
      }
    }

    void startHeadTracking();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = undefined;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = undefined;
      videoRef.current = undefined;
    };
  }, []);

  useFrame(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.fov = 35;
      camera.updateProjectionMatrix();
    }

    const headOffset = readHeadOffset(
      landmarkerRef.current,
      videoRef.current,
      baselineEyeDistance,
    );

    desiredPosition.copy(BASE_CAMERA_POSITION);

    if (headOffset) {
      desiredPosition.x += headOffset.x;
      desiredPosition.y += headOffset.y;
      desiredPosition.z += headOffset.z;
    }

    smoothedPosition.lerp(desiredPosition, CAMERA_LERP);
    camera.position.copy(smoothedPosition);
    camera.lookAt(CAMERA_TARGET);
  });

  return null;
}

function readHeadOffset(
  landmarker: FaceLandmarkerImpl | undefined,
  video: HTMLVideoElement | undefined,
  baselineEyeDistance: MutableRefObject<number | undefined>,
) {
  if (!landmarker || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return undefined;
  }

  const result = landmarker.detectForVideo(video, performance.now());
  const face = result.faceLandmarks[0];

  if (!face) {
    return undefined;
  }

  const leftEye = face[33];
  const rightEye = face[263];

  if (!leftEye || !rightEye) {
    return undefined;
  }

  const eyeCenter = midpoint(leftEye, rightEye);
  const eyeDistance = distance2(leftEye, rightEye);

  if (!baselineEyeDistance.current) {
    baselineEyeDistance.current = eyeDistance;
  }

  const offset = new Vector3(
    clamp((0.5 - eyeCenter.x) * HEAD_OFFSET_SCALE.x, -HEAD_OFFSET_LIMIT.x, HEAD_OFFSET_LIMIT.x),
    clamp((0.5 - eyeCenter.y) * HEAD_OFFSET_SCALE.y, -HEAD_OFFSET_LIMIT.y, HEAD_OFFSET_LIMIT.y),
    clamp(
      ((baselineEyeDistance.current ?? eyeDistance) - eyeDistance) * HEAD_OFFSET_SCALE.z,
      -HEAD_OFFSET_LIMIT.z,
      HEAD_OFFSET_LIMIT.z,
    ),
  );

  return offset;
}

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function distance2(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
