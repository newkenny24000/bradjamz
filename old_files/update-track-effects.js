// Script to update all track effect panels with Pan and EQ controls
function updateAllTrackEffects() {
    // Find all track effect panels
    for (let i = 0; i < 8; i++) {
        const panel = document.querySelector(`.track-effects-panel[data-track="${i}"]`);
        if (!panel) continue;
        
        // Check if Pan and EQ already exist
        const hasPan = panel.querySelector('.track-pan');
        const hasEQ = panel.querySelector('.eq-control');
        
        if (!hasPan) {
            // Add Pan control
            const panControl = document.createElement('div');
            panControl.className = 'effect-control';
            panControl.innerHTML = `
                <label>Pan</label>
                <input type="range" class="track-pan" data-track="${i}" min="0" max="100" value="50">
                <span class="effect-value">C</span>
            `;
            panel.appendChild(panControl);
        }
        
        if (!hasEQ) {
            // Add EQ control
            const eqControl = document.createElement('div');
            eqControl.className = 'effect-control eq-control';
            eqControl.innerHTML = `
                <label>EQ</label>
                <div class="eq-bands">
                    <div class="eq-band">
                        <label>Low</label>
                        <input type="range" class="track-eq-low" data-track="${i}" min="-20" max="20" value="0">
                        <span class="eq-value">0</span>
                    </div>
                    <div class="eq-band">
                        <label>Mid</label>
                        <input type="range" class="track-eq-mid" data-track="${i}" min="-20" max="20" value="0">
                        <span class="eq-value">0</span>
                    </div>
                    <div class="eq-band">
                        <label>High</label>
                        <input type="range" class="track-eq-high" data-track="${i}" min="-20" max="20" value="0">
                        <span class="eq-value">0</span>
                    </div>
                </div>
            `;
            panel.appendChild(eqControl);
        }
    }
}

// Run when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateAllTrackEffects);
} else {
    updateAllTrackEffects();
}