@echo off
echo ========================================
echo Creating a clean virtual environment...
echo ========================================
python -m venv build_env
call build_env\Scripts\activate.bat

echo.
pip install pyinstaller
echo Compiling ValorantEDL...
echo ========================================
pyinstaller --noconfirm --onefile --name "ValorantEDL" --exclude-module tkinter --exclude-module unittest --exclude-module sqlite3 --exclude-module pydoc --exclude-module xml --exclude-module multiprocessing --add-data "static;static" app.py

echo.
echo ========================================
echo Cleaning up temporary environment...
echo ========================================
call deactivate
rmdir /s /q build_env
rmdir /s /q build
del ValorantEDL.spec

echo Moving executable to root directory...
move /y dist\ValorantEDL.exe .
rmdir /s /q dist

echo.
echo Compilation completed! Your ValorantEDL.exe is ready.
pause
