@echo off
setlocal

set "TARGET=\\wsl$\Ubuntu\home\winlew\Mole-Guard"

if not exist "%TARGET%" (
  echo Folder not found:
  echo %TARGET%
  pause
  exit /b 1
)

start "" "%TARGET%"
