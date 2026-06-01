let map;
let nodesData = [];
let edgesData = [];
let nodeMarkers = {};
let edgeLines = {};
let activeRouteLine = null;

let selectedStartNode = "";
let selectedDestNode = "";

// Geolocation markers
let myLocationMarker = null;
let travellingMarker = null;

// Travel simulation state
let simulationInterval = null;
let isSimulationActive = false;
let simulationGeometry = [];
let simulationEdgeDetails = [];
let simulationCurrentStep = 0;
let simulationAccruedExposure = 0.0;

// Map config: Centered on Rajarajeshwari Nagar, Bengaluru
const centerLat = 12.9220;
const centerLon = 77.5180;
const mapZoom = 14;

document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initUI();
    fetchNetworkData(true); // Initial load: populate dropdowns and center map
    
    // Auto-refresh network telemetry and pheromones every 4 seconds to show live updates
    setInterval(() => {
        fetchNetworkData(false);
    }, 4000);
});

// Initialize Leaflet Map
function initMap() {
    map = L.map("map", {
        zoomControl: true,
        attributionControl: false
    }).setView([centerLat, centerLon], mapZoom);

    // CartoDB Dark Matter tiles (premium look dark theme map)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Request current location on load
    setTimeout(requestUserLocation, 1000);
}

// Request Browser Geolocation
function requestUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                // Verify if user is reasonably close to RR Nagar (within 15km)
                // Otherwise fallback to mock RR Nagar Center
                const distToRRNagar = Math.sqrt((lat - centerLat)**2 + (lon - centerLon)**2);
                if (distToRRNagar < 0.15) {
                    drawMyLocation(lat, lon, false);
                } else {
                    console.log("User location is outside RR Nagar bounds. Seeding mock center.");
                    drawMyLocation(12.9220, 77.5180, true);
                }
            },
            (err) => {
                console.log("Geolocation error or denied:", err);
                drawMyLocation(12.9220, 77.5180, true);
            }
        );
    } else {
        drawMyLocation(12.9220, 77.5180, true);
    }
}

