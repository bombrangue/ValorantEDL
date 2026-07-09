import os
import sys
import json
import base64
import ssl
import urllib.request
import urllib.error
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading
import webbrowser
import time
import random

# Global SSL context to ignore certificate errors for local Riot API
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Retrieves the local Riot Client lockfile to get the port and password for local authentication
def get_lockfile_data():
    lockfile_path = os.path.expandvars(r"%LocalAppData%\Riot Games\Riot Client\Config\lockfile")
    if not os.path.exists(lockfile_path):
        raise FileNotFoundError("Valorant does not seem to be running (lockfile not found).")
    
    # The lockfile contains 5 parts separated by colons: name:pid:port:password:protocol
    with open(lockfile_path, 'r') as f:
        content = f.read()
    parts = content.split(':')
    return {
        'name': parts[0],
        'pid': parts[1],
        'port': parts[2],
        'password': parts[3],
        'protocol': parts[4]
    }

# Hardcoded latest Riot Client version required for API requests
def fetch_riot_version():
    return "release-09.00-shipping-17-230559"

# Fetches detailed information for a specific match from the Riot API
def fetch_match_details(match_id, headers, shard):
    url = f"https://pd.{shard}.a.pvp.net/match-details/v1/matches/{match_id}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return "429"
        return None
    except Exception:
        return None

# Converts milliseconds to standard video timecode (HH:MM:SS:FF)
def frames_to_timecode(ms: int, fps: int) -> str:
    total_seconds = ms / 1000.0
    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = int(total_seconds % 60)
    remainder_ms = ms % 1000
    frames = int((remainder_ms / 1000.0) * fps)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}:{frames:02d}"

# Determine if the script is running as a compiled PyInstaller executable
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))

static_dir = os.path.join(base_dir, "static")

