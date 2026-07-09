# ValorantEDL
A simple Python script that lets you generate EDL (Edit Decision List) marker files for video editing software, helping you edit your Valorant clips much faster.

## Requirements
- Python 3.9+ (and `pip` if you want to compile it into a standalone executable file).

## How to use it
You can either run the script directly using `Start.bat`, or compile it into a standalone `.exe` file using `Compile.bat`. Once the web interface opens, it will automatically detect your local Riot Client or you can manually enter a Player's PUUID to fetch their match history.

## What to expect
You can import the generated `.edl` file into any editing software that supports EDL formats (such as DaVinci Resolve or Premiere Pro). Make sure to set the start time of your timeline to `00:00:00:00`. You will then see markers automatically placed on your timeline for the following events:
- Game Start
- Round Start
- Kills
- Deaths
- Assists
- Round End
- Game End

# YOU NEED AT LEAST YOUR RIOT CLIENT OPEN
<img width="776" height="226" alt="image" src="https://github.com/user-attachments/assets/1f2a0cbd-8ae7-4e13-b32a-c2bc28837ec4" />
