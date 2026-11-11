# AWARESPAN — Temporary Volunteer Camera & Microphone Portal

> *A modular, lightweight, and temporary web application allowing authorized operator devices to volunteer their cameras, microphones, or both as auxiliary input sources for an AWARESPAN Raspberry Pi edge node.*

---

## 1. Architectural Philosophy

* **Sole Backend:** The Raspberry Pi edge node running `node-core-processing` (`node-backend`) is the authoritative backend. No intermediary cloud servers, databases, or API gateways are introduced.
* **Separation of Concerns:** The frontend performs **zero AI threat detection**. Frames are encoded and transmitted directly to the Pi's WebSocket ingestion endpoint (`/ingest`), where YOLOv8 inference and threat assessment execute.
* **Strict Security:** No persistent passwords, TOTP secrets, or Telegram bot tokens exist in the frontend code or browser `localStorage`. Credentials are held as ephemeral in-memory sessions with automatic expiration.
* **Temporary Nature:** The interface is engineered as an isolated, standalone client that can be retired cleanly when dedicated camera/mic hardware is connected to the Pi.

---

## 2. Design Compliance

The application strictly implements the design system documented in the primary website specification (`landing-page/docs/DESIGN.md`):

* **Color Palette:**
  * **Ember Orange (`#ff4f2b`):** CTAs, active toggles, focal alerts.
  * **Void Black (`#000000`):** Core background canvas and media viewport.
  * **Carbon (`#1a1a1a`):** Modular panels and input backgrounds.
  * **Graphite (`#3c3c3c`):** 1px structural hairlines and dividers.
  * **Steel Mid (`#737373`):** Metadata, secondary readouts, timestamps.
  * **Bone White (`#f5f5f5`):** Primary headings, labels, and text.
* **Geometry:** **`0px` border-radius** on all buttons, inputs, badges, and cards.
* **Typography:** `Chivo Mono` & `JetBrains Mono` for a terminal/control-room aesthetic.

---

## 3. Verified Raspberry Pi Node Interfaces

Inspection of `node-backend` (`origin https://github.com/awarespan/node-core-processing.git`) identified:

* **Port:** `8766` (Configurable via `RUNTIME_PORT`).
* **Health Probe:** `ws://<pi_host>:8766/health` &rarr; responds with node ID and closes.
* **Visual Frame Ingest:** `ws://<pi_host>:8766/ingest` &rarr; accepts JSON packets matching `{ type: "frame", frame_id, ts_ms, jpeg_b64 }`.
* **Dashboard Stream:** `ws://<pi_host>:8766/` &rarr; broadcasts annotated frames and threat evaluation logs.

*See [`BACKEND_CONTRACT.md`](./BACKEND_CONTRACT.md) for the complete integration contract, missing capabilities, and Telegram notification patch.*

---

## 4. Getting Started & Development

### Prerequisites
* Node.js v20+ or v22+
* npm v10+

### Installation
```bash
cd temp_frontend
npm install
```

### Environment Configuration
Copy the template configuration:
```bash
cp .env.example .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `VITE_PI_HOST` | `192.168.1.50` | Hostname or IP of Raspberry Pi edge node |
| `VITE_PI_PORT` | `8766` | Node runtime WebSocket port |
| `VITE_PI_USE_SSL` | `false` | Set `true` for WSS / HTTPS |
| `VITE_PI_NODE_ID` | `sip-pi-001` | Edge node identifier |
| `VITE_MOCK_MODE` | `true` in dev | High-fidelity hardware simulation mode |

### Running the Development Server
```bash
npm run dev
```
Open `http://localhost:3000` in any modern browser.

### Running Test Suite
Execute the 17 mandatory lifecycle tests and UI component tests:
```bash
npm run test
```

### Production Build
```bash
npm run build
```
Build output is generated into the `dist/` directory.

---

## 5. 17 Mandatory Verification Scenarios

The portal's Vitest test suite (`tests/all-17-requirements.test.ts`) verifies:

1. **Successful Authentication:** Validates operator TOTP and issues short-lived session token.
2. **Failed Authentication:** Rejects invalid format or bad TOTP code without session issue.
3. **Camera Permission Granted:** Initializes local stream and starts canvas capture loop.
4. **Camera Permission Denied:** Detects `NotAllowedError` and enters `PERMISSION_DENIED`.
5. **Microphone Permission Granted:** Initializes Web Audio API analyzer and RMS/peak VU meter.
6. **Microphone Permission Denied:** Surfaces browser denial without halting other components.
7. **Camera-Only Volunteering:** Transmits video frames and receives camera source ACK.
8. **Microphone-Only Volunteering:** Channels audio activity and receives microphone source ACK.
9. **Combined Volunteering:** Requires both permissions and awaits independent ACKs.
10. **Pi Rejects Connection:** Correctly captures rejection message (e.g. node capacity exceeded).
11. **Pi Becomes Unreachable:** Detects connection failure and alerts operator.
12. **Browser Tab Closes:** Immediately ends all hardware streams and closes sockets.
13. **User Manually Stops:** Explicit halt releases camera/mic hardware LEDs and sends stop packet.
14. **Network Changes:** Detects `offline` network transition and pauses transmission.
15. **Auto-Reconnection:** Executes exponential backoff to recover from temporary glitches.
16. **Session Expiration:** Detects expired session token and halts active volunteer media capture.
17. **Hardware Stream Release:** Confirms all media tracks are ended so camera/mic LEDs turn off.
