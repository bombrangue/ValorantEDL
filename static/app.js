// Global application state variables
let authData = null; // Stores local authentication credentials
let apiMaps = {}; // Maps URLs to human-readable Map Names
let apiAgents = {}; // Maps Agent UUIDs to human-readable Agent Names
let currentStartIndex = 0; // Pagination tracker for Match History
let loadedMatches = []; // Accumulates fetched matches for filtering

// Main initialization function executed when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Fetch static reference data from Valorant-API
    await fetchValorantApiData();
    // 2. Check if the local Riot Client is running and authenticated
    await checkLocalAuth();
    
    // 3. Check for any existing rate limit lockouts
    updateRateLimitUI();

    // Bind event listener to the main "Fetch Matches" button
    document.getElementById("fetch-btn").addEventListener("click", () => {
        currentStartIndex = 0; // Reset pagination
        fetchMatches(false); // Fetch new list from scratch
    });
    
    // Bind event listener to the "Load More Matches" button
    document.getElementById("load-more-btn").addEventListener("click", () => {
        fetchMatches(true); // Append new matches to the existing list
    });
    
    // Initialize all custom HTML dropdown components across the application
    document.querySelectorAll(".val-dropdown").forEach(dropdown => {
        const selected = dropdown.querySelector(".val-dropdown-selected");
        const options = dropdown.querySelector(".val-dropdown-options");
        
        // Find the associated hidden input sibling used to store the dropdown's actual value
        const hiddenInput = dropdown.nextElementSibling;

        // Toggle dropdown open/close state on click
        selected.addEventListener("click", (e) => {
            // Close all other open dropdowns first to prevent overlap
            document.querySelectorAll(".val-dropdown.open").forEach(other => {
                if (other !== dropdown) {
                    other.classList.remove("open");
                    other.querySelector(".val-dropdown-options").classList.add("hidden");
                }
            });
            
            dropdown.classList.toggle("open");
            options.classList.toggle("hidden");
            e.stopPropagation(); // Prevent the document click listener from immediately closing it
        });

        // Initialize click events for statically rendered options (e.g., Region and FPS dropdowns)
        options.querySelectorAll(".val-option").forEach(opt => {
            opt.addEventListener("click", () => {
                selected.textContent = opt.textContent; // Update visible text
                if (hiddenInput) hiddenInput.value = opt.getAttribute("data-value"); // Update actual form value
                dropdown.classList.remove("open");
                options.classList.add("hidden");
            });
        });
    });

    // Global click listener to close any open dropdowns when clicking outside
    document.addEventListener("click", () => {
        document.querySelectorAll(".val-dropdown.open").forEach(dropdown => {
            dropdown.classList.remove("open");
            dropdown.querySelector(".val-dropdown-options").classList.add("hidden");
        });
    });
});

// Fetches static Maps and Agents data from a public community API to map IDs to readable names
async function fetchValorantApiData() {
    try {
        const mapsRes = await fetch("https://valorant-api.com/v1/maps");
        const mapsData = await mapsRes.json();
        mapsData.data.forEach(m => {
            apiMaps[m.mapUrl] = m.displayName;
        });
        
        const agentsRes = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
        const agentsData = await agentsRes.json();
        agentsData.data.forEach(a => {
            apiAgents[a.uuid.toLowerCase()] = a.displayName;
        });
    } catch (e) {
        console.error("Failed to fetch from valorant-api.com", e);
    }
}

// Contacts the local Python backend to communicate with the running Riot Client
async function checkLocalAuth() {
    const statusEl = document.getElementById("auth-status");
    const puuidInput = document.getElementById("puuid-input");
    
    try {
        const res = await fetch("/api/auth");
        if (!res.ok) throw new Error("Local auth failed");
        
        authData = await res.json();
        
        statusEl.className = "status-message success";
        statusEl.innerHTML = "✅ Local Riot Client detected. Ready to fetch matches.";
        
        if (!puuidInput.value) {
            puuidInput.value = authData.puuid;
        }
        
        // Auto-select the region detected from the local client in the dropdown UI
        const regionSelect = document.getElementById("region-select");
        if (regionSelect && authData.shard) {
            regionSelect.value = authData.shard;
            // Also update the visual custom dropdown text
            const selectedText = document.querySelector(".val-dropdown-selected");
            const optionNode = document.querySelector(`.val-option[data-value="${authData.shard}"]`);
            if (selectedText && optionNode) {
                selectedText.textContent = optionNode.textContent;
            }
        }
    } catch (e) {
        statusEl.className = "status-message error";
        statusEl.innerHTML = "❌ Could not connect to local Riot Client. Please make sure Valorant is running.";
    }
}

