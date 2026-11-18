@echo off
setlocal

set "WSL_EXE=C:\Windows\System32\wsl.exe"

title Mole Guard Dev
"%WSL_EXE%" bash -lic "bash /home/winlew/Mole-Guard/tools/launchers/run-mole-guard.sh dev"
set "EXITCODE=%ERRORLEVEL%"
echo.
echo WSL exited with code %EXITCODE%.
pause
exit /b %EXITCODE%
