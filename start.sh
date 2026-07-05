#!/bin/bash
# Start worker in background first
python -m worker.run &

# Start API server (foreground — Render needs this)
uvicorn api.main:app --host 0.0.0.0 --port $PORT