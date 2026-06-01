import heapq
import json
from .db import get_nodes, get_edges

def build_graph():
    # Fetch nodes and edges from SQLite
    nodes_list = get_nodes()
    edges_list = get_edges()

    nodes_dict = {n["node_id"]: n for n in nodes_list}
    
    # Adjacency list: node_id -> list of edges
    graph = {n_id: [] for n_id in nodes_dict}

    for edge in edges_list:
        u = edge["node_u"]
        v = edge["node_v"]
        if u in graph and v in graph:
            graph[u].append(edge)

    return nodes_dict, graph

def calculate_edge_cost(edge, nodes_dict, alpha=1.0, beta=1.0, gamma=0.5):
    """
    Computes the multi-objective routing cost for an edge.
    
    Formula:
      Cost = alpha * TravelTime(min) + beta * AQI_Penalty - gamma * Pheromones
      
      where:
        TravelTime(min) = travel_time_sec / 60.0
        AQI_Penalty = Avg_AQI * TravelTime(min) (pollution exposure over time)
        Pheromones = pheromone_points
        
      Safety:
        We enforce Cost >= 0.001 to prevent negative cycles in Dijkstra.
    """
    time_min = edge["travel_time_sec"] / 60.0
    u = edge["node_u"]
    v = edge["node_v"]
    
    # Average AQI PM2.5 for the edge
    aqi_u = nodes_dict[u]["aqi_pm25"]
    aqi_v = nodes_dict[v]["aqi_pm25"]
    avg_aqi = (aqi_u + aqi_v) / 2.0
    
    # Pollution exposure penalty (exposure is concentration * duration)
    aqi_penalty = avg_aqi * time_min
    
    # Pheromone reinforcement
    pheromones = edge["pheromone_points"]
    
    # Combined Multi-Objective Cost
    cost = (alpha * time_min) + (beta * aqi_penalty) - (gamma * pheromones)
    
    # Enforce positive weight clipping
    cost = max(0.001, cost)
    
    return cost, time_min, avg_aqi

def find_optimal_route(start_node, dest_node, alpha=1.0, beta=1.0, gamma=0.5):
    nodes_dict, graph = build_graph()
    
    if start_node not in nodes_dict or dest_node not in nodes_dict:
        return None

    # Priority queue: (cumulative_cost, current_node, path_edges)
    queue = [(0.0, start_node, [])]
    visited = set()
    
    while queue:
        (cost, current, path_edges) = heapq.heappop(queue)
        
        if current in visited:
            continue
        visited.add(current)
        
        if current == dest_node:
            # Reconstruct detailed path, geometry, and metrics
            total_commute_time = 0.0
            total_distance = 0.0
            total_aqi_weight = 0.0
            path_geometry = []
            edge_details_list = []
            
            for idx, edge in enumerate(path_edges):
                _, edge_time_min, edge_aqi = calculate_edge_cost(edge, nodes_dict, alpha, beta, gamma)
                
                total_commute_time += edge_time_min
                total_distance += edge["distance"]
                # Weight average AQI by distance or time; let's weight it by travel time (exposure duration)
                total_aqi_weight += edge_aqi * edge_time_min
                
                edge_geom = json.loads(edge["geometry_json"])
                if idx == 0:
                    path_geometry.extend(edge_geom)
                else:
                    path_geometry.extend(edge_geom[1:])
                
                edge_details_list.append({
                    "edge_id": edge["edge_id"],
                    "node_u": edge["node_u"],
                    "node_v": edge["node_v"],
                    "distance": edge["distance"],
                    "travel_time_min": edge_time_min,
                    "aqi": edge_aqi,
                    "pheromone_points": edge["pheromone_points"]
                })
            
            avg_aqi = total_aqi_weight / total_commute_time if total_commute_time > 0 else 15.0
            
            return {
                "path": [start_node] + [edge["node_v"] for edge in path_edges],
                "geometry": path_geometry,
                "total_commute_time": round(total_commute_time, 2), # in minutes
                "average_aqi": round(avg_aqi, 2),
                "total_distance": round(total_distance, 1), # in meters
                "edge_details": edge_details_list
            }
            
        for edge in graph[current]:
            neighbor = edge["node_v"]
            if neighbor not in visited:
                edge_cost, _, _ = calculate_edge_cost(edge, nodes_dict, alpha, beta, gamma)
                heapq.heappush(queue, (cost + edge_cost, neighbor, path_edges + [edge]))
                
    return None
