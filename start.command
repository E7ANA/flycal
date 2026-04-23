#!/bin/bash

# School Timetable Scheduler - Start Script
# Double-click this file to launch the app

cd "$(dirname "$0")"

cleanup() {
    echo ""
    echo "מכבה שרתים..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "נסגר."
    exit 0
}

trap cleanup INT TERM

echo "========================================="
echo "  School Timetable Scheduler"
echo "========================================="
echo ""

# Start backend
echo "מפעיל backend..."
cd backend
.venv/bin/uvicorn app.main:app --reload --port 8200 &
BACKEND_PID=$!
cd ..

# Start frontend
echo "מפעיל frontend..."
cd frontend
npm run dev -- --port 5273 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to be ready, then open browser
echo "ממתין לשרתים..."
sleep 3
echo "פותח דפדפן..."
open http://localhost:5273

echo ""
echo "האפליקציה רצה על http://localhost:5273"
echo "לחץ Ctrl+C לסגירה"
echo ""

wait