# Custom HTTP Server Handler to serve both static files and API endpoints
class ValorantAPIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=static_dir, **kwargs)

    # Main GET request router
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)
        print(f"DEBUG GET: {path}")

        # API Endpoints
        if path == "/api/auth":
            self.handle_auth()
        elif path.startswith("/api/matches/"):
            puuid = path.split("/")[-1]
            self.handle_matches(puuid, query)
        elif path.startswith("/api/edl/"):
            match_id = path.split("/")[-1]
            self.handle_edl(match_id, query)
        else:
            # Fallback to serving static HTML/JS/CSS files from the static directory
            super().do_GET()

    # Authenticate locally by communicating with the Riot Client
    def handle_auth(self):
        try:
            lockfile = get_lockfile_data()
        except Exception as e:
            self.send_json_response(400, {"detail": str(e)})
            return

        base_url = f"https://127.0.0.1:{lockfile['port']}"
        auth_string = f"riot:{lockfile['password']}"
        b64_auth = base64.b64encode(auth_string.encode()).decode()
        headers = {"Authorization": f"Basic {b64_auth}"}
        
        try:
            # Fetch Entitlements Token (required for Valorant API endpoints)
            req_token = urllib.request.Request(f"{base_url}/entitlements/v1/token", headers=headers)
            with urllib.request.urlopen(req_token, context=ctx) as response:
                token_data = json.loads(response.read())
            
            # Fetch Chat Session to determine the correct regional Shard automatically
            req_chat = urllib.request.Request(f"{base_url}/chat/v1/session", headers=headers)
            with urllib.request.urlopen(req_chat, context=ctx) as response:
                chat_data = json.loads(response.read())
            
            shard = "eu" # Default fallback
            pid = chat_data.get("pid", "")
            if "@" in pid and ".pvp.net" in pid:
                # Extracts 'eu' from 'd19...3@eu2.pvp.net'
                host = pid.split("@")[1].split(".")[0]
                shard = host[:-1] if host[-1].isdigit() else host

            result = {
                "accessToken": token_data["accessToken"],
                "entitlementsToken": token_data["token"],
                "puuid": token_data["subject"],
                "shard": shard
            }
            self.send_json_response(200, result)

        except urllib.error.HTTPError as e:
            self.send_json_response(e.code, {"detail": "Failed to authenticate locally"})
        except Exception as e:
            self.send_json_response(500, {"detail": str(e)})

    # Fetches the recent match history for the given player PUUID
    def handle_matches(self, puuid, query):
        access_token = query.get("accessToken", [""])[0]
        entitlements_token = query.get("entitlementsToken", [""])[0]
        shard = query.get("shard", ["eu"])[0]
        start_index = int(query.get("startIndex", ["0"])[0])
        # Fetch 20 matches at a time
        end_index = start_index + 20

        riot_version = fetch_riot_version()
        
        # Required headers by the Riot API to avoid 403 Forbidden errors
        headers = {
            "User-Agent": "ShooterGame/13 Windows/10.0.19043.1.256.64bit",
            "Authorization": f"Bearer {access_token}",
            "X-Riot-Entitlements-JWT": entitlements_token,
            "X-Riot-ClientVersion": riot_version,
            "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"
        }

        # Request match history list
        url_history = f"https://pd.{shard}.a.pvp.net/match-history/v1/history/{puuid}?startIndex={start_index}&endIndex={end_index}"
        req = urllib.request.Request(url_history, headers=headers)
        
        try:
            with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                history_data = json.loads(response.read())
        except urllib.error.HTTPError as e:
            if e.code == 400 and start_index > 0:
                self.send_json_response(200, [])
                return
            self.send_json_response(e.code, {"detail": "Failed to fetch history"})
            return
        except Exception as e:
            self.send_json_response(500, {"detail": str(e)})
            return

        matches = history_data.get("History", [])
        if not matches:
            self.send_json_response(200, [])
            return

        formatted_matches = []
        
        # Helper function to extract relevant data from a single match payload
        def process_match(m):
            # The match history endpoint only returns Match IDs.
            # We must fetch the full match details to get stats, agent, score, etc.
            details = fetch_match_details(m["MatchID"], headers, shard)
            if details == "429":
                return "429"
            if not details:
                return None
                
            # Locate our local player within the match participants
            player_info = next((p for p in details.get("players", []) if p["subject"] == puuid), None)
            if not player_info:
                return None
                
            # Extract basic match metadata
            match_id = details["matchInfo"]["matchId"]
            map_url = details["matchInfo"]["mapId"]
            game_start = details["matchInfo"]["gameStartMillis"]
            
            # Extract player performance statistics
            stats = player_info.get("stats", {})
            kills = stats.get("kills", 0)
            deaths = stats.get("deaths", 0)
            assists = stats.get("assists", 0)
            agent_id = player_info.get("characterId")
            
            # Determine match outcome (Win/Loss) and Team Scores
            team_id = player_info.get("teamId")
            my_team_score = 0
            enemy_team_score = 0
            for team in details.get("teams", []):
                if team["teamId"] == team_id:
                    my_team_score = team.get("roundsWon", 0)
                else:
                    enemy_team_score = team.get("roundsWon", 0)

            # Extract the queue type (Competitive, Unrated, Swiftplay, etc.)
            queue_id = details["matchInfo"].get("queueID", "")
            if not queue_id:
                queue_id = "custom" # Fallback for custom lobbies

            return {
                "matchId": match_id,
                "gameStart": game_start,
                "mapId": map_url,
                "queueId": queue_id,
                "agentId": agent_id.lower() if agent_id else None,
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "score": f"{my_team_score} - {enemy_team_score}",
                "won": my_team_score > enemy_team_score
            }

        # We use manual threading instead of concurrent.futures to reduce compiled executable size
        results = [None] * len(matches)
        
        # Limit concurrency to 5 to avoid immediate 429 Rate Limits from Riot API
        semaphore = threading.Semaphore(5)
        rate_limit_hit = False
        
        def worker(index, m):
            nonlocal rate_limit_hit
            if rate_limit_hit:
                return
            with semaphore:
                if rate_limit_hit:
                    return
                res = process_match(m)
                if res == "429":
                    rate_limit_hit = True
                else:
                    results[index] = res
            
        threads = []
        for i, m in enumerate(matches):
            t = threading.Thread(target=worker, args=(i, m))
            threads.append(t)
            t.start()
            
        for t in threads:
            t.join()
            
        if rate_limit_hit:
            self.send_json_response(429, {"detail": "Rate Limit Exceeded"})
            return
            
        # Filter out failed parses (None)
        formatted_matches = [r for r in results if r]
        # Re-sort to maintain correct most-recent-first order since threading might mess up ordering
        formatted_matches.sort(key=lambda x: x["gameStart"], reverse=True)
            
        self.send_json_response(200, formatted_matches)

    # Generates a DaVinci Resolve compatible EDL file containing markers for kills/deaths/assists
    def handle_edl(self, match_id, query):
        puuid = query.get("puuid", [""])[0]
        access_token = query.get("accessToken", [""])[0]
        entitlements_token = query.get("entitlementsToken", [""])[0]
        shard = query.get("shard", ["eu"])[0]
        fps = int(query.get("fps", ["60"])[0])

        riot_version = fetch_riot_version()
        
        headers = {
            "User-Agent": "ShooterGame/13 Windows/10.0.19043.1.256.64bit",
            "Authorization": f"Bearer {access_token}",
            "X-Riot-Entitlements-JWT": entitlements_token,
            "X-Riot-ClientVersion": riot_version,
            "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"
        }

        # Fetch full match details to get all round and kill events
        url = f"https://pd.{shard}.a.pvp.net/match-details/v1/matches/{match_id}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                details = json.loads(response.read())
        except Exception as e:
            self.send_json_response(500, {"detail": "Failed to fetch match details"})
            return
    
        # Build a list of timeline events based on in-game actions
        events = []
        events.append({"time": 0, "name": "Game Start", "color": "ResolveColorPurple"})
        
        # Dictionary to track round boundaries (start time and the last kill time which approximates end time)
        rounds = {}
        
        # Iterate over all kills in the match to extract personal events and round timings
        for kill in details.get("kills", []):
            game_time = kill.get("gameTime", 0) # Milliseconds since match started
            round_time = kill.get("roundTime", 0) # Milliseconds since round started
            round_num = kill.get("round", 0)
            
            # The start of the round is the kill's absolute game time minus its relative round time
            round_start = game_time - round_time
            if round_num not in rounds:
                rounds[round_num] = {"start": round_start, "last_kill": game_time}
            else:
                # Keep tracking the latest kill time to estimate when the round effectively ended
                rounds[round_num]["last_kill"] = max(rounds[round_num]["last_kill"], game_time)
                
            # Check if the requested player was involved in this kill event
            if kill.get("killer") == puuid:
                events.append({"time": game_time, "name": "Kill", "color": "ResolveColorGreen"})
            if kill.get("victim") == puuid:
                events.append({"time": game_time, "name": "Death", "color": "ResolveColorRed"})
            if puuid in kill.get("assistants", []):
                events.append({"time": game_time, "name": "Assist", "color": "ResolveColorYellow"})
                
        # Inject round boundaries into the timeline as cyan/blue markers
        for round_num, data in rounds.items():
            events.append({"time": data["start"], "name": f"Round {round_num+1} Start", "color": "ResolveColorCyan"})
            events.append({"time": data["last_kill"], "name": f"Round {round_num+1} End", "color": "ResolveColorBlue"})
            
        # Retrieve the total match duration and inject a Game End marker
        game_length = details.get("matchInfo", {}).get("gameLengthMillis", 0)
        if game_length > 0:
            events.append({"time": game_length, "name": "Game End", "color": "ResolveColorPurple"})
            
        # Sort all timeline events chronologically so the EDL is properly ordered
        events.sort(key=lambda x: x["time"])
        
        # Generate the standard EDL header format
        edl_lines = [
            "TITLE: Valorant Match Events",
            "FCM: NON-DROP FRAME",
            ""
        ]
        
        # Convert each event into a valid CMX 3600 EDL entry
        for idx, ev in enumerate(events):
            # Calculate standard timecodes based on the selected recording FPS
            start_tc = frames_to_timecode(ev["time"], fps)
            # Create a 1-frame duration marker
            end_tc = frames_to_timecode(ev["time"] + int(1000/fps), fps)
            event_num = f"{(idx+1):03d}"
            
            # Format: EventNum Reel TrackType CutType SourceStart SourceEnd RecordStart RecordEnd
            edl_lines.append(f"{event_num}  AX       V     C        {start_tc} {end_tc} {start_tc} {end_tc}")
            edl_lines.append(f" |C:{ev['color']} |M:{ev['name']}")
            edl_lines.append("")
            
        edl_content = "\n".join(edl_lines)
        
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Disposition", f'attachment; filename="match_{match_id}_kills.edl"')
        self.end_headers()
        self.wfile.write(edl_content.encode())

    def send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

def run_server():
    server_address = ('', 8080)
    httpd = ThreadingHTTPServer(server_address, ValorantAPIHandler)
    print("Starting Valorant EDL server on http://127.0.0.1:8080")
    
    threading.Thread(target=lambda: webbrowser.open("http://127.0.0.1:8080")).start()
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