// Draw user's current location marker with pulsing halo
function drawMyLocation(lat, lon, isMock = false) {
    const customIconHtml = `
        <div class="my-location-pulse"></div>
        <div class="my-location-marker" style="width: 12px; height: 12px;"></div>
    `;
    const myLocationIcon = L.divIcon({
        html: customIconHtml,
        className: "custom-location-icon",
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
    
    const tooltipText = isMock ? "Default Location (Bengaluru RR Nagar)" : "My Current Location (Live)";
    
    if (myLocationMarker) {
        myLocationMarker.setLatLng([lat, lon]);
        myLocationMarker.setTooltipContent(tooltipText);
    } else {
        myLocationMarker = L.marker([lat, lon], {
            icon: myLocationIcon,
            zIndexOffset: 9000
        }).addTo(map);
        myLocationMarker.bindTooltip(tooltipText, { permanent: false, direction: "top" });
    }
}

// Initialize UI Control Listeners
function initUI() {
    const startSelect = document.getElementById("start-node");
    const destSelect = document.getElementById("dest-node");
    
    const alphaSlider = document.getElementById("weight-alpha");
    const alphaVal = document.getElementById("alpha-val");
    const betaSlider = document.getElementById("weight-beta");
    const betaVal = document.getElementById("beta-val");
    const gammaSlider = document.getElementById("weight-gamma");
    const gammaVal = document.getElementById("gamma-val");
    
    const decaySlider = document.getElementById("decay-rate");
    const decayVal = document.getElementById("decay-val");
    
    const btnCalculate = document.getElementById("btn-calculate");
    const btnEvaporate = document.getElementById("btn-evaporate");
    const btnRefresh = document.getElementById("btn-refresh");
    
    const btnStartNav = document.getElementById("btn-start-nav");
    const btnStopNav = document.getElementById("btn-stop-nav");

    // Sync weight sliders
    alphaSlider.addEventListener("input", (e) => {
        alphaVal.textContent = parseFloat(e.target.value).toFixed(1);
    });
    betaSlider.addEventListener("input", (e) => {
        betaVal.textContent = parseFloat(e.target.value).toFixed(1);
    });
    gammaSlider.addEventListener("input", (e) => {
        gammaVal.textContent = parseFloat(e.target.value).toFixed(1);
    });
    
    // Sync decay slider
    decaySlider.addEventListener("input", (e) => {
        decayVal.textContent = Math.round(e.target.value * 100) + "%";
    });

    // Dropdown selection updates map selections
    startSelect.addEventListener("change", (e) => {
        setStartNode(e.target.value);
    });

    destSelect.addEventListener("change", (e) => {
        setDestNode(e.target.value);
    });

    btnCalculate.addEventListener("click", () => {
        calculateRoute();
    });

    btnEvaporate.addEventListener("click", () => {
        triggerEvaporation();
    });

    btnRefresh.addEventListener("click", () => {
        fetchNetworkData(true);
    });

    btnStartNav.addEventListener("click", () => {
        startTravelSimulation();
    });

    btnStopNav.addEventListener("click", () => {
        stopTravelSimulation();
    });
}

// Fetch nodes and edges from API
async function fetchNetworkData(isFirstTime = false) {
    try {
        const [nodesRes, edgesRes] = await Promise.all([
            fetch("/api/nodes"),
            fetch("/api/edges")
        ]);
        
        if (!nodesRes.ok || !edgesRes.ok) throw new Error("Failed to fetch Bengaluru street data");

        nodesData = await nodesRes.json();
        edgesData = await edgesRes.json();

        // Update active ingestion status
        const statusBadge = document.getElementById("telemetry-status");
        const statusDot = statusBadge.previousElementSibling;
        
        statusBadge.textContent = `Ingestion Active: ${nodesData.length} Intersections Online`;
        statusDot.classList.add("active");

        updateMapVisualization(isFirstTime);
        
        if (isFirstTime) {
            populateDropdowns();
        }
    } catch (err) {
        console.error("Network error:", err);
        document.getElementById("telemetry-status").textContent = "Ingestion Error: Service Offline";
        document.getElementById("telemetry-status").previousElementSibling.classList.remove("active");
    }
}

// Populates dropdown elements with friendly intersection names
function populateDropdowns() {
    const startSelect = document.getElementById("start-node");
    const destSelect = document.getElementById("dest-node");

    startSelect.innerHTML = '<option value="" disabled selected>Select start location...</option>';
    destSelect.innerHTML = '<option value="" disabled selected>Select destination...</option>';

    // Sort nodes alphabetically based on the street names
    const sortedNodes = [...nodesData].sort((a, b) => a.name.localeCompare(b.name));

    sortedNodes.forEach(node => {
        const opt1 = document.createElement("option");
        opt1.value = node.node_id;
        opt1.textContent = `${node.name} (AQI: ${Math.round(node.aqi_pm25)})`;
        
        const opt2 = opt1.cloneNode(true);
        
        startSelect.appendChild(opt1);
        destSelect.appendChild(opt2);
    });
}

// Color scale for AQI circle markers
function getAQIColor(aqi) {
    if (aqi <= 25) return "#10b981"; // Good (Emerald)
    if (aqi <= 60) return "#f59e0b"; // Moderate (Amber)
    return "#ef4444"; // Poor (Rose)
}

// Style paths dynamically based on virtual pheromone points
function getPheromoneStyle(pheromone) {
    if (pheromone <= 0.15) {
        return {
            color: "rgba(255, 255, 255, 0.12)",
            weight: 2,
            dashArray: null
        };
    }
    
    const weight = 2 + Math.min(8, 2.0 * Math.log(pheromone / 0.1));
    const opacity = 0.35 + Math.min(0.6, pheromone / 15.0);
    
    let color = "#8b5cf6"; // Purple (Medium reinforcement)
    if (pheromone > 5.0) {
        color = "#d946ef"; // Fuchsia
    }
    if (pheromone > 15.0) {
        color = "#ec4899"; // Neon pink glow
    }

    return {
        color: color,
        weight: weight,
        opacity: opacity,
        dashArray: null
    };
}

// Draw markers and curved edges on Leaflet map
function updateMapVisualization(centerCamera = false) {
    const processedSegments = new Set();
    
    edgesData.forEach(edge => {
        const u = edge.node_u;
        const v = edge.node_v;
        
        const segmentKey = [u, v].sort().join("--");
        const style = getPheromoneStyle(edge.pheromone_points);
        
        if (processedSegments.has(segmentKey)) {
            const currentLine = edgeLines[segmentKey];
            if (currentLine && edge.pheromone_points > currentLine.pheromone) {
                currentLine.pheromone = edge.pheromone_points;
                currentLine.setStyle({
                    color: style.color,
                    weight: style.weight,
                    opacity: style.opacity
                });
            }
            return;
        }
        processedSegments.add(segmentKey);

        const pathCoords = JSON.parse(edge.geometry_json);

        if (edgeLines[segmentKey]) {
            edgeLines[segmentKey].pheromone = edge.pheromone_points;
            edgeLines[segmentKey].setStyle({
                color: style.color,
                weight: style.weight,
                opacity: style.opacity
            });
        } else {
            const line = L.polyline(pathCoords, {
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                interactive: false
            }).addTo(map);
            
            line.pheromone = edge.pheromone_points;
            edgeLines[segmentKey] = line;
        }
    });

    nodesData.forEach(node => {
        const id = node.node_id;
        const aqi = node.aqi_pm25;
        const color = getAQIColor(aqi);

        let borderClass = "node-marker-icon";
        if (id === selectedStartNode) borderClass += " node-selected-start";
        if (id === selectedDestNode) borderClass += " node-selected-dest";

        const iconHtml = `<div class="${borderClass}" style="width: 12px; height: 12px; background-color: ${color}; border: 1px solid rgba(0,0,0,0.45);"></div>`;
        const customIcon = L.divIcon({
            html: iconHtml,
            className: "custom-div-icon",
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        const popupContent = `
            <h4>Intersection: ${node.name}</h4>
            <p><strong>Node ID:</strong> ${id}</p>
            <p><strong>Lat/Lon:</strong> ${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}</p>
            <hr>
            <p><strong>PM2.5 AQI:</strong> <span style="color: ${color}; font-weight:bold;">${Math.round(node.aqi_pm25)}</span></p>
            <p><strong>VOCs AQI:</strong> ${Math.round(node.aqi_voc)}</p>
            <p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Last update: ${new Date(node.timestamp).toLocaleTimeString()}</p>
        `;

        if (nodeMarkers[id]) {
            nodeMarkers[id].setIcon(customIcon);
            nodeMarkers[id].setPopupContent(popupContent);
        } else {
            const marker = L.marker([node.latitude, node.longitude], {
                icon: customIcon
            }).addTo(map);

            marker.bindPopup(popupContent, { closeButton: false });

            marker.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                if (e.originalEvent.shiftKey) {
                    setDestNode(id);
                } else {
                    if (!selectedStartNode || (selectedStartNode && selectedDestNode)) {
                        setStartNode(id);
                        setDestNode(""); 
                    } else {
                        setDestNode(id);
                    }
                }
            });

            nodeMarkers[id] = marker;
        }
    });

    if (centerCamera && nodesData.length > 0) {
        const group = new L.featureGroup(Object.values(nodeMarkers));
        map.fitBounds(group.getBounds().pad(0.05));
    }
}

// Start Node Set Helper
function setStartNode(nodeId) {
    selectedStartNode = nodeId;
    document.getElementById("start-node").value = nodeId;
    updateMapVisualization(false);
}

// Destination Node Set Helper
function setDestNode(nodeId) {
    selectedDestNode = nodeId;
    document.getElementById("dest-node").value = nodeId;
    updateMapVisualization(false);
}

// Query route algorithms and display HUD metrics
async function calculateRoute() {
    if (!selectedStartNode || !selectedDestNode) {
        alert("Please select both a Start and Destination locality intersection.");
        return;
    }

    // Stop active simulation when calculating a new route
    stopTravelSimulation();

    const alpha = parseFloat(document.getElementById("weight-alpha").value);
    const beta = parseFloat(document.getElementById("weight-beta").value);
    const gamma = parseFloat(document.getElementById("weight-gamma").value);
    
    const btnCalculate = document.getElementById("btn-calculate");
    btnCalculate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding Path...';
    btnCalculate.disabled = true;

    try {
        // Query both multi-objective route and time-optimized shortest path in parallel
        const [ecoRes, baseRes] = await Promise.all([
            fetch("/api/route", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    start_node: selectedStartNode, 
                    dest_node: selectedDestNode, 
                    alpha: alpha,
                    beta: beta,
                    gamma: gamma
                })
            }),
            fetch("/api/route", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    start_node: selectedStartNode, 
                    dest_node: selectedDestNode, 
                    alpha: 1.0,
                    beta: 0.0,
                    gamma: 0.0
                })
            })
        ]);

        if (!ecoRes.ok) {
            const errData = await ecoRes.json();
            throw new Error(errData.detail || "Route calculations failed.");
        }

        const ecoRoute = await ecoRes.json();
        const baseRoute = await baseRes.json();

        // Save navigation geometries
        simulationGeometry = ecoRoute.geometry;
        simulationEdgeDetails = ecoRoute.edge_details;

        drawRouteOnMap(ecoRoute);
        displayRouteMetrics(ecoRoute, baseRoute);

        // Fetch network data to show newly deposited pheromones
        await fetchNetworkData(false);

    } catch (err) {
        alert(err.message);
        console.error(err);
    } finally {
        btnCalculate.innerHTML = '<i class="fa-solid fa-compass"></i> Calculate Route';
        btnCalculate.disabled = false;
    }
}

