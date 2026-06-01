import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .db import (
    init_db,
    upsert_node_telemetry,
    get_nodes,
    get_edges,
    deposit_pheromones,
    evaporate_pheromones
)
from .routing import find_optimal_route

app = FastAPI(title="EcoPath Bengaluru Routing API")

@app.on_event("startup")
def startup_event():
    # Downloader and database initializer
    init_db()

# Models
class AirQualityIndex(BaseModel):
    pm2_5: float
    vocs: float

class TelemetryPayload(BaseModel):
    node_id: str
    latitude: float
    longitude: float
    air_quality_index: AirQualityIndex
    timestamp: str

class RouteRequest(BaseModel):
    start_node: str
    dest_node: str
    alpha: float = 1.0  # Travel Time weight
    beta: float = 1.0   # AQI Penalty weight
    gamma: float = 0.5  # Pheromone Points weight

class EvaporateRequest(BaseModel):
    decay_rate: float = 0.1

@app.post("/api/telemetry")
def receive_telemetry(payload: TelemetryPayload):
    try:
        upsert_node_telemetry(
            node_id=payload.node_id,
            aqi_pm25=payload.air_quality_index.pm2_5,
            aqi_voc=payload.air_quality_index.vocs,
            timestamp=payload.timestamp
        )
        return {"status": "success", "message": f"Telemetry updated for {payload.node_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/nodes")
def read_nodes():
    try:
        return get_nodes()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/edges")
def read_edges():
    try:
        return get_edges()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/route")
def compute_route(req: RouteRequest):
    try:
        result = find_optimal_route(
            req.start_node, 
            req.dest_node, 
            alpha=req.alpha, 
            beta=req.beta, 
            gamma=req.gamma
        )
        
        if result is None:
            raise HTTPException(status_code=404, detail="Route not found between specified nodes in RR Nagar.")

        # Swarm learning: deposit pheromones on the chosen edges
        avg_aqi = result["average_aqi"]
        # Clean paths (AQI <= 15) get ~3.3 points. Polluted paths (AQI >= 80) get ~0.6 points.
        deposit_amount = max(0.1, 50.0 / max(5.0, avg_aqi))
        
        edge_ids = [edge["edge_id"] for edge in result["edge_details"]]
        deposit_pheromones(edge_ids, deposit_amount)
        
        result["pheromone_deposited"] = round(deposit_amount, 3)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/evaporate")
def evaporate(req: EvaporateRequest):
    try:
        evaporate_pheromones(decay_rate=req.decay_rate)
        return {"status": "success", "message": f"Pheromones decayed by {req.decay_rate}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Serves static assets
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Frontend assets not found."}
