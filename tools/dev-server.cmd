@echo off
rem Dev-server launcher for environments whose PATH predates the Node install.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d C:\Users\melis\property-response-network
npm run dev
