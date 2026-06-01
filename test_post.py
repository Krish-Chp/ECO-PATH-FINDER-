import requests
from datetime import datetime

payload = {
    "node_id": "248677965",
    "latitude": 12.9220,
    "longitude": 77.5180,
    "air_quality_index": {
        "pm2_5": 22.5,
        "vocs": 7.2
    },
    "timestamp": datetime.utcnow().isoformat()
}

try:
    print("Sending POST request to http://127.0.0.1:8000/api/telemetry ...")
    r = requests.post("http://127.0.0.1:8000/api/telemetry", json=payload, timeout=5.0)
    print("Status code:", r.status_code)
    print("Response JSON:", r.json())
except Exception as e:
    print("Error connecting:", e)
