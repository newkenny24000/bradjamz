// Debug logging system
const debugLog = {
    entries: [],
    maxEntries: 50,
    
    log: function(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = `[${timestamp}] ${message}`;
        this.entries.push({ text: entry, type: type });
        
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
        
        this.updateDisplay();
    },
    
    error: function(message) {
        this.log(message, 'error');
    },
    
    warn: function(message) {
        this.log(message, 'warn');
    },
    
    clear: function() {
        this.entries = [];
        this.updateDisplay();
    },
    
    updateDisplay: function() {
        const logElement = document.getElementById('debug-log');
        if (logElement) {
            logElement.innerHTML = this.entries.map(entry => 
                `<div class="debug-entry ${entry.type}">${entry.text}</div>`
            ).join('');
            logElement.scrollTop = logElement.scrollHeight;
        }
    }
};

// Override console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
};

console.log = function(...args) {
    debugLog.log(args.join(' '));
    originalConsole.log.apply(console, args);
};

console.error = function(...args) {
    debugLog.error(args.join(' '));
    originalConsole.error.apply(console, args);
};

console.warn = function(...args) {
    debugLog.warn(args.join(' '));
    originalConsole.warn.apply(console, args);
};

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    // Clear debug button
    const clearBtn = document.getElementById('clear-debug');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            debugLog.clear();
        });
    }
    
    // Copy debug button
    const copyBtn = document.getElementById('copy-debug');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            // Get all log entries as text
            const logText = debugLog.entries
                .map(entry => entry.text)
                .join('\n');
            
            // Create a textarea, copy the text, then remove it
            const textarea = document.createElement('textarea');
            textarea.value = logText || 'No debug logs to copy';
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                
                // Visual feedback
                copyBtn.textContent = 'Copied!';
                copyBtn.style.background = 'rgba(0, 255, 0, 0.5)';
                
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.style.background = '';
                }, 1000);
                
                debugLog.log('Debug log copied to clipboard');
            } catch (err) {
                debugLog.error('Failed to copy: ' + err.message);
            }
            
            document.body.removeChild(textarea);
        });
    }
    
    // Initial log
    debugLog.log('Debug system initialized');
});