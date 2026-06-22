import { HandsScene } from './components/HandsScene';
import { StatusPanel } from './components/StatusPanel';
import { DEFAULT_POSE_CONTROLS } from './lib/poseControls';
import { useLeapTrackingStatus } from './lib/tracking';

export default function App() {
  const tracking = useLeapTrackingStatus();
  const isWaitingForDevice =
    tracking.phase !== 'streaming' ||
    tracking.device?.attached === false ||
    tracking.device?.streaming === false;

  return (
    <main className="app-shell">
      <section className="scene-shell">
        {isWaitingForDevice ? (
          <p className="scene-waiting-label">waiting for device...</p>
        ) : null}
        <HandsScene poseControls={DEFAULT_POSE_CONTROLS} />
        <StatusPanel />
      </section>
    </main>
  );
}
