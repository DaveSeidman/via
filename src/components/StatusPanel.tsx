import { setTrackingMode } from '../lib/tracking';
import { useLeapTrackingStatus } from '../lib/tracking';
import { type TrackingMode } from '../lib/types';

export function StatusPanel() {
  const tracking = useLeapTrackingStatus();
  const handsCount = tracking.handsCount ?? 0;
  const statusLabel = tracking.phase.toUpperCase();
  const lastMessage = tracking.lastMessageAt
    ? new Date(tracking.lastMessageAt).toLocaleTimeString()
    : 'none';
  const hasDeviceMetadata = Boolean(tracking.device);
  const deviceLabel = tracking.device?.type
    ? tracking.device.type
    : tracking.phase === 'connected' || tracking.phase === 'streaming'
      ? 'metadata unavailable'
      : 'waiting';
  const streamingLabel =
    typeof tracking.device?.streaming === 'boolean'
      ? tracking.device.streaming
        ? 'yes'
        : 'no'
      : tracking.phase === 'streaming'
        ? 'frames arriving'
        : 'n/a';
  const hasFramesWithoutHands =
    tracking.phase === 'streaming' && (tracking.fps ?? 0) > 0 && handsCount === 0;

  return (
    <details className="status-panel">
      <summary className="status-row">
        <span className={`status-dot phase-${tracking.phase}`} />
        <strong>{statusLabel}</strong>
        <span className="status-summary-stat">{handsCount} hands</span>
      </summary>

      <div className="status-panel-body">
        <dl className="stats-grid">
          <div>
            <dt>Endpoint</dt>
            <dd>{tracking.url}</dd>
          </div>
          <div>
            <dt>Hands</dt>
            <dd>{handsCount}</dd>
          </div>
          <div>
            <dt>FPS</dt>
            <dd>{Math.round(tracking.fps ?? 0)}</dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>{tracking.protocolVersion ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>{tracking.serviceVersion ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Last Frame</dt>
            <dd>{lastMessage}</dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd>{deviceLabel}</dd>
          </div>
          <div>
            <dt>Streaming</dt>
            <dd>{streamingLabel}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{tracking.trackingMode}</dd>
          </div>
        </dl>

        <div className="mode-picker" role="group" aria-label="Tracking mode">
          <ModeButton current={tracking.trackingMode} mode="desktop" />
          <ModeButton current={tracking.trackingMode} mode="screentop" />
          <ModeButton current={tracking.trackingMode} mode="hmd" />
        </div>

        {tracking.error ? <p className="status-warning">{tracking.error}</p> : null}

        {!hasDeviceMetadata &&
        (tracking.phase === 'connected' || tracking.phase === 'streaming') ? (
          <p className="status-note">
            Device metadata can stay unavailable until the Ultraleap service emits
            a device event, even while frames are streaming.
          </p>
        ) : null}

        {hasFramesWithoutHands ? (
          <p className="status-note">
            Frames are arriving, but no hands are currently classified. If your
            controller is mounted on a display, switch the mode to <code>screentop</code>.
          </p>
        ) : null}

        <p className="status-note">
          This app is talking to the LeapC bridge on <code>6437</code>, which
          proxies native Hyperion frames into the browser.
        </p>
      </div>
    </details>
  );
}

function ModeButton({
  current,
  mode,
}: {
  current: TrackingMode;
  mode: TrackingMode;
}) {
  return (
    <button
      type="button"
      className={`mode-button ${current === mode ? 'is-active' : ''}`}
      onClick={() => setTrackingMode(mode)}
    >
      {mode}
    </button>
  );
}
