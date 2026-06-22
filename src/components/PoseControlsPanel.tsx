import {
  DEFAULT_POSE_CONTROLS,
  type AxisMapping,
  type PoseControlsState,
  type SourceAxis,
} from '../lib/poseControls';

interface PoseControlsPanelProps {
  controls: PoseControlsState;
  onChange: (next: PoseControlsState) => void;
}

const AXES: SourceAxis[] = ['x', 'y', 'z'];

export function PoseControlsPanel({ controls, onChange }: PoseControlsPanelProps) {
  const updateAxis = (
    key: 'sceneX' | 'sceneY' | 'sceneZ',
    next: Partial<AxisMapping>,
  ) => {
    onChange({
      ...controls,
      [key]: {
        ...controls[key],
        ...next,
      },
    });
  };

  return (
    <aside className="pose-controls-panel">
      <div className="panel-title-row">
        <strong>Pose Controls</strong>
        <button
          type="button"
          className="mini-button"
          onClick={() => onChange(DEFAULT_POSE_CONTROLS)}
        >
          Reset
        </button>
      </div>

      <AxisControl
        label="Scene X"
        mapping={controls.sceneX}
        onChange={(next) => updateAxis('sceneX', next)}
      />
      <AxisControl
        label="Scene Y"
        mapping={controls.sceneY}
        onChange={(next) => updateAxis('sceneY', next)}
      />
      <AxisControl
        label="Scene Z"
        mapping={controls.sceneZ}
        onChange={(next) => updateAxis('sceneZ', next)}
      />

      <label className="toggle-control">
        <input
          type="checkbox"
          checked={controls.useRootPosition}
          onChange={(event) =>
            onChange({
              ...controls,
              useRootPosition: event.currentTarget.checked,
            })
          }
        />
        Use wrist root position
      </label>

      <label className="toggle-control">
        <input
          type="checkbox"
          checked={controls.usePalmRotation}
          onChange={(event) =>
            onChange({
              ...controls,
              usePalmRotation: event.currentTarget.checked,
            })
          }
        />
        Use palm root rotation
      </label>

      <label className="range-control">
        <span>
          Root rotation
          <output>{controls.rootRotationBlend.toFixed(2)}</output>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={controls.rootRotationBlend}
          disabled={!controls.usePalmRotation}
          onChange={(event) =>
            onChange({
              ...controls,
              rootRotationBlend: Number(event.currentTarget.value),
            })
          }
        />
      </label>

      <label className="toggle-control">
        <input
          type="checkbox"
          checked={controls.reverseBoneDirection}
          onChange={(event) =>
            onChange({
              ...controls,
              reverseBoneDirection: event.currentTarget.checked,
            })
          }
        />
        Reverse bone direction
      </label>
    </aside>
  );
}

function AxisControl({
  label,
  mapping,
  onChange,
}: {
  label: string;
  mapping: AxisMapping;
  onChange: (next: Partial<AxisMapping>) => void;
}) {
  return (
    <div className="axis-control">
      <span>{label}</span>
      <div className="axis-source-picker" role="group" aria-label={`${label} source`}>
        {AXES.map((axis) => (
          <button
            key={axis}
            type="button"
            className={`axis-button ${mapping.source === axis ? 'is-active' : ''}`}
            onClick={() => onChange({ source: axis })}
          >
            {axis.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`sign-button ${mapping.sign < 0 ? 'is-negative' : ''}`}
        onClick={() => onChange({ sign: mapping.sign > 0 ? -1 : 1 })}
      >
        {mapping.sign > 0 ? '+' : '-'}
      </button>
    </div>
  );
}
