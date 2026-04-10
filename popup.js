document.addEventListener('DOMContentLoaded', async () => {
    const hoursEl = document.getElementById('hours');
    const minutesEl = document.getElementById('minutes');
    const secondsEl = document.getElementById('seconds');
    const sessionTimeEl = document.getElementById('session-time');

    // Base tracking state
    let baseDailyTime = 0;
    let localSessionTime = 0;
    let isPaused = false;
    let lastUITick = Date.now();
    let tickInterval = null;

    function getTodayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const today = getTodayKey();

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return {
            hours: String(hours).padStart(2, '0'),
            minutes: String(minutes).padStart(2, '0'),
            seconds: String(seconds).padStart(2, '0')
        };
    }

    function formatSessionTime(ms) {
        const totalMinutes = Math.floor(ms / 60000);
        if (totalMinutes < 60) return `${totalMinutes}m`;
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h}h ${m}m`;
    }

    function updateUI() {
        const currentDailyTotal = baseDailyTime + localSessionTime;

        const timeParts = formatTime(currentDailyTotal);
        hoursEl.textContent = timeParts.hours;
        minutesEl.textContent = timeParts.minutes;
        secondsEl.textContent = timeParts.seconds;

        sessionTimeEl.textContent = formatSessionTime(localSessionTime);
    }

    function tick() {
        if (!isPaused) {
            const now = Date.now();
            localSessionTime += (now - lastUITick);
            lastUITick = now;
            updateUI();
        } else {
            lastUITick = Date.now();
        }
    }

    let isStopped = false;

    // Initialize from storage
    chrome.storage.local.get(['dailyUsage', 'isPaused'], (result) => {
        const dailyUsage = result.dailyUsage || {};
        baseDailyTime = dailyUsage[today] || 0;
        isPaused = result.isPaused || false;
        
        lastUITick = Date.now();
        updateUI();
        applyPauseState();
        
        if (!tickInterval) {
            tickInterval = setInterval(tick, 1000);
        }
    });

    function applyPauseState() {
        const statusEl = document.querySelector('.stats-row .stat:last-child .stat-value');
        const pauseBtn = document.getElementById('pause-btn');
        const timerWrapper = document.querySelector('.timer-wrapper');

        timerWrapper.classList.remove('paused', 'stopped');

        if (isStopped) {
            timerWrapper.classList.add('stopped');
            statusEl.className = 'stat-value stopped-status';
            statusEl.innerHTML = '<span class="dot"></span>Stopped';
            pauseBtn.textContent = 'Restart Timer';
        } else if (isPaused) {
            timerWrapper.classList.add('paused');
            statusEl.className = 'stat-value paused-status';
            statusEl.innerHTML = '<span class="dot"></span>Paused';
            pauseBtn.textContent = 'Resume Timer';
        } else {
            statusEl.className = 'stat-value active';
            statusEl.innerHTML = '<span class="dot"></span>Tracking';
            pauseBtn.textContent = 'Pause Timer';
            lastUITick = Date.now(); // reset baseline to avoid jumping
        }
    }

    // Pause Button Handler
    document.getElementById('pause-btn').addEventListener('click', () => {
        isPaused = !isPaused;
        isStopped = false; // Resume clears stopped state
        chrome.storage.local.set({ isPaused: isPaused });
        applyPauseState();
        updateUI();
    });

    // Helper for reporting
    function downloadReport() {
        const currentDailyTotal = baseDailyTime + localSessionTime;
        
        const totalSeconds = Math.floor(currentDailyTotal / 1000);
        let timeStr = "0 Seconds";
        
        if (totalSeconds > 0) {
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            
            let parts = [];
            if (h > 0) parts.push(`${h} Hour${h !== 1 ? 's' : ''}`);
            if (m > 0 || h > 0) parts.push(`${m} Minute${m !== 1 ? 's' : ''}`);
            parts.push(`${s} Second${s !== 1 ? 's' : ''}`);
            timeStr = parts.join(' ');
        }

        const reportContent = `Browser Time Report\nDate: ${today}\nTotal Time Focused: ${timeStr}\n`;
        const base64Content = btoa(unescape(encodeURIComponent(reportContent)));
        const url = `data:text/plain;charset=utf-8;base64,${base64Content}`;
        
        chrome.downloads.download({
            url: url,
            filename: `chromeTimeTracker/Time-Report-${today}.txt`,
            saveAs: false
        });
    }

    // Stop Button Handler
    document.getElementById('stop-btn').addEventListener('click', () => {
        isPaused = true;
        isStopped = true;
        chrome.storage.local.set({ isPaused: true });
        applyPauseState();
        updateUI();
        downloadReport();
    });

    // Screenshot Button Handler
    document.getElementById('screenshot-btn').addEventListener('click', () => {
        const subtitleEl = document.querySelector('.subtitle');
        subtitleEl.textContent = "Capturing screenshot...";
        subtitleEl.style.color = "#fbbf24"; // yellow

        try {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
                    subtitleEl.textContent = "Error finding active tab: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "No tab");
                    subtitleEl.style.color = "#ef4444"; // red
                    return;
                }

                chrome.tabs.captureVisibleTab(tabs[0].windowId, {format: 'png'}, (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        subtitleEl.textContent = "Security block: " + chrome.runtime.lastError.message;
                        subtitleEl.style.color = "#ef4444";
                        return;
                    }
                    if (!dataUrl) {
                        subtitleEl.textContent = "Error: Screenshot data was empty!";
                        subtitleEl.style.color = "#ef4444";
                        return;
                    }
                    
                    subtitleEl.textContent = "Saving image...";
                    chrome.downloads.download({
                        url: dataUrl,
                        filename: `screenshots/Screenshot-${today}-${Date.now()}.png`,
                        saveAs: false
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            subtitleEl.textContent = "Download failed: " + chrome.runtime.lastError.message;
                            subtitleEl.style.color = "#ef4444";
                        } else {
                            subtitleEl.textContent = "Screenshot saved!";
                            subtitleEl.style.color = "#4ade80"; // green
                            setTimeout(() => {
                                subtitleEl.textContent = "Time spent in browser today";
                                subtitleEl.style.color = "var(--text-secondary)";
                            }, 3000);
                        }
                    });
                });
            });
        } catch (e) {
            subtitleEl.textContent = "Critical error: " + e.message;
            subtitleEl.style.color = "#ef4444";
        }
    });

    // Manual Download Button
    document.getElementById('download-btn').addEventListener('click', downloadReport);
});
