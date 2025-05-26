// Debug DOM structure
debugLog.log('=== DOM Debug ===');

// Check if particleCanvas exists
const canvas1 = document.getElementById('particleCanvas');
debugLog.log('getElementById particleCanvas: ' + (canvas1 ? 'FOUND' : 'NOT FOUND'));

// Try querySelector
const canvas2 = document.querySelector('#particleCanvas');
debugLog.log('querySelector #particleCanvas: ' + (canvas2 ? 'FOUND' : 'NOT FOUND'));

// List all canvas elements
const allCanvas = document.getElementsByTagName('canvas');
debugLog.log('Total canvas elements: ' + allCanvas.length);
for (let i = 0; i < allCanvas.length; i++) {
    debugLog.log('Canvas ' + i + ': id=' + allCanvas[i].id + ', class=' + allCanvas[i].className);
}

// Check body content
debugLog.log('Body children count: ' + document.body.children.length);

// Look for specific elements
const trackControls = document.querySelector('.track-controls');
debugLog.log('Track controls found: ' + (trackControls ? 'YES' : 'NO'));

const multiTrackView = document.querySelector('.multi-track-view');
debugLog.log('Multi-track view found: ' + (multiTrackView ? 'YES' : 'NO'));

// Try to find canvas in a delayed check
setTimeout(() => {
    debugLog.log('=== Delayed DOM check (500ms) ===');
    const delayedCanvas = document.getElementById('particleCanvas');
    debugLog.log('Delayed check - particleCanvas: ' + (delayedCanvas ? 'FOUND' : 'NOT FOUND'));
    
    // If still not found, check the HTML structure
    if (!delayedCanvas) {
        debugLog.log('Checking for canvas in HTML...');
        const htmlContent = document.documentElement.innerHTML;
        const canvasIndex = htmlContent.indexOf('id="particleCanvas"');
        debugLog.log('Canvas in HTML: ' + (canvasIndex > -1 ? 'YES at index ' + canvasIndex : 'NO'));
    }
}, 500);