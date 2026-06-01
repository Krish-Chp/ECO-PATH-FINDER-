@echo off
title EcoPath Launcher
echo ========================================================
echo Starting EcoPath Swarm-Inspired Eco-Routing Engine...
echo ========================================================
echo.

:: Open default browser to the web dashboard
start http://127.0.0.1:8000

:: Run the python backend and simulation thread
python run.py

pause
