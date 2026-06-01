import uvicorn
import threading
import time
import sys
import os

# Add current directory to path so python can find backend modules
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from backend.simulator import run_simulation

def start_server():
    print("Starting FastAPI Uvicorn Server on http://127.0.0.1:8000 ...")
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, log_level="info")

def start_simulator():
    # Wait for the FastAPI server to boot up
    time.sleep(3.0)
    try:
        run_simulation(interval_sec=2.0)
    except KeyboardInterrupt:
        pass

def free_port(port):
    import subprocess
    try:
        # Check if port is occupied on Windows
        cmd = f"netstat -ano | findstr LISTENING | findstr :{port}"
        output = subprocess.check_output(cmd, shell=True).decode()
        for line in output.strip().split('\n'):
            parts = line.strip().split()
            if parts:
                pid = parts[-1]
                print(f"Port {port} is occupied by process {pid}. Terminating process...")
                os.system(f"taskkill /F /PID {pid} >nul 2>&1")
                time.sleep(1.5)
    except Exception:
        pass

def main():
    # Clean port 8000 before running
    free_port(8000)
    
    # Create threads
    server_thread = threading.Thread(target=start_server, daemon=True)
    simulator_thread = threading.Thread(target=start_simulator, daemon=True)
    
    # Start threads
    server_thread.start()
    simulator_thread.start()
    
    print("\n" + "="*60)
    print(" ECO-ROUTING PROTOTYPE SYSTEM ONLINE")
    print(" Web Dashboard: http://127.0.0.1:8000")
    print(" Exit: Press Ctrl+C in this terminal")
    print("="*60 + "\n")
    
    # Keep the main thread alive to listen for interruption
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down Eco-Routing System... Goodbye!")

if __name__ == "__main__":
    main()
