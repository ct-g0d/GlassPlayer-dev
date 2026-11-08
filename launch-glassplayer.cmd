@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
start "" "D:\Dev\Nexus\node_modules\electron\dist\electron.exe" "%~dp0." %*
endlocal
