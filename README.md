# Via

Reach into your 3d scenes via head and hand tracking.

## How tracking reaches the browser

Ultraleap Hyperion exposes tracking through the native `LeapC` SDK, not directly through browser APIs. This repo keeps the browser app simple by running a local bridge:

1. `native/leap-bridge` links against the installed Ultraleap `LeapC` SDK and polls the Hyperion tracking service.
2. `scripts/leap-ws-bridge.mjs` starts that native helper and exposes its newline JSON frames over `ws://127.0.0.1:6437/v6.json`.
3. `src/lib/tracking.ts` consumes that WebSocket using the same frame shape as the legacy Leap web socket.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the Ultraleap Hand Tracking app/service and connect the controller.

3. In one terminal, start the LeapC bridge:

   ```bash
   npm run tracking:bridge
   ```

   The first run builds the native helper with CMake. It expects the SDK at `/Applications/Ultraleap Hand Tracking.app/Contents/LeapSDK`.

4. In another terminal, start the dev server:

   ```bash
   npm run dev
   ```

5. Open the Vite URL and keep the bridge terminal running.

## Configuration

The frontend defaults to `ws://127.0.0.1:6437/v6.json`. Override it with `VITE_TRACKING_WS_URL`.

The bridge defaults to port `6437` and desktop tracking mode. Override those with:

```bash
TRACKING_WS_PORT=8765 TRACKING_MODE=screentop npm run tracking:bridge
```

## Hand Mesh Assets

The visualizer uses vendored left/right skinned GLB hands from the WebXR Input Profiles `generic-hand` profile. The source and license notes are in `public/models/hands`.
