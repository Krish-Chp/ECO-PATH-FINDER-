import time
import random
import requests
import math
from datetime import datetime
from .db import get_nodes

API_URL = "http://127.0.0.1:8000/api/telemetry"

# Spatial hotspots for Rajarajeshwari Nagar, Bengaluru
# 1. Busy highway corridor / entry arch (around Mysore Road intersection: lat ~12.940, lon ~77.535)
HOTSPOT_MYSORE_RD = (12.9400, 77.5350)
# 2. Commercial center / market area (around double road: lat ~12.922, lon ~77.518)
HOTSPOT_MARKET = (12.9220, 77.5180)
# 3. Clean park / residential zone (around temple park: lat ~12.908, lon ~77.512)
CLEAN_PARK = (12.9080, 77.5120)

def haversine_dist(coord1, coord2):
    # Quick distance approximation in kilometers
    lat1, lon1 = coord1
    lat2, lon2 = coord2
    R = 6371.0
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_phi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def generate_telemetry_for_node(node):
    lat = node["latitude"]
    lon = node["longitude"]
    node_coords = (lat, lon)
    
    # 1. Pollution from Mysore Road highway
    dist_mysore = haversine_dist(node_coords, HOTSPOT_MYSORE_RD)
    mysore_pm25 = max(0.0, 140.0 * math.exp(-dist_mysore / 0.8)) # Decays over distance
    mysore_voc = max(0.0, 50.0 * math.exp(-dist_mysore / 0.8))
    
    # 2. Pollution from Market double road
    dist_market = haversine_dist(node_coords, HOTSPOT_MARKET)
    market_pm25 = max(0.0, 95.0 * math.exp(-dist_market / 0.5))
    market_voc = max(0.0, 35.0 * math.exp(-dist_market / 0.5))
    
    # 3. Clean park air baseline
    dist_park = haversine_dist(node_coords, CLEAN_PARK)
    park_effect = max(0.0, 45.0 * math.exp(-dist_park / 0.6))
    
    # Baselines
    base_pm25 = 18.0
    base_voc = 6.0
    
    # Time fluctuation (rush hours)
    hour = datetime.now().hour
    # Double-peak cosine function for traffic cycles (peak at 9am and 7pm)
    t1 = 2 * math.pi * (hour - 9) / 24
    t2 = 2 * math.pi * (hour - 19) / 24
    diurnal_multiplier = 0.75 + 0.5 * (0.5 * (math.cos(t1) + math.cos(t2)))
    
    noise_pm25 = random.uniform(-6.0, 6.0)
    noise_voc = random.uniform(-2.0, 2.0)
    
    pm25 = max(5.0, (base_pm25 + mysore_pm25 + market_pm25 - park_effect) * diurnal_multiplier + noise_pm25)
    voc = max(1.0, (base_voc + mysore_voc + market_voc - (park_effect * 0.4)) * diurnal_multiplier + noise_voc)
    
    return {
        "node_id": node["node_id"],
        "latitude": lat,
        "longitude": lon,
        "air_quality_index": {
            "pm2_5": round(pm25, 2),
            "vocs": round(voc, 2)
        },
        "timestamp": datetime.utcnow().isoformat()
    }

def run_simulation(interval_sec=2.0):
    print("Starting Bengaluru RR Nagar Telemetry Simulation...")
    
    # Fetch all nodes currently in database (real nodes downloaded via OSMnx)
    nodes = []
    while not nodes:
        nodes = get_nodes()
        if not nodes:
            print("Database has no nodes! Waiting for DB to seed...")
            time.sleep(3.0)
        
    print(f"Simulator mapping live telemetry onto {len(nodes)} real-world nodes.")
    
    while True:
        # Update 15 nodes at a time
        reporting_nodes = random.sample(nodes, min(len(nodes), 15))
        
        for node in reporting_nodes:
            payload = generate_telemetry_for_node(node)
            try:
                r = requests.post(API_URL, json=payload, timeout=2.0)
                if r.status_code != 200:
                    print(f"Failed to post telemetry: Status {r.status_code}")
            except requests.exceptions.RequestException:
                # API not ready, pause
                time.sleep(3.0)
                break
                
        time.sleep(interval_sec)

if __name__ == "__main__":
    time.sleep(1)
    run_simulation()
