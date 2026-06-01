import sqlite3
import math
import os
import json
import re
from datetime import datetime

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "eco_routing.db")

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def parse_maxspeed(maxspeed_val):
    """
    Safely parses OSM maxspeed attribute which can be a string, list, or empty.
    Returns speed in km/h. Default fallback is 30 km/h.
    """
    if not maxspeed_val:
        return 30.0
    if isinstance(maxspeed_val, list):
        maxspeed_val = maxspeed_val[0]
    
    # Extract digits from string (e.g. "30 mph" or "30 km/h" or "30")
    match = re.search(r'\d+', str(maxspeed_val))
    if match:
        return float(match.group())
    return 30.0

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Drop existing tables if we are upgrading from the mock grid model
    # To trigger a clean download of Bengaluru RR Nagar with intersection names
    # cursor.execute("DROP TABLE IF EXISTS edges")
    # cursor.execute("DROP TABLE IF EXISTS nodes")

    # Re-create Nodes Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        name TEXT,
        aqi_pm25 REAL DEFAULT 15.0,
        aqi_voc REAL DEFAULT 5.0,
        timestamp TEXT
    )
    """)

    # Re-create Edges Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS edges (
        edge_id TEXT PRIMARY KEY,
        node_u TEXT NOT NULL,
        node_v TEXT NOT NULL,
        distance REAL NOT NULL,
        speed_kph REAL NOT NULL,
        travel_time_sec REAL NOT NULL,
        geometry_json TEXT NOT NULL,
        pheromone_points REAL DEFAULT 0.1,
        last_traversed TEXT,
        FOREIGN KEY(node_u) REFERENCES nodes(node_id),
        FOREIGN KEY(node_v) REFERENCES nodes(node_id)
    )
    """)

    conn.commit()

    # Ingest Rajarajeshwari Nagar using OSMnx if empty
    cursor.execute("SELECT COUNT(*) FROM nodes")
    if cursor.fetchone()[0] == 0:
        print("Downloading Rajarajeshwari Nagar, Bengaluru drivable road network via OSMnx...")
        
        try:
            import osmnx as ox
            import networkx as nx
            
            # Download street network of Rajarajeshwari Nagar, Bengaluru using a coordinate point
            center_point = (12.9220, 77.5180)
            G = ox.graph_from_point(center_point, dist=1500, network_type="drive")
            
            print(f"Downloaded network. Nodes: {len(G.nodes)}, Edges: {len(G.edges)}")
            
            # Nodes insertion
            nodes_data = []
            now_iso = datetime.utcnow().isoformat()
            for node_id, data in G.nodes(data=True):
                lat = data['y']
                lon = data['x']
                
                # Fetch connected street names
                names = set()
                # Outgoing streets
                if node_id in G:
                    for u, v, k, d in G.out_edges(node_id, keys=True, data=True):
                        if 'name' in d and d['name']:
                            if isinstance(d['name'], list):
                                names.update([str(n) for n in d['name'] if n])
                            else:
                                names.add(str(d['name']))
                    # Incoming streets
                    for u, v, k, d in G.in_edges(node_id, keys=True, data=True):
                        if 'name' in d and d['name']:
                            if isinstance(d['name'], list):
                                names.update([str(n) for n in d['name'] if n])
                            else:
                                names.add(str(d['name']))
                
                unique_names = sorted(list(names))
                if unique_names:
                    node_name = " & ".join(unique_names)
                else:
                    node_name = f"Residential Link near {lat:.4f}, {lon:.4f}"
                
                nodes_data.append((str(node_id), lat, lon, node_name, 15.0, 5.0, now_iso))
            
            cursor.executemany("""
            INSERT INTO nodes (node_id, latitude, longitude, name, aqi_pm25, aqi_voc, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, nodes_data)
            
            # Edges insertion
            edges_data = []
            for u, v, key, data in G.edges(keys=True, data=True):
                edge_id = f"{u}_to_{v}_{key}"
                distance = data.get('length', 10.0) # distance in meters
                
                # Parse speed and calculate travel time
                speed_kph = parse_maxspeed(data.get('maxspeed', None))
                speed_mps = speed_kph / 3.6
                travel_time_sec = distance / speed_mps
                
                # Parse geometry (LineString coords)
                u_data = G.nodes[u]
                v_data = G.nodes[v]
                
                if 'geometry' in data:
                    # Shapely LineString uses (lon, lat) under the hood. Swap to (lat, lon) for Leaflet.
                    coords = list(data['geometry'].coords)
                    geom = [[lat, lon] for lon, lat in coords]
                else:
                    # Straight line between u and v
                    geom = [[u_data['y'], u_data['x']], [v_data['y'], v_data['x']]]
                
                geometry_json = json.dumps(geom)
                
                edges_data.append((
                    edge_id, str(u), str(v), distance, speed_kph, travel_time_sec, geometry_json, 0.1
                ))
            
            cursor.executemany("""
            INSERT INTO edges (edge_id, node_u, node_v, distance, speed_kph, travel_time_sec, geometry_json, pheromone_points)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, edges_data)
            
            conn.commit()
            print(f"Database successfully populated with {len(nodes_data)} real nodes and {len(edges_data)} real edges.")
            
        except Exception as e:
            print(f"Error seeding real-world Bengaluru graph: {e}")
            conn.rollback()
            raise e

    conn.close()

def upsert_node_telemetry(node_id, aqi_pm25, aqi_voc, timestamp):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE nodes 
    SET aqi_pm25 = ?, aqi_voc = ?, timestamp = ?
    WHERE node_id = ?
    """, (aqi_pm25, aqi_voc, timestamp, node_id))
    conn.commit()
    conn.close()

def get_nodes():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM nodes")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_edges():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM edges")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def deposit_pheromones(edge_ids, amount):
    if not edge_ids:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" for _ in edge_ids)
    now = datetime.utcnow().isoformat()
    cursor.execute(f"""
    UPDATE edges
    SET pheromone_points = pheromone_points + ?, last_traversed = ?
    WHERE edge_id IN ({placeholders})
    """, (amount, now, *edge_ids))
    conn.commit()
    conn.close()

def evaporate_pheromones(decay_rate=0.1, min_pheromone=0.1):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE edges
    SET pheromone_points = MAX(pheromone_points * (1.0 - ?), ?)
    """, (decay_rate, min_pheromone))
    conn.commit()
    conn.close()
