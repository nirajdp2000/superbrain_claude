@echo off
echo Starting Superbrain India Production Deployment...
echo.

:: Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

:: Set production environment
set NODE_ENV=production

:: Start the server
echo Starting server on port 3210...
node src/server.mjs > logs\production.log 2>&1

echo.
echo Superbrain India is running in production mode!
echo API: http://localhost:3210
echo Logs: logs\production.log
pause
