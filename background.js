let lastTickTime = Date.now();

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function heartbeat() {
  const now = Date.now();
  const elapsed = now - lastTickTime;
  
  // Always update tick time so we don't jump when resuming
  lastTickTime = now;
  
  try {
    const result = await chrome.storage.local.get(['dailyUsage', 'isPaused']);
    if (result.isPaused) {
      return; // Do not record time while paused
    }
  
    // If the gap is larger than 3 minutes, it likely means the browser was suspended.
    const timeToAdd = (elapsed > 3 * 60 * 1000) ? 0 : elapsed;
    
    if (timeToAdd > 0) {
      const today = getTodayKey();
      const dailyUsage = result.dailyUsage || {};
      
      // Initialize today if it doesn't exist, and cleanup old days
      if (typeof dailyUsage[today] !== 'number') {
        for (const key in dailyUsage) {
          if (key !== today) delete dailyUsage[key];
        }
        dailyUsage[today] = 0;
      }
      
      dailyUsage[today] += timeToAdd;
      await chrome.storage.local.set({ dailyUsage });
    }
  } catch (err) {
    console.error("Error accessing storage:", err);
  }
}

// Run a heartbeat every 1 minute
chrome.alarms.create("timeTracker", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "timeTracker") {
    heartbeat();
  }
});

// Setup on startup and install
chrome.runtime.onStartup.addListener(() => {
  lastTickTime = Date.now();
});

chrome.runtime.onInstalled.addListener(() => {
  lastTickTime = Date.now();
  heartbeat();
});

// Cache state in memory to allow 100% synchronous execution during browser shutdown
let cachedDailyUsage = 0;
let openWindowsCount = 0;

// Initialize caches
chrome.storage.local.get(['dailyUsage'], (result) => {
    const today = getTodayKey();
    cachedDailyUsage = result.dailyUsage?.[today] || 0;
});

chrome.windows.getAll((windows) => {
    openWindowsCount = windows.length;
});

// Update cache when storage changes (e.g. from heartbeat)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dailyUsage?.newValue) {
        const today = getTodayKey();
        cachedDailyUsage = changes.dailyUsage.newValue[today] || 0;
    }
});

chrome.windows.onCreated.addListener(() => {
    openWindowsCount++;
});

// Format ms to readable text (e.g., 2 Hours 5 Minutes 30 Seconds)
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds === 0) return "0 Seconds";
    
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    let parts = [];
    if (h > 0) parts.push(`${h} Hour${h !== 1 ? 's' : ''}`);
    if (m > 0 || h > 0) parts.push(`${m} Minute${m !== 1 ? 's' : ''}`);
    parts.push(`${s} Second${s !== 1 ? 's' : ''}`);
    
    return parts.join(' ');
}

// Download report synchronously when last window closes
chrome.windows.onRemoved.addListener((windowId) => {
    openWindowsCount--;
    if (openWindowsCount <= 0) {
        openWindowsCount = 0;
        const today = getTodayKey();
        
        // Use the cached time (extremely fast, no async overhead)
        const reportContent = `Browser Time Report\nDate: ${today}\nTotal Time Focused: ${formatTime(cachedDailyUsage)}\n`;
        const base64Content = btoa(unescape(encodeURIComponent(reportContent)));
        const url = `data:text/plain;charset=utf-8;base64,${base64Content}`;
        
        chrome.downloads.download({
            url: url,
            filename: `chromeTimeTracker/Time-Report-${today}.txt`,
            saveAs: false
        });
    }
});
