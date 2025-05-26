// UI Manager for Tone.js effects and sound library
class UIManager {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.initializeEffectControls();
        this.initializeSoundLibrary();
    }
    
    initializeEffectControls() {
        // For each track, set up all effect listeners
        for (let i = 0; i < 8; i++) {
            this.setupTrackEffects(i);
        }
    }
    
    setupTrackEffects(trackIndex) {
        // Pan control
        const panSlider = document.querySelector(`.track-pan[data-track="${trackIndex}"]`);
        if (panSlider) {
            panSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.audioEngine.setTrackPan(trackIndex, value);
                
                // Update display value
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
        }
        
        // EQ controls
        ['low', 'mid', 'high'].forEach(band => {
            const eqSlider = document.querySelector(`.track-eq-${band}[data-track="${trackIndex}"]`);
            if (eqSlider) {
                eqSlider.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.audioEngine.setTrackEQ(trackIndex, band, value);
                    
                    // Update display value
                    const display = e.target.nextElementSibling;
                    if (display) {
                        display.textContent = value > 0 ? `+${value}` : value;
                    }
                });
            }
        });
        
        // Additional Tone.js effects
        this.setupAdvancedEffects(trackIndex);
    }
    
    setupAdvancedEffects(trackIndex) {
        // We'll add buttons to toggle advanced effects panel
        const effectsBtn = document.querySelector(`.effects-toggle-btn[data-track="${trackIndex}"]`);
        if (effectsBtn) {
            // Create advanced effects panel if using Tone.js
            if (window.ToneAudioEngine && this.audioEngine instanceof ToneAudioEngine) {
                effectsBtn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showAdvancedEffectsPanel(trackIndex);
                });
            }
        }
    }
    
    showAdvancedEffectsPanel(trackIndex) {
        // Create a modal for advanced effects
        const existingModal = document.getElementById('advanced-effects-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = 'advanced-effects-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content advanced-effects">
                <h3>Advanced Effects - Track ${trackIndex + 1}</h3>
                <div class="effects-grid">
                    <div class="effect-section">
                        <h4>Modulation</h4>
                        <div class="effect-control">
                            <label>Chorus</label>
                            <input type="range" class="adv-chorus" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                        <div class="effect-control">
                            <label>Phaser</label>
                            <input type="range" class="adv-phaser" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                        <div class="effect-control">
                            <label>Tremolo</label>
                            <input type="range" class="adv-tremolo" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                        <div class="effect-control">
                            <label>Vibrato</label>
                            <input type="range" class="adv-vibrato" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                    </div>
                    <div class="effect-section">
                        <h4>Distortion</h4>
                        <div class="effect-control">
                            <label>Drive</label>
                            <input type="range" class="adv-distortion" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                        <div class="effect-control">
                            <label>BitCrush</label>
                            <input type="range" class="adv-bitcrusher" min="0" max="100" value="0">
                            <span class="effect-value">0</span>
                        </div>
                    </div>
                    <div class="effect-section">
                        <h4>Pitch</h4>
                        <div class="effect-control">
                            <label>Pitch Shift</label>
                            <input type="range" class="adv-pitchshift" min="0" max="100" value="50">
                            <span class="effect-value">0</span>
                        </div>
                    </div>
                    <div class="effect-section">
                        <h4>Dynamics</h4>
                        <div class="effect-control">
                            <label>Compressor</label>
                            <input type="range" class="adv-compressor" min="0" max="100" value="30">
                            <span class="effect-value">30</span>
                        </div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="save-preset-btn">Save as Preset</button>
                    <button class="close-modal-btn">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Setup listeners for advanced effects
        this.setupAdvancedEffectListeners(modal, trackIndex);
        
        // Show modal
        modal.style.display = 'flex';
    }
    
    setupAdvancedEffectListeners(modal, trackIndex) {
        const effects = [
            { name: 'chorus', className: 'adv-chorus' },
            { name: 'phaser', className: 'adv-phaser' },
            { name: 'tremolo', className: 'adv-tremolo' },
            { name: 'vibrato', className: 'adv-vibrato' },
            { name: 'distortion', className: 'adv-distortion' },
            { name: 'bitcrusher', className: 'adv-bitcrusher' },
            { name: 'pitchShift', className: 'adv-pitchshift' },
            { name: 'compressor', className: 'adv-compressor' }
        ];
        
        effects.forEach(effect => {
            const slider = modal.querySelector(`.${effect.className}`);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.audioEngine.setTrackEffect(trackIndex, effect.name, value);
                    
                    const display = e.target.nextElementSibling;
                    if (display) {
                        if (effect.name === 'pitchShift') {
                            const semitones = Math.round((value - 50) / 50 * 12);
                            display.textContent = semitones > 0 ? `+${semitones}` : semitones;
                        } else {
                            display.textContent = value;
                        }
                    }
                });
            }
        });
        
        // Close button
        modal.querySelector('.close-modal-btn').addEventListener('click', () => {
            modal.remove();
        });
        
        // Save preset button
        modal.querySelector('.save-preset-btn').addEventListener('click', () => {
            this.saveTrackAsPreset(trackIndex);
        });
    }
    
    initializeSoundLibrary() {
        // Add sound library button to top menu
        const topMenu = document.querySelector('.top-menu');
        if (topMenu) {
            const libraryBtn = document.createElement('button');
            libraryBtn.id = 'sound-library-btn';
            libraryBtn.textContent = '📚 Library';
            libraryBtn.addEventListener('click', () => this.showSoundLibrary());
            topMenu.appendChild(libraryBtn);
        }
    }
    
    showSoundLibrary() {
        const existingModal = document.getElementById('sound-library-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = 'sound-library-modal';
        modal.className = 'modal';
        
        const categories = Object.keys(this.audioEngine.soundLibrary.categories);
        
        modal.innerHTML = `
            <div class="modal-content sound-library">
                <h3>Sound Library</h3>
                <div class="library-layout">
                    <div class="category-list">
                        <h4>Categories</h4>
                        ${categories.map(cat => `
                            <button class="category-btn" data-category="${cat}">${cat}</button>
                        `).join('')}
                        <button class="category-btn new-category">+ New Category</button>
                    </div>
                    <div class="sound-list">
                        <h4 class="category-title">Select a category</h4>
                        <div class="sounds-grid"></div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="close-modal-btn">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Setup category buttons
        modal.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.dataset.category;
                if (category) {
                    this.displayCategorySounds(category, modal);
                } else if (e.target.classList.contains('new-category')) {
                    this.createNewCategory();
                }
            });
        });
        
        // Close button
        modal.querySelector('.close-modal-btn').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.style.display = 'flex';
    }
    
    displayCategorySounds(category, modal) {
        const soundsGrid = modal.querySelector('.sounds-grid');
        const categoryTitle = modal.querySelector('.category-title');
        
        categoryTitle.textContent = category;
        
        const sounds = this.audioEngine.soundLibrary.categories[category] || [];
        
        soundsGrid.innerHTML = sounds.map((sound, index) => `
            <div class="sound-item" data-category="${category}" data-index="${index}">
                <h5>${sound.name}</h5>
                <p>Instrument: ${sound.instrument}</p>
                <div class="sound-actions">
                    <button class="load-sound-btn">Load</button>
                    <button class="delete-sound-btn">Delete</button>
                </div>
            </div>
        `).join('');
        
        // Setup sound actions
        soundsGrid.querySelectorAll('.sound-item').forEach(item => {
            const category = item.dataset.category;
            const index = parseInt(item.dataset.index);
            
            item.querySelector('.load-sound-btn').addEventListener('click', () => {
                this.loadSoundToTrack(category, index);
            });
            
            item.querySelector('.delete-sound-btn').addEventListener('click', () => {
                if (confirm('Delete this sound?')) {
                    this.audioEngine.deleteSound(category, index);
                    this.displayCategorySounds(category, modal);
                }
            });
        });
    }
    
    loadSoundToTrack(category, soundIndex) {
        const sound = this.audioEngine.soundLibrary.categories[category][soundIndex];
        if (!sound) return;
        
        // Ask which track to load to
        const trackSelect = prompt('Load to which track? (1-8)', '1');
        const trackIndex = parseInt(trackSelect) - 1;
        
        if (trackIndex >= 0 && trackIndex < 8) {
            this.audioEngine.loadSound(sound, trackIndex);
            
            // Update UI
            const selector = document.querySelector(`[data-track="${trackIndex}"]`);
            if (selector) {
                selector.value = sound.instrument;
            }
            
            alert(`Sound "${sound.name}" loaded to Track ${trackIndex + 1}`);
        }
    }
    
    saveTrackAsPreset(trackIndex) {
        const name = prompt('Preset name:', `Track ${trackIndex + 1} Sound`);
        if (!name) return;
        
        const categories = Object.keys(this.audioEngine.soundLibrary.categories);
        const category = prompt(`Category (${categories.join(', ')}):`, 'User');
        
        if (category) {
            const sound = this.audioEngine.saveSound(name, category, trackIndex);
            alert(`Sound "${name}" saved to ${category} category!`);
        }
    }
    
    createNewCategory() {
        const name = prompt('New category name:');
        if (name && !this.audioEngine.soundLibrary.categories[name]) {
            this.audioEngine.soundLibrary.categories[name] = [];
            this.audioEngine.saveSoundLibrary();
            this.showSoundLibrary(); // Refresh
        }
    }
}

// Export
window.UIManager = UIManager;