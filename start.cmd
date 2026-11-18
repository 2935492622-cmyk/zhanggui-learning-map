@echo off
setlocal
cd /d "%~dp0"
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 goto run_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 goto run_py
echo Python 3.11 or newer is required.
echo Install Python, then run this file again.
set "launch_exit=1"
goto finish
:run_python
python -u "%~dp0start.py" %*
set "launch_exit=%errorlevel%"
goto finish
:run_py
py -3 -u "%~dp0start.py" %*
set "launch_exit=%errorlevel%"
:finish
if not "%launch_exit%"=="0" echo Startup failed. See the error above.
pause
exit /b %launch_exit%
