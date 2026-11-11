# AWARESPAN — Raspberry Pi Edge Node Integration & Contract Specification

**Module:** Volunteer Media Ingestion Interface  
**Authoritative Backend:** `node-core-processing` (`node-backend`)  
**Specification Version:** `1.0.0-temp`  
**Target Environment:** Raspberry Pi 5 (Edge Inference Node)  

---

## 1. Executive Summary & Existing Node Analysis

Before constructing this frontend, the existing `node-core-processing` (`node-backend`) repository was thoroughly inspected to identify existing listeners, client scripts, network ports, protocols, and authentication mechanics.

### 1.1 Verified Findings in `node-core-processing`

| Characteristic | Live Repository Implementation | File Source |
| :--- | :--- | :--- |
| **Network Port** | `8766` (Configurable via `RUNTIME_PORT` environment variable) | `shared/config/settings.py` (`runtime_port: int = 8766`) |
| **Bind Host** | `0.0.0.0` (Configurable via `RUNTIME_HOST`) | `shared/config/settings.py` (`runtime_host: str = "0.0.0.0"`) |
| **Active Listener** | `websockets.serve(core.route_connection, host, port)` | `node_runtime/main.py:256` |
| **Health Probe** | Path `ws://<host>:8766/health` &rarr; responds `{"status": "ok", "node": "<node_id>"}` and closes | `node_runtime/main.py:69-73` |
| **Frame Ingest Path** | Path `ws://<host>:8766/ingest` &rarr; reads JSON frame messages | `node_runtime/main.py:74-75, 79-94` |
| **Dashboard Path** | Path `ws://<host>:8766/` &rarr; broadcasts annotated frames and threat events | `node_runtime/main.py:76-77, 95-110` |
| **Existing Client** | Python OpenCV client capturing webcams and streaming Base64 JPEGs | `laptop/stream_client.py` |
| **Inference Engine** | Ultralytics YOLOv8n (`yolov8n_best_weapon.pt`) + Threat Assessor | `node_runtime/detection/visual/detector.py` |
| **Audio Classifier** | Passive stub (`classify_wav`) without active network streaming socket | `node_runtime/detection/audio/audio_classifier.py` |

---

## 2. Ingestion Protocol Specification (Visual Frames)

The portal adheres strictly to the existing schema parsed by `node_runtime/main.py:processor_loop`:

### Frame Payload (Client &rarr; Pi over `ws://<host>:8766/ingest`)

```json
{
  "type": "frame",
  "frame_id": 1420,
  "ts_ms": 1794424649000,
  "jpeg_b64": "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP..."
}
```

### Protocol Properties:
- **Encoding:** JPEG formatted image converted to ASCII Base64.
- **Recommended Framerate:** 10–12 FPS (to balance inference throughput with Pi thermal envelope).
- **Recommended Resolution:** 640&times;360 or 640&times;480 (matches YOLOv8 640 imgsz default).

---

## 3. Documented Missing Backend Functionality

While visual frame streaming to `/ingest` is operational, production volunteer deployment requires four backend capabilities to be implemented on the Raspberry Pi edge node:

### 3.1 Operator Authentication & Token Handshake
* **Current Limitation:** The existing `/ingest` WebSocket opens without checking credentials or tokens.
* **Required Interface:** An authentication endpoint allowing the operator to verify their 6-digit TOTP code and receive a short-lived single-use volunteer token:
  ```http
  POST /api/v1/auth/volunteer-session HTTP/1.1
  Host: 192.168.1.50:8766
  Content-Type: application/json

  {
    "operator_id": "operator-alpha",
    "totp_code": "582194",
    "client_type": "volunteer_portal"
  }
  ```
  **Response (200 OK):**
  ```json
  {
    "status": "authorized",
    "session_token": "vol-session-4f8a9e2b10",
    "expires_at": 1794425549000
  }
  ```

### 3.2 Bidirectional Source Acknowledgement (ACK)
* **Current Limitation:** In `node_runtime/main.py`, `/ingest` consumes frames into `frame_queue` without sending an acknowledgement message back down the socket.
* **Required Interface:** The node must confirm receipt and status of each source back to the client:
  ```json
  { "type": "ack", "source": "camera", "status": "active" }
  { "type": "ack", "source": "microphone", "status": "active" }
  { "type": "heartbeat", "ts_ms": 1794424650000 }
  ```

### 3.3 Audio Stream Ingestion Interface
* **Current Limitation:** `node_runtime/detection/audio/audio_classifier.py` is in passive file mode. No WebSocket route exists for audio.
* **Required Interface:** Accept audio chunks over `/ingest` or `/ingest/audio`:
  ```json
  {
    "type": "audio_chunk",
    "chunk_id": 1,
    "format": "pcm_16000_16bit_mono",
    "audio_b64": "<base64 encoded audio bytes>"
  }
  ```

### 3.4 Raspberry Pi &rarr; Telegram Connect/Disconnect Notifications
* **Constraint:** Per architectural requirements, the frontend **never** sends Telegram messages directly and contains no bot tokens. All notifications originate strictly on the Pi.
* **Node Implementation Patch:**
  Add to `node_runtime/main.py`:
  ```python
  from node_runtime.monitoring.telegram_notify import send_message

  async def _ingest_handler(self, websocket):
      node_id = self.settings.node_id
      log.info("Frame ingestion client connected")
      send_message(f"📡 <b>AWARESPAN Source Connected</b>\nNode: <code>{node_id}</code>\nSource: <b>Volunteer Device</b>")
      try:
          async for message in websocket:
              data = json.loads(message)
              if data.get("type") == "frame":
                  self._enqueue_frame(data)
      except Exception as exc:
          log.debug("Ingestion connection ended: %s", exc)
      finally:
          log.info("Frame ingestion client disconnected")
          send_message(f"⚠️ <b>AWARESPAN Source Disconnected</b>\nNode: <code>{node_id}</code>\nSource: <b>Volunteer Device</b>")
  ```

---

## 4. Temporary Utility Retirement Path

When dedicated hardware sensors (RPi Camera Module 3 NoIR & ReSpeaker 2-Mic HAT) are physically deployed:
1. The volunteer portal process is retired without modifying `node_runtime/main.py`.
2. Hardware drivers in `node_runtime/detection/sensors/hardware.py` will feed `frame_queue` directly from the CSI bus and I2S bus.
3. No cloud API or intermediary server decommissioning is required, as none was introduced.
