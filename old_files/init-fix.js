// Simple initialization fix
debugLog.log('Init-fix.js running');

// Wait a bit for everything to load
setTimeout(() => {
    debugLog.log('Init-fix: Attempting to initialize canvas and start animation');
    
    // Initialize canvas directly
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) {
        debugLog.log('Init-fix: ERROR - Canvas not found!');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        debugLog.log('Init-fix: ERROR - Could not get context!');
        return;
    }
    
    // Set canvas size
    canvas.width = window.innerWidth - 400;
    canvas.height = window.innerHeight - 60;
    
    debugLog.log('Init-fix: Canvas initialized - ' + canvas.width + 'x' + canvas.height);
    
    // Simple animation to test
    function testAnimate() {
        // Draw green background
        ctx.fillStyle = '#0a0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        ctx.fillStyle = 'white';
        ctx.font = '30px Arial';
        ctx.fillText('Canvas Working! Click to test.', 50, 100);
        
        // Draw track lines
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        const numTracks = 8;
        const rowHeight = canvas.height / numTracks;
        
        for (let i = 0; i <= numTracks; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * rowHeight);
            ctx.lineTo(canvas.width, i * rowHeight);
            ctx.stroke();
        }
    }
    
    testAnimate();
    
    // Add click handler
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        debugLog.log('Canvas clicked at: ' + Math.round(x) + ', ' + Math.round(y));
        
        // Draw yellow circle
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
    });
    
}, 500);