// Utility: Returns Map Name from ID
function getMapName(mapUrl) {
    return apiMaps[mapUrl] || mapUrl.split('/').pop() || "Unknown Map";
}

// Utility: Returns Agent Name from UUID
function getAgentName(agentId) {
    if (!agentId) return "Unknown Agent";
    return apiAgents[agentId.toLowerCase()] || "Unknown Agent";
}

// Utility: Returns human-readable Queue/Mode Name
function formatQueue(queueId) {
    if (!queueId) return "Unknown";
    if (queueId === "ggteam") return "Escalation";
    if (queueId === "hurm") return "Team Deathmatch";
    if (queueId === "onefa") return "Replication";
    if (queueId === "spikerush") return "Spike Rush";
    if (queueId === "newmap") return "New Map";
    return queueId.charAt(0).toUpperCase() + queueId.slice(1);
}

let isFetching = false; // Prevents concurrent fetches

// Rate Limiting settings to respect Riot's 60 requests/minute restriction
let rateLimitUntil = 0;
try {
    rateLimitUntil = parseInt(localStorage.getItem('valRateLimitUntil') || '0', 10);
} catch(e) {}

let rateLimitTimer = null;

// Updates the "Load More" and "Fetch Matches" buttons to show a countdown if rate limited
function updateRateLimitUI() {
    clearTimeout(rateLimitTimer);
    const loadMoreBtn = document.getElementById("load-more-btn");
    const fetchBtn = document.getElementById("fetch-btn");
    
    const now = Date.now();
    
    if (now < rateLimitUntil) {
        const waitTimeSec = Math.ceil((rateLimitUntil - now) / 1000);
        
        if (loadMoreBtn) {
            loadMoreBtn.disabled = true;
            loadMoreBtn.textContent = `Rate Limited - Wait ${waitTimeSec}s`;
            loadMoreBtn.style.opacity = "0.5";
            loadMoreBtn.style.cursor = "not-allowed";
        }
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.textContent = `Rate Limited - Wait ${waitTimeSec}s`;
            fetchBtn.style.opacity = "0.5";
            fetchBtn.style.cursor = "not-allowed";
        }
        
        rateLimitTimer = setTimeout(updateRateLimitUI, 1000);
    } else {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = "Load More Matches";
            loadMoreBtn.style.opacity = "1";
            loadMoreBtn.style.cursor = "pointer";
        }
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.textContent = "Fetch Matches";
            fetchBtn.style.opacity = "1";
            fetchBtn.style.cursor = "pointer";
        }
    }
}

function triggerRateLimitLockout() {
    rateLimitUntil = Date.now() + 70000; // 1 min 10 seconds lockout
    localStorage.setItem('valRateLimitUntil', rateLimitUntil.toString());
    updateRateLimitUI();
}