// Draw the winding street route
function drawRouteOnMap(route) {
    if (activeRouteLine) {
        map.removeLayer(activeRouteLine);
    }

    activeRouteLine = L.polyline(route.geometry, {
        color: "#06b6d4",
        weight: 6,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
    }).addTo(map);

    map.fitBounds(activeRouteLine.getBounds().pad(0.1));
    Object.values(nodeMarkers).forEach(m => m.bringToFront());
}

// Update UI metrics cards
function displayRouteMetrics(ecoRoute, baseRoute) {
    const panel = document.getElementById("metrics-panel");
    panel.classList.remove("hidden");

    document.getElementById("badge-commute-time").textContent = ecoRoute.total_commute_time.toFixed(1);
    
    const aqi = ecoRoute.average_aqi;
    let rating = "";
    if (aqi <= 25) rating = "Clean";
    else if (aqi <= 60) rating = "Moderate";
    else rating = "Polluted";
    document.getElementById("badge-aqi-rating").textContent = `${Math.round(aqi)} (${rating})`;

    const distanceKm = (ecoRoute.total_distance / 1000).toFixed(2);
    document.getElementById("val-distance").textContent = `${distanceKm} km`;
    document.getElementById("val-aqi").textContent = Math.round(aqi);
    document.getElementById("val-points").textContent = `+${ecoRoute.pheromone_deposited}`;
    
    const cleanlinessScore = Math.max(0, Math.min(100, Math.round(100 - aqi)));
    document.getElementById("val-score").textContent = `${cleanlinessScore}/100`;

    const ecoExposure = ecoRoute.average_aqi * ecoRoute.total_commute_time;
    const baseExposure = baseRoute.average_aqi * baseRoute.total_commute_time;
    
    const exposureDiffPercent = ((baseExposure - ecoExposure) / baseExposure) * 100;
    const barFill = document.getElementById("bar-exposure");
    const reductionText = document.getElementById("exposure-reduction");
    const tipText = document.getElementById("tip-text");

    if (exposureDiffPercent > 1.0) {
        reductionText.textContent = `-${Math.round(exposureDiffPercent)}% Inhaled PM2.5`;
        reductionText.className = "percentage-good";
        barFill.style.width = `${Math.round(100 - exposureDiffPercent)}%`;
        
        const extraTimeMin = ecoRoute.total_commute_time - baseRoute.total_commute_time;
        if (extraTimeMin > 0.2) {
            tipText.innerHTML = `<strong>Swarm optimized:</strong> Saved <strong>${Math.round(exposureDiffPercent)}%</strong> exposure with a minor detour adding <strong>${extraTimeMin.toFixed(1)} mins</strong> commute.`;
        } else {
            tipText.innerHTML = `<strong>Optimal Swarm Path:</strong> Cleanest route matches standard fastest path! Pheromones reinforced.`;
        }
    } else if (exposureDiffPercent < -1.0) {
        reductionText.textContent = `Shortest Commute Preferred`;
        reductionText.className = "percentage-good";
        barFill.style.width = "100%";
        tipText.innerHTML = `<strong>Commute Preferred:</strong> The shortest travel time was chosen to prevent excessive detour duration.`;
    } else {
        reductionText.textContent = "Optimal Exposure";
        reductionText.className = "percentage-good";
        barFill.style.width = "100%";
        tipText.innerHTML = `<strong>Balanced Route:</strong> Swarm logic computed a balanced travel time and exposure route.`;
    }
}

