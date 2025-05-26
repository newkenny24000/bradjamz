// Add Tone.js effects to existing track controls
function addToneEffects() {
    // For each track, add Pan and EQ controls
    for (let i = 0; i < 8; i++) {
        const panel = document.querySelector(`.track-effects-panel[data-track="${i}"]`);
        if (!panel) continue;
        
        // Check if already added
        if (panel.querySelector('.track-pan')) continue;
        
        // Add Pan control
        const panControl = document.createElement('div');
        panControl.className = 'effect-control';
        panControl.innerHTML = `
            <label>Pan</label>
            <input type="range" class="track-pan" data-track="${i}" min="0" max="100" value="50">
            <span class="effect-value">C</span>
        `;
        panel.appendChild(panControl);
        
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
        
        // Add more Tone.js effects button
        const moreEffectsBtn = document.createElement('button');
        moreEffectsBtn.className = 'more-effects-btn';
        moreEffectsBtn.innerHTML = '+ More Effects';
        moreEffectsBtn.dataset.track = i;
        panel.appendChild(moreEffectsBtn);
    }
    
    // Add event listeners for new controls
    setupToneEffectListeners();
}

function setupToneEffectListeners() {
    // Pan controls
    document.querySelectorAll('.track-pan').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            const value = parseInt(e.target.value);
            
            if (window.audioEngine && window.audioEngine.setTrackPan) {
                window.audioEngine.setTrackPan(trackIndex, value);
            }
            
            // Update display
            const display = e.target.nextElementSibling;
            if (display) {
                if (value === 50) {
                    display.textContent = 'C';
                } else if (value < 50) {
                    display.textContent = `L${50 - value}`;
                } else {
                    display.textContent = `R${value - 50}`;
                }
            }
        });
    });
    
    // EQ controls
    ['low', 'mid', 'high'].forEach(band => {
        document.querySelectorAll(`.track-eq-${band}`).forEach(slider => {
            slider.addEventListener('input', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                const value = parseInt(e.target.value);
                
                if (window.audioEngine && window.audioEngine.setTrackEQ) {
                    window.audioEngine.setTrackEQ(trackIndex, band, value);
                }
                
                // Update display
                const display = e.target.nextElementSibling;
                if (display) {
                    display.textContent = value > 0 ? `+${value}` : value;
                }
            });
        });
    });
    
    // More effects buttons
    document.querySelectorAll('.more-effects-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            showAdvancedEffects(trackIndex);
        });
    });
}

function showAdvancedEffects(trackIndex) {
    // Create modal for advanced effects
    const modal = document.createElement('div');
    modal.className = 'modal advanced-effects-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Advanced Effects - Track ${trackIndex + 1}</h3>
            <div class="effects-grid">
                <div class="effect-section">
                    <h4>Modulation</h4>
                    <div class="effect-control">
                        <label>Chorus</label>
                        <input type="range" class="adv-chorus" data-track="${trackIndex}" min="0" max="100" value="0">
                        <span class="effect-value">0</span>
                    </div>
                    <div class="effect-control">
                        <label>Phaser</label>
                        <input type="range" class="adv-phaser" data-track="${trackIndex}" min="0" max="100" value="0">
                        <span class="effect-value">0</span>
                    </div>
                </div>
                <div class="effect-section">
                    <h4>Distortion</h4>
                    <div class="effect-control">
                        <label>Drive</label>
                        <input type="range" class="adv-distortion" data-track="${trackIndex}" min="0" max="100" value="0">
                        <span class="effect-value">0</span>
                    </div>
                    <div class="effect-control">
                        <label>BitCrush</label>
                        <input type="range" class="adv-bitcrusher" data-track="${trackIndex}" min="0" max="100" value="0">
                        <span class="effect-value">0</span>
                    </div>
                </div>
            </div>
            <button class="close-modal">Close</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Setup listeners
    modal.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const effectName = e.target.className.replace('adv-', '');
            
            if (window.audioEngine && window.audioEngine.setTrackEffect) {
                window.audioEngine.setTrackEffect(trackIndex, effectName, value);
            }
            
            e.target.nextElementSibling.textContent = value;
        });
    });
    
    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.remove();
    });
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addToneEffects);
} else {
    addToneEffects();
}