// Fetches the match history for the specified PUUID
async function fetchMatches(append = false) {
    if (!authData) {
        alert("Authentication data missing. Please ensure Valorant is running.");
        return;
    }
    
    if (isFetching) return;
    
    // Calculate the start index for this fetch
    const startIndexToFetch = append ? currentStartIndex + 20 : 0;
    
    // Check local rate limit before attempting fetch
    const now = Date.now();
    if (now < rateLimitUntil) {
        return; // Button is already disabled and showing timer, just ignore clicks silently
    }
    
    const puuid = document.getElementById("puuid-input").value;
    if (!puuid) return;
    
    // Read the selected region from the UI
    const selectedRegion = document.getElementById("region-select").value || authData.shard || "eu";
    
    isFetching = true;
    
    document.getElementById("matches-section").classList.remove("hidden");
    if (!append) {
        document.getElementById("matches-grid").innerHTML = "";
        loadedMatches = [];
    }
    
    const loadMoreBtn = document.getElementById("load-more-btn");
    const fetchBtn = document.getElementById("fetch-btn");
    
    if (append && loadMoreBtn) {
        loadMoreBtn.textContent = "LOADING...";
        loadMoreBtn.style.opacity = "0.7";
        loadMoreBtn.style.cursor = "wait";
    } else if (fetchBtn) {
        fetchBtn.textContent = "LOADING...";
        fetchBtn.style.opacity = "0.7";
        fetchBtn.style.cursor = "wait";
    }
    
    // We still show the spinner for visual feedback, but we DO NOT hide the buttons!
    document.getElementById("loading-spinner").classList.remove("hidden");
    
    try {
        const queryParams = new URLSearchParams({
            accessToken: authData.accessToken,
            entitlementsToken: authData.entitlementsToken,
            shard: selectedRegion,
            startIndex: startIndexToFetch
        });
        
        const res = await fetch(`/api/matches/${puuid}?${queryParams}`);
        if (res.status === 429) {
            triggerRateLimitLockout();
            // Important: we unhide the button immediately so the user can see the timer!
            document.getElementById("load-more-btn").classList.remove("hidden");
            throw new Error("Riot API Rate Limit Exceeded (429)");
        }
        if (!res.ok) throw new Error("Failed to fetch matches (API error)");
        
        const matches = await res.json();
        loadedMatches = loadedMatches.concat(matches);
        
        // Only update the global tracker if the fetch successfully returned data
        currentStartIndex = startIndexToFetch;
        
        renderMatches(matches, puuid, append);
        updateFilterDropdowns(); // Update Map/Mode/Agent dropdowns dynamically
    } catch (e) {
        console.error(e);
        if (!append) {
            document.getElementById("matches-grid").innerHTML = `<p style="color:var(--val-red); text-align: center; margin-top: 2rem;">Riot API Rate Limit reached.<br>Please wait for the timer on the button to finish.</p>`;
        } else {
            // Restore the load more button so the timer is visible
            document.getElementById("load-more-btn").classList.remove("hidden");
        }
    } finally {
        document.getElementById("loading-spinner").classList.add("hidden");
        isFetching = false;
        
        // Restore button text and style if we are not currently rate-limited
        if (Date.now() >= rateLimitUntil) {
            const loadMoreBtn = document.getElementById("load-more-btn");
            const fetchBtn = document.getElementById("fetch-btn");
            if (loadMoreBtn) {
                loadMoreBtn.textContent = "Load More Matches";
                loadMoreBtn.style.opacity = "1";
                loadMoreBtn.style.cursor = "pointer";
            }
            if (fetchBtn) {
                fetchBtn.textContent = "FETCH MATCHES";
                fetchBtn.style.opacity = "1";
                fetchBtn.style.cursor = "pointer";
            }
        }
    }
}

// Dynamically populates the Map, Mode, and Agent filter dropdowns based on the fetched match history
function updateFilterDropdowns() {
    const mapInput = document.getElementById("filter-map");
    const modeInput = document.getElementById("filter-mode");
    const agentInput = document.getElementById("filter-agent");
    
    const mapOptions = document.getElementById("filter-map-options");
    const modeOptions = document.getElementById("filter-mode-options");
    const agentOptions = document.getElementById("filter-agent-options");
    
    // Extract unique values from the currently loaded match history
    const uniqueMaps = [...new Set(loadedMatches.map(m => m.mapId))];
    const uniqueModes = [...new Set(loadedMatches.map(m => m.queueId))];
    const uniqueAgents = [...new Set(loadedMatches.map(m => m.agentId).filter(a => a))];
    
    // Helper function to rebuild the DOM for a custom dropdown
    const rebuildOptions = (optionsContainer, inputElem, dropdownId, items, getLabelFunc, allText) => {
        const dropdown = document.getElementById(dropdownId);
        const selectedLabel = dropdown.querySelector(".val-dropdown-selected");
        
        let html = `<div class="val-option" data-value="all">${allText}</div>`;
        items.forEach(id => {
            html += `<div class="val-option" data-value="${id}">${getLabelFunc(id)}</div>`;
        });
        optionsContainer.innerHTML = html;
        
        // Ensure visual label matches current value after repopulating
        const currentVal = inputElem.value;
        const currentOpt = optionsContainer.querySelector(`.val-option[data-value="${currentVal}"]`);
        if (currentOpt) {
            selectedLabel.textContent = currentOpt.textContent;
        } else {
            inputElem.value = "all";
            selectedLabel.textContent = allText;
        }
        
        // Re-bind click events for newly generated option elements
        optionsContainer.querySelectorAll(".val-option").forEach(opt => {
            opt.addEventListener("click", () => {
                selectedLabel.textContent = opt.textContent;
                inputElem.value = opt.getAttribute("data-value");
                dropdown.classList.remove("open");
                optionsContainer.classList.add("hidden");
                // Trigger visual filtering immediately when an option is clicked
                applyFilters();
            });
        });
    };
    
    rebuildOptions(mapOptions, mapInput, "filter-map-dropdown", uniqueMaps, getMapName, "All Maps");
    rebuildOptions(modeOptions, modeInput, "filter-mode-dropdown", uniqueModes, formatQueue, "All Modes");
    rebuildOptions(agentOptions, agentInput, "filter-agent-dropdown", uniqueAgents, getAgentName, "All Agents");
}    
    