// Animate travel location marker moving along route geometry
function startTravelSimulation() {
    if (simulationGeometry.length === 0) {
        alert("Please calculate a route first before starting travel simulation.");
        return;
    }

    if (isSimulationActive) {
        stopTravelSimulation();
    }

    isSimulationActive = true;
    simulationCurrentStep = 0;
    simulationAccruedExposure = 0.0;

    // Show floating GPS HUD
    const hud = document.getElementById("nav-hud");
    hud.classList.remove("hidden");

    // Icon representing the vehicle/traveller
    const carIconHtml = `
        <div class="my-location-pulse" style="background: rgba(6, 182, 212, 0.4); animation-duration: 1.4s;"></div>
        <div class="my-location-marker" style="width: 14px; height: 14px; background-color: #06b6d4; border-color: #e0f2fe;"></div>
    `;
    const carIcon = L.divIcon({
        html: carIconHtml,
        className: "custom-car-icon",
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });

    const startPos = simulationGeometry[0];
    travellingMarker = L.marker(startPos, {
        icon: carIcon,
        zIndexOffset: 15000
    }).addTo(map);
    travellingMarker.bindTooltip("Travelling (Simulated)", { permanent: true, direction: "top", offset: [0, -10] });

    map.setView(startPos, 16); // Zoom close for navigation feel

    // Simulation Loop (runs every 300ms)
    simulationInterval = setInterval(() => {
        if (simulationCurrentStep >= simulationGeometry.length) {
            // Reached Destination!
            clearInterval(simulationInterval);
            document.getElementById("hud-val-street").textContent = "Destination Arrived!";
            document.getElementById("hud-val-speed").textContent = "0 km/h";
            document.getElementById("hud-progress-bar").style.width = "100%";
            setTimeout(() => {
                alert(`Navigation complete! You have arrived at your destination.\nTotal PM2.5 Inhaled Exposure: ${simulationAccruedExposure.toFixed(2)} µg.`);
            }, 500);
            return;
        }

        const currentPos = simulationGeometry[simulationCurrentStep];
        travellingMarker.setLatLng(currentPos);
        map.panTo(currentPos); // Center map on moving vehicle

        // Find nearest edge to determine local street name, speed limit, and AQI
        let minD = Infinity;
        let activeEdge = simulationEdgeDetails[0];
        
        simulationEdgeDetails.forEach(edge => {
            const uNode = nodesData.find(n => n.node_id === edge.node_u);
            if (uNode) {
                const distSq = (uNode.latitude - currentPos[0])**2 + (uNode.longitude - currentPos[1])**2;
                if (distSq < minD) {
                    minD = distSq;
                    activeEdge = edge;
                }
            }
        });

        // Get details from nodes/edges
        const uNodeObj = nodesData.find(n => n.node_id === activeEdge.node_u);
        const streetName = uNodeObj ? uNodeObj.name.split(" & ")[0] : "Bengaluru Road";
        const speed = Math.round(activeEdge.aqi > 60 ? activeEdge.speed_kph * 0.8 : activeEdge.speed_kph); // Slow down in heavy smog
        const aqi = Math.round(activeEdge.aqi);

        // Exposure accumulation model (AQI PM2.5 * time_fraction_hours * breathing_coefficient)
        // Assume each step represents ~5 seconds of travel
        const stepSec = 5.0;
        const breathingFactor = 0.0003; // Inhaled dose coefficient
        simulationAccruedExposure += aqi * (stepSec / 3600.0) * breathingFactor * 100;

        // Update HUD display values
        document.getElementById("hud-val-street").textContent = `On ${streetName}`;
        document.getElementById("hud-val-speed").textContent = `${speed} km/h`;
        document.getElementById("hud-val-aqi").textContent = aqi;
        document.getElementById("hud-val-aqi").style.color = getAQIColor(aqi);
        document.getElementById("hud-val-exposure").textContent = `${simulationAccruedExposure.toFixed(2)} µg`;

        // Update progress bar
        const progressPercent = (simulationCurrentStep / (simulationGeometry.length - 1)) * 100;
        document.getElementById("hud-progress-bar").style.width = `${progressPercent}%`;

        simulationCurrentStep++;
    }, 300);
}

// Stop travel simulation and clear markers
function stopTravelSimulation() {
    isSimulationActive = false;
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    if (travellingMarker) {
        map.removeLayer(travellingMarker);
        travellingMarker = null;
    }
    document.getElementById("nav-hud").classList.add("hidden");
}

// Trigger pheromone decay
async function triggerEvaporation() {
    const rate = parseFloat(document.getElementById("decay-rate").value);
    const btnEvaporate = document.getElementById("btn-evaporate");
    btnEvaporate.disabled = true;
    
    try {
        const res = await fetch("/api/evaporate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decay_rate: rate })
        });
        
        if (!res.ok) throw new Error("Evaporation request failed");
        await fetchNetworkData(false);
    } catch (err) {
        alert(err.message);
    } finally {
        btnEvaporate.disabled = false;
    }
}
