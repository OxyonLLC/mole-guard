@echo off
setlocal

set "WSL_EXE=C:\Windows\System32\wsl.exe"

title Mole Guard
"%WSL_EXE%" bash -lic "bash /home/winlew/Mole-Guard/tools/launchers/run-mole-guard.sh start"
set "EXITCODE=%ERRORLEVEL%"
echo.
echo WSL exited with code %EXITCODE%.
pause
exit /b %EXITCODE%