// Applies the selected dropdown filters (Map, Mode, Agent) to hide/show match cards in the DOM
function applyFilters() {
    const selectedMap = document.getElementById("filter-map").value;
    const selectedMode = document.getElementById("filter-mode").value;
    const selectedAgent = document.getElementById("filter-agent").value;
    
    const cards = document.querySelectorAll(".match-card");
    cards.forEach(card => {
        const map = card.dataset.map;
        const mode = card.dataset.mode;
        const agent = card.dataset.agent;
        
        let show = true;
        if (selectedMap !== "all" && map !== selectedMap) show = false;
        if (selectedMode !== "all" && mode !== selectedMode) show = false;
        if (selectedAgent !== "all" && agent !== selectedAgent) show = false;
        
        // Toggle visibility based on filter match
        if (show) {
            card.style.display = "flex";
        } else {
            card.style.display = "none";
        }
    });
}

// Renders the list of match objects into HTML cards and appends them to the grid
function renderMatches(matches, puuid, append = false) {
    const grid = document.getElementById("matches-grid");
    
    if (matches.length === 0 && !append) {
        grid.innerHTML = "<p>No recent matches found.</p>";
        return;
    }
    
    matches.forEach(match => {
        const card = document.createElement("div");
        card.className = `match-card ${match.won ? 'won' : 'lost'}`; // Adds green or red border based on win/loss
        card.dataset.map = match.mapId;
        card.dataset.mode = match.queueId;
        card.dataset.agent = match.agentId || "";
        
        const date = new Date(match.gameStart).toLocaleDateString();
        const mapName = getMapName(match.mapId);
        const agentName = getAgentName(match.agentId);
        const queueName = formatQueue(match.queueId);
        
        card.innerHTML = `
            <div class="match-header">
                <span class="map-name">${mapName} <small style="color:var(--text-muted); font-size: 0.8rem; font-weight: normal; margin-left: 5px;">${queueName}</small></span>
                <span class="score" style="color: ${match.won ? '#2ecc71' : 'var(--val-red)'}">${match.score}</span>
            </div>
            <div class="match-stats">
                <span>${agentName}</span>
                <span>${match.kills} / ${match.deaths} / ${match.assists}</span>
                <span>${date}</span>
            </div>
            <button class="btn-download" onclick="downloadEdl('${match.matchId}', '${puuid}')">Download EDL</button>
        `;
        
        grid.appendChild(card);
    });
    
    // Show the "Load More" button if we successfully fetched items AND it seems like there might be more
    if (matches.length === 20) {
        document.getElementById("load-more-btn").classList.remove("hidden");
        updateRateLimitUI(); // Start tracking rate limit visually on the button
    } else if (append && matches.length < 20) {
        // If we appended but got less than 20 matches, we reached the end of Riot's history
        const endMsg = document.createElement("p");
        endMsg.style.textAlign = "center";
        endMsg.style.color = "var(--text-muted)";
        endMsg.style.gridColumn = "1 / -1";
        endMsg.style.marginTop = "1rem";
        endMsg.textContent = "End of available match history.";
        grid.appendChild(endMsg);
    }
}

// Redirects the browser to download the generated EDL file for a specific match
function downloadEdl(matchId, puuid) {
    const fps = document.getElementById("fps-select").value;
    const selectedRegion = document.getElementById("region-select").value || authData.shard || "eu";
    
    // Build query string for the download request
    const queryParams = new URLSearchParams({
        puuid: puuid,
        accessToken: authData.accessToken,
        entitlementsToken: authData.entitlementsToken,
        shard: selectedRegion,
        fps: fps
    });
    
    // Trigger the file download by changing window location
    window.location.href = `/api/edl/${matchId}?${queryParams}`;
}
