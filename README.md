# EcoPath: Swarm-Inspired Real Road Eco-Routing Engine

EcoPath is a prototype web mapping application that calculates the most economically and environmentally balanced path between two points in **Rajarajeshwari Nagar, Bengaluru, India**. 

The core of the project is a bio-inspired routing algorithm that weighs paths based on live air quality telemetry simulated by a mesh network of STM32 edge devices, blending it with travel time and historical pheromone trails.

---

## System Architecture

1. **FastAPI Backend (`backend/app.py`)**: REST API that ingests telemetry payloads, fetches map data, and computes optimal routes.
2. **SQLite Database (`backend/db.py`)**: Persists node records (coordinates, live AQI) and edge records (lengths, speed limits, winding geometries, and pheromone values).
3. **Multi-Objective Dijkstra Search (`backend/routing.py`)**: Traverses the Rajarajeshwari Nagar street network using the custom weight function.
4. **OSMnx Ingestion**: Automatically downloads the drivable road network of Rajarajeshwari Nagar via OpenStreetMap.
5. **Interactive Dashboard (`frontend/`)**: Glassmorphism HUD interface using Leaflet.js to visualize live AQI node sensors, glowing pheromone segments, user geolocation, and a live travel simulation.

---

## Routing Cost Function

For each street segment $e$, the combined cost evaluated during routing is:

$$\text{Cost} = \max\left(0.001, \alpha \cdot \text{Time}_{min} + \beta \cdot \text{AQI Penalty} - \gamma \cdot \text{Pheromones}\right)$$

* **Travel Time ($\text{Time}_{min}$)**: Seconds to traverse the street based on speed limits, converted to minutes.
* **AQI Penalty**: Cumulative particulate PM2.5 exposure over time ($AverageAQI \times Time_{min}$).
* **Pheromones**: Accumulated virtual points deposited on clean routes.
* **Weights ($\alpha, \beta, \gamma$)**: Adjustable sliders on the dashboard.

---

## Getting Started

### 1. Requirements
Ensure you have Python 3.10+ installed. Install the dependencies:
```bash
pip install -r requirements.txt
```

### 2. Launch the Application
Start the orchestrator (launches the API server, database seeding, and telemetry simulator thread concurrently):
```bash
python run.py
```
*(Or simply double-click the `run_dashboard.bat` file in Windows).*

### 3. Open the Dashboard
Open your web browser and navigate to:
[http://127.0.0.1:8000](http://127.0.0.1:8000)
