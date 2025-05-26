// 8-Track Studio with ElevenLabs Sound Generation
// Core functionality: 8 tracks, touch UI, piano roll, sound generation

window.log = function(...args) {
    const timestamp = new Date().toLocaleTimeString();
    const message = `[${timestamp}] ${args.join(' ')}`;
    
    const debugLog = document.getElementById('debug-log');
    if (debugLog) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = message;
        debugLog.appendChild(entry);
        debugLog.scrollTop = debugLog.scrollHeight;
    }
    
    console.log(...args);
};

// Global state
let audioEngine = null;
let selectedTrack = 0;
let soundLibrary = JSON.parse(localStorage.getItem('soundLibrary')) || {};
let elevenLabsApiKey = localStorage.getItem('elevenLabsApiKey') || '';

// Beat Sequencer state
let beatSequencer = {
    isPlaying: false,
    currentStep: 0,
    patternLength: 16,
    sequence: {}, // Track patterns: { trackIndex: [step1, step2, ...] }
    muted: {}, // Muted tracks: { trackIndex: boolean }
    solo: {}, // Solo tracks: { trackIndex: boolean }
    volumes: {}, // Track volumes: { trackIndex: volume }
    swing: 0,
    stepScheduler: null,
    nextStepTime: 0,
    lookAhead: 25.0,
    scheduleAheadTime: 0.1
};

// Helper function to convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Clean up expired blob URLs from sound library
function cleanupExpiredSounds() {
    let hasExpired = false;
    
    Object.keys(soundLibrary).forEach(category => {
        if (Array.isArray(soundLibrary[category])) {
            soundLibrary[category] = soundLibrary[category].filter(sound => {
                if (sound.url.startsWith('blob:')) {
                    log(`Removing expired sound: ${sound.name}`);
                    hasExpired = true;
                    return false;
                }
                return true;
            });
        }
    });
    
    if (hasExpired) {
        saveSoundLibrary();
        log('Cleaned up expired sounds from library');
    }
}

// Audio Editor State
let currentEditingSound = null;
let audioContext = null;
let audioBuffer = null;
let startTime = 0;
let endTime = 0;
let isDragging = false;
let dragTarget = null;

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    log('Initializing 8-Track Studio...');
    
    try {
        // Setup UI elements first (without audio)
        log('Setting up UI elements...');
        setupTrackControls();
        setupMenuBar();
        setupCanvas();
        setupControlPanel();
        setupModals();
        setupDebugPanel();
        setupBeatSequencer();
        
        // Setup touch handling
        setupTouchHandling();
        
        // Clean up expired sounds and load library
        cleanupExpiredSounds();
        loadSoundLibrary();
        
        // Test button functionality
        testButtonFunctionality();
        
        log('UI setup completed, initializing audio engine...');
        
        // Initialize audio engine when user interacts
        log('Audio engine will initialize on first user interaction');
        
        // Create audio engine but don't initialize until user interaction
        audioEngine = new ToneAudioEngine();
        
        // Add click listener to initialize audio on first interaction
        document.addEventListener('click', initializeAudioOnce, { once: true });
        document.addEventListener('touchstart', initializeAudioOnce, { once: true });
        
        log('Application initialized successfully');
    } catch (error) {
        log('ERROR: Failed to initialize application:', error);
    }
});

// Track Controls Setup
function setupTrackControls() {
    log('Setting up track controls...');
    
    // Effect toggles
    document.querySelectorAll('.effects-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            const panel = document.querySelector(`.track-effects-panel[data-track="${trackIndex}"]`);
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            log(`Toggled effects panel for track ${trackIndex + 1}`);
        });
    });
    
    // Sound generation buttons
    const soundGenBtns = document.querySelectorAll('.sound-gen-btn');
    log(`Found ${soundGenBtns.length} sound generation buttons`);
    
    soundGenBtns.forEach((btn, index) => {
        log(`Setting up sound gen button ${index + 1} for track ${btn.dataset.track}`);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const trackIndex = parseInt(e.target.dataset.track);
            log(`Sound generation button clicked for track ${trackIndex + 1}`);
            try {
                openSoundGenerationModal(trackIndex);
            } catch (error) {
                log('ERROR opening sound generation modal:', error);
            }
        });
    });
    
    // Effect sliders
    setupEffectSliders();
    
    // Sound selectors
    setupSoundSelectors();
    
    // Minimize/restore controls
    document.getElementById('minimize-controls').addEventListener('click', () => {
        document.querySelector('.track-controls').style.display = 'none';
        document.querySelector('.minimized-controls').style.display = 'flex';
        log('Minimized track controls');
    });
    
    document.getElementById('restore-controls').addEventListener('click', () => {
        document.querySelector('.track-controls').style.display = 'block';
        document.querySelector('.minimized-controls').style.display = 'none';
        log('Restored track controls');
    });
}

// Effect Sliders Setup
function setupEffectSliders() {
    const effects = ['reverb', 'delay', 'filter', 'volume', 'decay'];
    
    effects.forEach(effect => {
        document.querySelectorAll(`.track-${effect}`).forEach(slider => {
            slider.addEventListener('input', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                const value = parseInt(e.target.value);
                
                // Update display value
                const valueSpan = e.target.parentElement.querySelector('.effect-value');
                valueSpan.textContent = value;
                
                // Update audio engine
                if (audioEngine) {
                    audioEngine.updateTrackEffect(trackIndex, effect, value);
                }
                
                log(`Track ${trackIndex + 1} ${effect}: ${value}`);
            });
        });
    });
}

// Sound Selector Setup
function setupSoundSelectors() {
    log('Setting up sound selectors...');
    
    document.querySelectorAll('.sound-selector').forEach(selector => {
        selector.addEventListener('change', async (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            const soundId = e.target.value;
            
            if (!soundId) {
                log(`Track ${trackIndex + 1} sound cleared`);
                return;
            }
            
            // Find the sound in the library
            let sound = null;
            for (const category of Object.values(soundLibrary)) {
                if (Array.isArray(category)) {
                    sound = category.find(s => s.id === soundId);
                    if (sound) break;
                }
            }
            
            if (sound && audioEngine) {
                try {
                    // Check if URL is a blob URL (expired) or base64 (valid)
                    if (sound.url.startsWith('blob:')) {
                        log(`ERROR: Sound "${sound.name}" has expired blob URL. Please regenerate this sound.`);
                        alert(`Sound "${sound.name}" is no longer available (expired). Please generate it again.`);
                        return;
                    }
                    
                    await audioEngine.loadSample(trackIndex, sound.url, sound.name);
                    log(`Loaded sound "${sound.name}" to track ${trackIndex + 1} from selector`);
                } catch (error) {
                    log(`ERROR: Failed to load selected sound:`, error);
                }
            }
        });
    });
    
    // Populate selectors with existing sounds
    populateAllSoundSelectors();
}

function updateSoundSelector(trackIndex, soundName, soundId) {
    const selector = document.querySelector(`.sound-selector[data-track="${trackIndex}"]`);
    if (selector) {
        // Check if option already exists
        const existingOption = selector.querySelector(`option[value="${soundId}"]`);
        if (!existingOption) {
            const option = document.createElement('option');
            option.value = soundId;
            option.textContent = soundName;
            selector.appendChild(option);
        }
        
        // Select the new sound
        selector.value = soundId;
        log(`Updated sound selector for track ${trackIndex + 1}: ${soundName}`);
    }
}

function populateAllSoundSelectors() {
    log('Populating sound selectors with existing sounds...');
    
    // Get all sounds from library
    const allSounds = [];
    for (const [category, sounds] of Object.entries(soundLibrary)) {
        if (Array.isArray(sounds)) {
            sounds.forEach(sound => {
                allSounds.push({...sound, category});
            });
        }
    }
    
    // Populate each selector
    document.querySelectorAll('.sound-selector').forEach(selector => {
        // Clear existing options except first
        while (selector.children.length > 1) {
            selector.removeChild(selector.lastChild);
        }
        
        // Add all sounds
        allSounds.forEach(sound => {
            const option = document.createElement('option');
            option.value = sound.id;
            option.textContent = `${sound.name} (${sound.category})`;
            selector.appendChild(option);
        });
    });
    
    log(`Populated sound selectors with ${allSounds.length} sounds`);
}

// Menu Bar Setup
function setupMenuBar() {
    log('Setting up menu bar...');
    
    // Sound Library button
    const soundsBtn = document.getElementById('sounds-btn');
    if (soundsBtn) {
        log('Setting up sounds library button');
        soundsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Sound library button clicked');
            try {
                openSoundLibraryModal();
            } catch (error) {
                log('ERROR opening sound library modal:', error);
            }
        });
    } else {
        log('ERROR: sounds-btn element not found');
    }
    
    
    // Panic button
    document.getElementById('panic').addEventListener('click', () => {
        if (audioEngine) {
            audioEngine.panic();
            log('Panic: All sounds stopped');
        }
    });
    
    // Test sound generation button
    const testSoundGenBtn = document.getElementById('test-sound-gen');
    if (testSoundGenBtn) {
        log('Setting up test sound generation button');
        testSoundGenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Test button clicked - testing audio');
            
            try {
                // Test Tone.js with a simple oscillator
                await Tone.start();
                log(`Tone.js context state: ${Tone.context.state}`);
                
                const osc = new Tone.Oscillator(440, "sine").toDestination();
                osc.start();
                osc.stop("+0.5");
                log('Test tone played');
                
                // Also test if audio engine is working
                if (audioEngine && audioEngine.isInitialized) {
                    log('Audio engine is initialized');
                } else {
                    log('Audio engine not ready');
                }
                
            } catch (error) {
                log('ERROR in test:', error);
            }
        });
    }
}

// Canvas Setup
function setupCanvas() {
    log('Setting up canvas...');
    
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    
    // Particle animation
    const particles = [];
    
    function animate() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Update and draw particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue}, 100%, 50%, ${p.life})`;
            ctx.fill();
        }
        
        requestAnimationFrame(animate);
    }
    
    animate();
    
    // Export particle creation function
    window.createParticle = function(x, y, trackIndex) {
        const hue = (trackIndex * 45) % 360;
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            size: Math.random() * 5 + 2,
            hue: hue,
            life: 1
        });
    };
}

// Control Panel Setup
function setupControlPanel() {
    log('Setting up control panel...');
    
    // Collapse/expand
    document.getElementById('collapse-btn').addEventListener('click', () => {
        const panel = document.querySelector('.panel-content');
        const btn = document.getElementById('collapse-btn');
        
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            btn.textContent = '−';
        } else {
            panel.style.display = 'none';
            btn.textContent = '+';
        }
    });
    
    // Scale and key controls
    document.getElementById('scale').addEventListener('change', (e) => {
        if (audioEngine) {
            audioEngine.setScale(e.target.value);
            log(`Scale changed to: ${e.target.value}`);
        }
    });
    
    document.getElementById('key').addEventListener('change', (e) => {
        if (audioEngine) {
            audioEngine.setKey(e.target.value);
            log(`Key changed to: ${e.target.value}`);
        }
    });
    
    // Octave control
    document.getElementById('octave').addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('octaveValue').textContent = value;
        if (audioEngine) {
            audioEngine.setOctave(parseInt(value));
            log(`Octave changed to: ${value}`);
        }
    });
    
    // BPM control
    document.getElementById('bpm').addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('bpmValue').textContent = value;
        if (audioEngine) {
            audioEngine.setBPM(parseInt(value));
            log(`BPM changed to: ${value}`);
        }
    });
    
    // Metronome toggle
    document.getElementById('metronome-toggle').addEventListener('click', (e) => {
        if (audioEngine) {
            const isOn = audioEngine.toggleMetronome();
            e.target.textContent = isOn ? 'On' : 'Off';
            e.target.classList.toggle('active', isOn);
            log(`Metronome: ${isOn ? 'On' : 'Off'}`);
        }
    });
    
    // Play/Stop/Clear buttons
    document.getElementById('play').addEventListener('click', () => {
        if (audioEngine) {
            audioEngine.startSequencer();
            log('Sequencer started');
        }
    });
    
    document.getElementById('stop').addEventListener('click', () => {
        if (audioEngine) {
            audioEngine.stopSequencer();
            log('Sequencer stopped');
        }
    });
    
    document.getElementById('clear').addEventListener('click', () => {
        if (audioEngine) {
            audioEngine.clearSequence();
            log('Sequence cleared');
        }
    });
    
    document.getElementById('panic2').addEventListener('click', () => {
        if (audioEngine) {
            audioEngine.panic();
            log('Panic: All sounds stopped');
        }
    });
}

// Touch Handling Setup
function setupTouchHandling() {
    log('Setting up touch handling...');
    
    const zones = document.querySelectorAll('.instrument-zone');
    const activeNotes = new Map();
    
    zones.forEach((zone, trackIndex) => {
        // Touch start
        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            Array.from(e.changedTouches).forEach(touch => {
                const rect = zone.getBoundingClientRect();
                const x = touch.clientX - rect.left;
                const y = touch.clientY - rect.top;
                const normalizedX = x / rect.width;
                const normalizedY = 1 - (y / rect.height);
                
                const noteId = `${touch.identifier}-${trackIndex}`;
                
                if (audioEngine) {
                    // Create visual feedback immediately
                    createParticle(touch.clientX, touch.clientY, trackIndex);
                    
                    log(`Touch start: Track ${trackIndex + 1}, X: ${normalizedX.toFixed(2)}, Y: ${normalizedY.toFixed(2)}`);
                    
                    // Play note asynchronously
                    audioEngine.playNote(trackIndex, normalizedX, normalizedY).then(note => {
                        if (note) {
                            activeNotes.set(noteId, { trackIndex, noteInfo: note });
                            log(`Note played successfully: Track ${trackIndex + 1}`);
                        } else {
                            log(`Note failed to play: Track ${trackIndex + 1}`);
                        }
                    }).catch(error => {
                        log(`ERROR playing note on track ${trackIndex + 1}:`, error);
                    });
                } else {
                    log(`ERROR: Audio engine not initialized when touching track ${trackIndex + 1}`);
                }
            });
        });
        
        // Touch move
        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            Array.from(e.changedTouches).forEach(touch => {
                const noteId = `${touch.identifier}-${trackIndex}`;
                
                if (activeNotes.has(noteId)) {
                    createParticle(touch.clientX, touch.clientY, trackIndex);
                }
            });
        });
        
        // Touch end
        zone.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            Array.from(e.changedTouches).forEach(touch => {
                const noteId = `${touch.identifier}-${trackIndex}`;
                
                if (activeNotes.has(noteId) && audioEngine) {
                    const { trackIndex } = activeNotes.get(noteId);
                    audioEngine.stopNote(trackIndex);
                    activeNotes.delete(noteId);
                    
                    log(`Touch end: Track ${trackIndex + 1}`);
                }
            });
        });
        
        // Mouse events for desktop testing
        let mouseDown = false;
        
        zone.addEventListener('mousedown', (e) => {
            mouseDown = true;
            const rect = zone.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const normalizedX = x / rect.width;
            const normalizedY = 1 - (y / rect.height);
            
            if (audioEngine) {
                // Create visual feedback immediately
                createParticle(e.clientX, e.clientY, trackIndex);
                
                log(`Mouse down: Track ${trackIndex + 1}, X: ${normalizedX.toFixed(2)}, Y: ${normalizedY.toFixed(2)}`);
                
                // Play note asynchronously
                audioEngine.playNote(trackIndex, normalizedX, normalizedY).then(note => {
                    if (note) {
                        activeNotes.set('mouse', { trackIndex, noteInfo: note });
                        log(`Mouse note played successfully: Track ${trackIndex + 1}`);
                    } else {
                        log(`Mouse note failed to play: Track ${trackIndex + 1}`);
                    }
                }).catch(error => {
                    log(`ERROR playing mouse note on track ${trackIndex + 1}:`, error);
                });
            } else {
                log(`ERROR: Audio engine not initialized when clicking track ${trackIndex + 1}`);
            }
        });
        
        zone.addEventListener('mousemove', (e) => {
            if (mouseDown) {
                createParticle(e.clientX, e.clientY, trackIndex);
            }
        });
        
        zone.addEventListener('mouseup', () => {
            if (mouseDown && audioEngine) {
                audioEngine.stopNote(trackIndex);
                activeNotes.delete('mouse');
                mouseDown = false;
                log(`Mouse up: Track ${trackIndex + 1}`);
            }
        });
        
        zone.addEventListener('mouseleave', () => {
            if (mouseDown && audioEngine) {
                audioEngine.stopNote(trackIndex);
                activeNotes.delete('mouse');
                mouseDown = false;
            }
        });
    });
}

// Modal Setup
function setupModals() {
    log('Setting up modals...');
    
    // Sound generation modal
    const saveApiKeyBtn = document.getElementById('save-api-key');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const apiKey = document.getElementById('elevenlabs-api-key').value;
            if (apiKey) {
                elevenLabsApiKey = apiKey;
                localStorage.setItem('elevenLabsApiKey', apiKey);
                log('ElevenLabs API key saved');
                alert('API key saved successfully!');
            }
        });
    } else {
        log('ERROR: save-api-key button not found');
    }
    
    const generateSoundBtn = document.getElementById('generate-sound');
    if (generateSoundBtn) {
        generateSoundBtn.addEventListener('click', () => {
            generateSound();
        });
    } else {
        log('ERROR: generate-sound button not found');
    }
    
    const cancelGenBtn = document.getElementById('cancel-gen');
    if (cancelGenBtn) {
        cancelGenBtn.addEventListener('click', () => {
            closeSoundGenerationModal();
        });
    } else {
        log('ERROR: cancel-gen button not found');
    }
    
    // Sound library modal
    document.getElementById('close-sound-library').addEventListener('click', () => {
        closeSoundLibraryModal();
    });
    
    document.getElementById('generate-new-sound-btn').addEventListener('click', () => {
        closeSoundLibraryModal();
        openSoundGenerationModal(selectedTrack);
    });
    
    document.getElementById('add-category-btn').addEventListener('click', () => {
        const categoryName = prompt('Enter new category name:');
        if (categoryName) {
            addCategory(categoryName);
        }
    });
    
    // Category buttons
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            filterSoundsByCategory(e.target.dataset.category);
        });
    });
}

// Debug Panel Setup
function setupDebugPanel() {
    log('Setting up debug panel...');
    
    document.getElementById('copy-debug').addEventListener('click', () => {
        const debugLog = document.getElementById('debug-log');
        const text = Array.from(debugLog.children)
            .map(entry => entry.textContent)
            .join('\n');
        
        navigator.clipboard.writeText(text).then(() => {
            log('Debug log copied to clipboard');
        });
    });
    
    document.getElementById('clear-debug').addEventListener('click', () => {
        const debugLog = document.getElementById('debug-log');
        debugLog.innerHTML = '';
        log('Debug log cleared');
    });
}

// Sound Generation Functions
function openSoundGenerationModal(trackIndex) {
    log(`Attempting to open sound generation modal for track ${trackIndex + 1}`);
    
    selectedTrack = trackIndex;
    
    const trackNumberSpan = document.getElementById('track-number');
    if (trackNumberSpan) {
        trackNumberSpan.textContent = `Track ${trackIndex + 1}`;
    } else {
        log('ERROR: track-number element not found');
    }
    
    const modal = document.querySelector('.sound-gen-modal');
    if (modal) {
        modal.style.display = 'block';
        log(`Sound generation modal displayed for track ${trackIndex + 1}`);
    } else {
        log('ERROR: sound-gen-modal element not found');
        return;
    }
    
    // Load saved API key
    if (elevenLabsApiKey) {
        const apiKeyInput = document.getElementById('elevenlabs-api-key');
        if (apiKeyInput) {
            apiKeyInput.value = elevenLabsApiKey;
        }
    }
    
    log(`Opened sound generation modal for track ${trackIndex + 1}`);
}

function closeSoundGenerationModal() {
    document.querySelector('.sound-gen-modal').style.display = 'none';
    document.getElementById('sound-prompt').value = '';
    log('Closed sound generation modal');
}

async function generateSound() {
    const prompt = document.getElementById('sound-prompt').value;
    
    if (!prompt) {
        alert('Please enter a sound description');
        return;
    }
    
    if (!elevenLabsApiKey) {
        alert('Please enter your ElevenLabs API key');
        return;
    }
    
    log(`Generating sound: "${prompt}" for track ${selectedTrack + 1}`);
    
    // Show loading indicator
    document.querySelector('.loading-indicator').style.display = 'block';
    document.getElementById('generate-sound').disabled = true;
    
    try {
        // Call ElevenLabs API
        const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': elevenLabsApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: prompt,
                duration_seconds: 2.0,
                prompt_influence: 0.3
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        // Get audio data
        const audioBlob = await response.blob();
        
        // Convert blob to base64 for permanent storage
        const base64Data = await blobToBase64(audioBlob);
        
        // Create both blob URL (for immediate use) and base64 (for storage)
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Save to sound library with base64 data
        const soundId = Date.now().toString();
        const soundData = {
            id: soundId,
            name: prompt,
            url: base64Data, // Store base64 instead of blob URL
            category: 'user',
            created: new Date().toISOString()
        };
        
        if (!soundLibrary.user) {
            soundLibrary.user = [];
        }
        soundLibrary.user.push(soundData);
        saveSoundLibrary();
        
        // Load sound into track
        if (audioEngine) {
            await audioEngine.loadSample(selectedTrack, audioUrl, soundData.name);
        }
        
        // Update sound selector dropdown
        updateSoundSelector(selectedTrack, soundData.name, soundData.id);
        
        log(`Sound generated and loaded: "${prompt}"`);
        alert('Sound generated successfully!');
        closeSoundGenerationModal();
        
    } catch (error) {
        log('ERROR: Failed to generate sound:', error);
        alert(`Failed to generate sound: ${error.message}`);
    } finally {
        document.querySelector('.loading-indicator').style.display = 'none';
        document.getElementById('generate-sound').disabled = false;
    }
}

// Sound Library Functions
function openSoundLibraryModal() {
    document.getElementById('sound-library-modal').style.display = 'block';
    displaySoundLibrary();
    log('Opened sound library');
}

function closeSoundLibraryModal() {
    document.getElementById('sound-library-modal').style.display = 'none';
    log('Closed sound library');
}

function loadSoundLibrary() {
    const saved = localStorage.getItem('soundLibrary');
    if (saved) {
        soundLibrary = JSON.parse(saved);
        log('Loaded sound library from storage');
    }
}

function saveSoundLibrary() {
    localStorage.setItem('soundLibrary', JSON.stringify(soundLibrary));
    log('Saved sound library to storage');
}

function displaySoundLibrary(category = 'all') {
    const soundList = document.getElementById('sound-list');
    soundList.innerHTML = '';
    
    let sounds = [];
    if (category === 'all') {
        Object.values(soundLibrary).forEach(catSounds => {
            sounds = sounds.concat(catSounds);
        });
    } else if (soundLibrary[category]) {
        sounds = soundLibrary[category];
    }
    
    sounds.forEach(sound => {
        const soundItem = document.createElement('div');
        soundItem.className = 'sound-item';
        soundItem.innerHTML = `
            <span class="sound-name">${sound.name}</span>
            <div class="sound-buttons">
                <button class="sound-action-btn edit-sound-btn" data-sound-id="${sound.id}">Edit</button>
                <button class="sound-action-btn load-sound-btn" data-sound-id="${sound.id}">Load</button>
                <button class="sound-action-btn play-preview-btn" data-sound-id="${sound.id}">▶</button>
                <button class="sound-action-btn delete-sound-btn" data-sound-id="${sound.id}">🗑️</button>
            </div>
        `;
        
        soundItem.querySelector('.load-sound-btn').addEventListener('click', () => {
            showTrackPicker(sound);
        });
        
        soundItem.querySelector('.play-preview-btn').addEventListener('click', () => {
            previewSound(sound);
        });
        
        soundItem.querySelector('.edit-sound-btn').addEventListener('click', () => {
            openAudioEditor(sound);
        });
        
        soundItem.querySelector('.delete-sound-btn').addEventListener('click', () => {
            deleteSound(sound);
        });
        
        soundList.appendChild(soundItem);
    });
    
    log(`Displayed ${sounds.length} sounds in library`);
}

// Audio Editor Functions
async function openAudioEditor(sound) {
    log(`Opening audio editor for: ${sound.name}`);
    
    try {
        currentEditingSound = sound;
        
        // Create audio context if needed
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Load and decode audio data
        const audioData = await loadAudioData(sound.url);
        audioBuffer = await audioContext.decodeAudioData(audioData);
        
        // Set initial trim points - end marker at 90% so it's visible
        startTime = 0;
        endTime = audioBuffer.duration * 0.9;
        
        // Show modal
        const modal = document.getElementById('audio-editor-modal');
        modal.style.display = 'block';
        
        // Draw waveform
        drawWaveform();
        
        // Setup event listeners
        setupAudioEditorEvents();
        
        // Update time display
        updateTimeDisplay();
        
        log(`Audio editor opened - Duration: ${audioBuffer.duration.toFixed(2)}s`);
        
    } catch (error) {
        log(`ERROR: Failed to open audio editor:`, error);
        showMessage(`Failed to load audio for editing: ${error.message}`, 'error');
    }
}

async function loadAudioData(url) {
    if (url.startsWith('data:')) {
        // Convert base64 to ArrayBuffer
        const response = await fetch(url);
        return await response.arrayBuffer();
    } else {
        // Handle blob URLs or other URLs
        const response = await fetch(url);
        return await response.arrayBuffer();
    }
}

function drawWaveform() {
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);
    
    if (!audioBuffer) return;
    
    // Get audio data
    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const samples = channelData.length;
    const samplesPerPixel = samples / width;
    
    // Draw waveform
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    for (let x = 0; x < width; x++) {
        const sampleIndex = Math.floor(x * samplesPerPixel);
        const sample = channelData[sampleIndex] || 0;
        const y = (height / 2) + (sample * height / 2);
        
        if (x === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.stroke();
    
    // Draw center line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    
    // Update marker positions
    updateMarkerPositions();
}

function updateMarkerPositions() {
    const duration = audioBuffer.duration;
    const startPercent = (startTime / duration) * 100;
    const endPercent = (endTime / duration) * 100;
    
    // Ensure markers stay within visible bounds (2px margin from edges)
    const containerWidth = document.querySelector('.waveform-container').offsetWidth;
    const markerWidth = 4; // marker width in pixels
    const maxPercent = ((containerWidth - markerWidth) / containerWidth) * 100;
    
    document.getElementById('start-marker').style.left = Math.min(startPercent, maxPercent) + '%';
    document.getElementById('end-marker').style.left = Math.min(endPercent, maxPercent) + '%';
    
    log(`Markers positioned - Start: ${startPercent.toFixed(1)}%, End: ${endPercent.toFixed(1)}%`);
}

function setupAudioEditorEvents() {
    // Close button
    document.getElementById('close-audio-editor').onclick = closeAudioEditor;
    
    // Play buttons
    document.getElementById('play-original-btn').onclick = playOriginalAudio;
    document.getElementById('play-trimmed-btn').onclick = playTrimmedAudio;
    document.getElementById('save-trimmed-btn').onclick = saveTrimmedAudio;
    
    // Marker dragging - remove any existing listeners first
    const startMarker = document.getElementById('start-marker');
    const endMarker = document.getElementById('end-marker');
    
    // Clone nodes to remove all event listeners
    const newStartMarker = startMarker.cloneNode(true);
    const newEndMarker = endMarker.cloneNode(true);
    startMarker.parentNode.replaceChild(newStartMarker, startMarker);
    endMarker.parentNode.replaceChild(newEndMarker, endMarker);
    
    // Add fresh event listeners
    const startMarkerNew = document.getElementById('start-marker');
    const endMarkerNew = document.getElementById('end-marker');
    
    // Mouse events
    startMarkerNew.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startDrag(e, 'start');
    });
    
    endMarkerNew.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startDrag(e, 'end');
    });
    
    // Touch events
    startMarkerNew.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrag(e, 'start');
    });
    
    endMarkerNew.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrag(e, 'end');
    });
    
    log('Audio editor event listeners set up');
}

function startDrag(e, target) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    
    isDragging = true;
    dragTarget = target;
    
    log(`Started dragging ${target} marker`);
    
    // Add global event listeners for dragging
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleEndDrag);
    document.addEventListener('touchmove', handleTouchDrag, { passive: false });
    document.addEventListener('touchend', handleEndDrag);
}

function handleDrag(e) {
    e.preventDefault();
    if (!isDragging || !dragTarget) return;
    
    const clientX = e.clientX;
    updateMarkerPosition(clientX);
}

function handleTouchDrag(e) {
    e.preventDefault();
    if (!isDragging || !dragTarget || !e.touches[0]) return;
    
    const clientX = e.touches[0].clientX;
    updateMarkerPosition(clientX);
}

function updateMarkerPosition(clientX) {
    const container = document.querySelector('.waveform-container');
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    
    const duration = audioBuffer.duration;
    const time = (percent / 100) * duration;
    
    if (dragTarget === 'start') {
        startTime = Math.max(0, Math.min(time, endTime - 0.1)); // Ensure minimum 0.1s duration
    } else {
        endTime = Math.min(duration, Math.max(time, startTime + 0.1));
    }
    
    updateMarkerPositions();
    updateTimeDisplay();
}

function handleEndDrag(e) {
    if (isDragging) {
        log(`Finished dragging ${dragTarget} marker`);
        isDragging = false;
        dragTarget = null;
        
        // Remove global event listeners
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleEndDrag);
        document.removeEventListener('touchmove', handleTouchDrag);
        document.removeEventListener('touchend', handleEndDrag);
    }
}

function updateTimeDisplay() {
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(2);
        return `${mins}:${secs.padStart(5, '0')}`;
    };
    
    document.getElementById('start-time').textContent = formatTime(startTime);
    document.getElementById('end-time').textContent = formatTime(endTime);
    document.getElementById('duration-info').textContent = formatTime(endTime - startTime);
}

async function playOriginalAudio() {
    if (!audioBuffer || !audioContext) return;
    
    const duration = audioBuffer.duration;
    log(`Playing FULL ORIGINAL audio - Duration: ${duration.toFixed(2)}s`);
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
    
    // Update button text to show playing
    const btn = document.getElementById('play-original-btn');
    const originalText = btn.textContent;
    btn.textContent = `🔊 Playing Full (${duration.toFixed(1)}s)...`;
    btn.disabled = true;
    
    // Reset button after audio ends
    setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    }, duration * 1000);
}

async function playTrimmedAudio() {
    if (!audioBuffer || !audioContext) return;
    
    const trimDuration = endTime - startTime;
    log(`Playing TRIMMED ONLY: ${startTime.toFixed(2)}s to ${endTime.toFixed(2)}s (${trimDuration.toFixed(2)}s duration)`);
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0, startTime, trimDuration);
    
    // Update button text to show playing
    const btn = document.getElementById('play-trimmed-btn');
    const originalText = btn.textContent;
    btn.textContent = `🔊 Playing Trim (${trimDuration.toFixed(1)}s)...`;
    btn.disabled = true;
    
    // Reset button after audio ends
    setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    }, trimDuration * 1000);
}

async function saveTrimmedAudio() {
    if (!audioBuffer || !currentEditingSound) return;
    
    try {
        log('Creating trimmed audio...');
        
        // Create new buffer with trimmed duration
        const trimmedDuration = endTime - startTime;
        const sampleRate = audioBuffer.sampleRate;
        const trimmedBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            trimmedDuration * sampleRate,
            sampleRate
        );
        
        // Copy trimmed audio data
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const originalData = audioBuffer.getChannelData(channel);
            const trimmedData = trimmedBuffer.getChannelData(channel);
            const startSample = Math.floor(startTime * sampleRate);
            
            for (let i = 0; i < trimmedData.length; i++) {
                trimmedData[i] = originalData[startSample + i] || 0;
            }
        }
        
        // Convert to WAV blob
        const wavBlob = bufferToWav(trimmedBuffer);
        const base64Data = await blobToBase64(wavBlob);
        
        // Update the sound in library
        const trimmedName = `${currentEditingSound.name} (Trimmed)`;
        const trimmedSound = {
            ...currentEditingSound,
            id: Date.now().toString(),
            name: trimmedName,
            url: base64Data,
            originalId: currentEditingSound.id
        };
        
        // Add to library
        if (!soundLibrary.user) {
            soundLibrary.user = [];
        }
        soundLibrary.user.push(trimmedSound);
        saveSoundLibrary();
        
        log(`Saved trimmed audio: ${trimmedName}`);
        showMessage(`Trimmed audio saved as: ${trimmedName}`, 'success');
        
        // Refresh sound library display
        displaySoundLibrary();
        closeAudioEditor();
        
    } catch (error) {
        log(`ERROR: Failed to save trimmed audio:`, error);
        showMessage(`Failed to save trimmed audio: ${error.message}`, 'error');
    }
}

function bufferToWav(buffer) {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV file header
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * 2, true);
    
    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample * 0x7FFF, true);
            offset += 2;
        }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function closeAudioEditor() {
    const modal = document.getElementById('audio-editor-modal');
    modal.style.display = 'none';
    
    currentEditingSound = null;
    audioBuffer = null;
    startTime = 0;
    endTime = 0;
    
    log('Audio editor closed');
}

// Track Picker Functions
let selectedSoundForLoading = null;

function showTrackPicker(sound) {
    selectedSoundForLoading = sound;
    const modal = document.getElementById('track-picker-modal');
    modal.style.display = 'block';
    
    // Setup event listeners
    document.getElementById('close-track-picker').onclick = closeTrackPicker;
    
    // Setup track buttons
    document.querySelectorAll('.track-picker-btn').forEach(btn => {
        btn.onclick = () => {
            const trackIndex = parseInt(btn.dataset.track);
            loadSoundToTrack(sound, trackIndex);
            closeTrackPicker();
        };
    });
    
    log(`Track picker opened for: ${sound.name}`);
}

function closeTrackPicker() {
    const modal = document.getElementById('track-picker-modal');
    modal.style.display = 'none';
    selectedSoundForLoading = null;
    log('Track picker closed');
}

// Updated loadSoundToTrack function
async function loadSoundToTrack(sound, trackIndex = null) {
    if (trackIndex === null) {
        showTrackPicker(sound);
        return;
    }
    
    try {
        // Check if URL is expired
        if (sound.url.startsWith('blob:')) {
            showMessage(`Sound "${sound.name}" is no longer available (expired). Please regenerate it.`, 'error');
            return;
        }
        
        if (audioEngine) {
            await audioEngine.loadSample(trackIndex, sound.url, sound.name);
            showMessage(`Loaded "${sound.name}" to Track ${trackIndex + 1}`, 'success');
            log(`Loaded sound "${sound.name}" to track ${trackIndex + 1} from library`);
        } else {
            showMessage('Audio engine not ready yet', 'error');
        }
    } catch (error) {
        log(`ERROR: Failed to load sound to track:`, error);
        showMessage(`Failed to load sound: ${error.message}`, 'error');
    }
}

// Delete Sound Function
function deleteSound(sound) {
    showConfirmMessage(
        `Delete "${sound.name}"? This cannot be undone.`,
        () => {
            // Find and remove the sound from the library
            Object.keys(soundLibrary).forEach(category => {
                if (Array.isArray(soundLibrary[category])) {
                    soundLibrary[category] = soundLibrary[category].filter(s => s.id !== sound.id);
                }
            });
            
            saveSoundLibrary();
            displaySoundLibrary();
            showMessage(`Deleted "${sound.name}"`, 'success');
            log(`Deleted sound: ${sound.name}`);
        }
    );
}

// Custom Message System
function showMessage(text, type = 'info') {
    const messageEl = document.getElementById('custom-message');
    const messageText = document.getElementById('message-text');
    const messageContent = messageEl.querySelector('.message-content');
    
    messageText.textContent = text;
    messageContent.className = `message-content ${type}`;
    messageEl.style.display = 'block';
    
    // Auto-hide after 4 seconds
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 4000);
    
    // Setup close button
    document.getElementById('message-close').onclick = () => {
        messageEl.style.display = 'none';
    };
    
    log(`Message (${type}): ${text}`);
}

function showConfirmMessage(text, onConfirm) {
    const messageEl = document.getElementById('custom-message');
    const messageContent = messageEl.querySelector('.message-content');
    
    // Create custom confirm dialog
    messageContent.innerHTML = `
        <span>${text}</span>
        <div style="margin-left: 15px;">
            <button id="confirm-yes" style="background: #4a7c4a; border: none; color: white; padding: 5px 10px; margin-right: 5px; border-radius: 3px; cursor: pointer;">Yes</button>
            <button id="confirm-no" style="background: #7c4a4a; border: none; color: white; padding: 5px 10px; border-radius: 3px; cursor: pointer;">No</button>
        </div>
    `;
    
    messageContent.className = 'message-content';
    messageEl.style.display = 'block';
    
    document.getElementById('confirm-yes').onclick = () => {
        messageEl.style.display = 'none';
        onConfirm();
    };
    
    document.getElementById('confirm-no').onclick = () => {
        messageEl.style.display = 'none';
    };
}

function filterSoundsByCategory(category) {
    displaySoundLibrary(category);
}

function addCategory(categoryName) {
    if (!soundLibrary[categoryName]) {
        soundLibrary[categoryName] = [];
        saveSoundLibrary();
        
        // Add category button
        const btn = document.createElement('button');
        btn.className = 'category-btn';
        btn.dataset.category = categoryName;
        btn.textContent = categoryName;
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            filterSoundsByCategory(categoryName);
        });
        
        document.querySelector('.sound-categories').appendChild(btn);
        
        log(`Added new category: ${categoryName}`);
    }
}

async function loadSoundToTrack(sound) {
    if (audioEngine) {
        try {
            await audioEngine.loadSample(selectedTrack, sound.url, sound.name);
            log(`Loaded sound "${sound.name}" to track ${selectedTrack + 1}`);
            closeSoundLibraryModal();
        } catch (error) {
            log('ERROR: Failed to load sound:', error);
            alert('Failed to load sound');
        }
    }
}

function previewSound(sound) {
    const audio = new Audio(sound.url);
    audio.play();
    log(`Previewing sound: ${sound.name}`);
}


// Utility function to handle window resize
window.addEventListener('resize', () => {
    // Adjust UI elements as needed
});

// Error handling
window.addEventListener('error', (e) => {
    log('ERROR:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    log('ERROR: Unhandled promise rejection:', e.reason);
});

// Test function to debug button issues
function testButtonFunctionality() {
    log('=== TESTING BUTTON FUNCTIONALITY ===');
    
    // Test sound generation buttons
    const soundGenBtns = document.querySelectorAll('.sound-gen-btn');
    log(`Found ${soundGenBtns.length} sound generation buttons`);
    
    soundGenBtns.forEach((btn, index) => {
        log(`Button ${index + 1}: track=${btn.dataset.track}, class=${btn.className}, text=${btn.textContent}`);
    });
    
    // Test sound library button
    const soundsBtn = document.getElementById('sounds-btn');
    if (soundsBtn) {
        log(`Sound library button found: text="${soundsBtn.textContent}"`);
    } else {
        log('ERROR: Sound library button not found');
    }
    
    // Test modals
    const genModal = document.querySelector('.sound-gen-modal');
    const libModal = document.getElementById('sound-library-modal');
    
    log(`Sound generation modal found: ${!!genModal}`);
    log(`Sound library modal found: ${!!libModal}`);
    
    // Add click test for first button
    if (soundGenBtns.length > 0) {
        const firstBtn = soundGenBtns[0];
        log('Adding test click listener to first sound gen button...');
        
        firstBtn.addEventListener('click', (e) => {
            log('TEST: First sound gen button was clicked!');
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    log('=== END TESTING ===');
}

// Initialize audio engine on first user interaction
async function initializeAudioOnce() {
    if (!audioEngine || audioEngine.isInitialized) {
        return;
    }
    
    log('User interaction detected, initializing audio engine...');
    
    try {
        await audioEngine.initialize();
        log('Audio engine initialized successfully after user interaction');
        
        // Load any pending samples
        if (audioEngine.pendingSamples) {
            log('Loading pending samples...');
            for (const [trackIndex, sampleData] of Object.entries(audioEngine.pendingSamples)) {
                try {
                    await audioEngine.loadSample(parseInt(trackIndex), sampleData.url, sampleData.name);
                } catch (error) {
                    log(`Failed to load pending sample for track ${parseInt(trackIndex) + 1}:`, error);
                }
            }
            audioEngine.pendingSamples = {};
        }
    } catch (error) {
        log('ERROR: Failed to initialize audio engine after user interaction:', error);
    }
}

// ===== BEAT SEQUENCER FUNCTIONS =====

function setupBeatSequencer() {
    log('Setting up beat sequencer...');
    
    // Initialize sequencer state for all tracks
    for (let i = 0; i < 8; i++) {
        beatSequencer.sequence[i] = new Array(16).fill(false);
        beatSequencer.muted[i] = false;
        beatSequencer.solo[i] = false;
        beatSequencer.volumes[i] = 70;
    }
    
    // Setup sequencer toggle
    document.getElementById('seq-toggle-btn').addEventListener('click', toggleSequencerVisibility);
    
    // Setup transport controls
    document.getElementById('seq-play-btn').addEventListener('click', startSequencer);
    document.getElementById('seq-stop-btn').addEventListener('click', stopSequencer);
    document.getElementById('seq-clear-btn').addEventListener('click', clearSequencer);
    
    // Setup pattern length control
    document.getElementById('pattern-length').addEventListener('change', (e) => {
        setPatternLength(parseInt(e.target.value));
    });
    
    // Setup swing control
    document.getElementById('swing-control').addEventListener('input', (e) => {
        const swing = parseInt(e.target.value);
        beatSequencer.swing = swing;
        document.getElementById('swing-value').textContent = swing + '%';
        log(`Swing set to: ${swing}%`);
    });
    
    // Generate step grid
    generateStepGrid();
    
    // Setup track controls
    setupSequencerTrackControls();
    
    log('Beat sequencer setup complete');
}

function toggleSequencerVisibility() {
    const grid = document.querySelector('.sequencer-grid');
    const btn = document.getElementById('seq-toggle-btn');
    
    if (grid.style.display === 'none') {
        grid.style.display = 'block';
        btn.textContent = 'Hide Sequencer';
        log('Sequencer shown');
    } else {
        grid.style.display = 'none';
        btn.textContent = 'Show Sequencer';
        log('Sequencer hidden');
    }
}

function generateStepGrid() {
    log(`Generating step grid for ${beatSequencer.patternLength} steps...`);
    
    // Generate step numbers
    const stepNumbers = document.querySelector('.step-numbers');
    stepNumbers.innerHTML = '';
    
    for (let i = 0; i < beatSequencer.patternLength; i++) {
        const stepNum = document.createElement('div');
        stepNum.className = 'step-number';
        stepNum.textContent = i + 1;
        
        // Highlight every 4th step (downbeats)
        if (i % 4 === 0) {
            stepNum.classList.add('downbeat');
        }
        
        stepNumbers.appendChild(stepNum);
    }
    
    // Generate step buttons for each track
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
        const stepsContainer = document.querySelector(`.seq-steps[data-track="${trackIndex}"]`);
        stepsContainer.innerHTML = '';
        
        // Ensure sequence array is correct length
        beatSequencer.sequence[trackIndex] = new Array(beatSequencer.patternLength).fill(false);
        
        for (let stepIndex = 0; stepIndex < beatSequencer.patternLength; stepIndex++) {
            const stepBtn = document.createElement('button');
            stepBtn.className = 'seq-step';
            stepBtn.dataset.track = trackIndex;
            stepBtn.dataset.step = stepIndex;
            
            // Highlight every 4th step (downbeats)
            if (stepIndex % 4 === 0) {
                stepBtn.classList.add('downbeat');
            }
            
            stepBtn.addEventListener('click', () => toggleStep(trackIndex, stepIndex));
            stepsContainer.appendChild(stepBtn);
        }
    }
    
    log(`Generated ${beatSequencer.patternLength} steps for 8 tracks`);
}

function toggleStep(trackIndex, stepIndex) {
    const isActive = beatSequencer.sequence[trackIndex][stepIndex];
    beatSequencer.sequence[trackIndex][stepIndex] = !isActive;
    
    const stepBtn = document.querySelector(`.seq-step[data-track="${trackIndex}"][data-step="${stepIndex}"]`);
    if (stepBtn) {
        stepBtn.classList.toggle('active', !isActive);
    }
    
    log(`Track ${trackIndex + 1}, Step ${stepIndex + 1}: ${!isActive ? 'ON' : 'OFF'}`);
}

function setupSequencerTrackControls() {
    // Mute buttons
    document.querySelectorAll('.seq-track-mute').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            toggleMute(trackIndex);
        });
    });
    
    // Solo buttons
    document.querySelectorAll('.seq-track-solo').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            toggleSolo(trackIndex);
        });
    });
    
    // Volume sliders
    document.querySelectorAll('.seq-track-volume').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const trackIndex = parseInt(e.target.dataset.track);
            const volume = parseInt(e.target.value);
            setTrackVolume(trackIndex, volume);
        });
    });
}

function toggleMute(trackIndex) {
    beatSequencer.muted[trackIndex] = !beatSequencer.muted[trackIndex];
    
    const muteBtn = document.querySelector(`.seq-track-mute[data-track="${trackIndex}"]`);
    if (muteBtn) {
        muteBtn.classList.toggle('active', beatSequencer.muted[trackIndex]);
    }
    
    log(`Track ${trackIndex + 1} ${beatSequencer.muted[trackIndex] ? 'MUTED' : 'UNMUTED'}`);
}

function toggleSolo(trackIndex) {
    beatSequencer.solo[trackIndex] = !beatSequencer.solo[trackIndex];
    
    const soloBtn = document.querySelector(`.seq-track-solo[data-track="${trackIndex}"]`);
    if (soloBtn) {
        soloBtn.classList.toggle('active', beatSequencer.solo[trackIndex]);
    }
    
    // If any track is soloed, mute all others in playback
    const hasSolo = Object.values(beatSequencer.solo).some(s => s);
    log(`Track ${trackIndex + 1} ${beatSequencer.solo[trackIndex] ? 'SOLO ON' : 'SOLO OFF'} - Any solo: ${hasSolo}`);
}

function setTrackVolume(trackIndex, volume) {
    beatSequencer.volumes[trackIndex] = volume;
    log(`Track ${trackIndex + 1} volume: ${volume}`);
}

function setPatternLength(length) {
    beatSequencer.patternLength = length;
    
    // Resize all sequence arrays
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
        const currentPattern = beatSequencer.sequence[trackIndex] || [];
        beatSequencer.sequence[trackIndex] = new Array(length).fill(false);
        
        // Copy existing pattern data
        for (let i = 0; i < Math.min(currentPattern.length, length); i++) {
            beatSequencer.sequence[trackIndex][i] = currentPattern[i];
        }
    }
    
    // Regenerate grid
    generateStepGrid();
    
    log(`Pattern length set to: ${length} steps`);
}

function startSequencer() {
    if (beatSequencer.isPlaying) {
        log('Sequencer already playing');
        return;
    }
    
    if (!audioEngine || !audioEngine.isInitialized) {
        log('ERROR: Audio engine not ready');
        return;
    }
    
    beatSequencer.isPlaying = true;
    beatSequencer.currentStep = 0;
    beatSequencer.nextStepTime = Tone.context.currentTime;
    
    // Update UI
    document.getElementById('seq-play-btn').textContent = '⏸';
    document.getElementById('seq-play-btn').classList.add('playing');
    
    // Start Tone.js transport if needed
    if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
    }
    
    // Start step scheduler
    scheduleNextStep();
    beatSequencer.stepScheduler = setInterval(scheduleNextStep, beatSequencer.lookAhead);
    
    log('Beat sequencer started');
}

function stopSequencer() {
    if (!beatSequencer.isPlaying) {
        return;
    }
    
    beatSequencer.isPlaying = false;
    beatSequencer.currentStep = 0;
    
    // Clear scheduler
    if (beatSequencer.stepScheduler) {
        clearInterval(beatSequencer.stepScheduler);
        beatSequencer.stepScheduler = null;
    }
    
    // Update UI
    document.getElementById('seq-play-btn').textContent = '▶';
    document.getElementById('seq-play-btn').classList.remove('playing');
    updatePlayhead();
    
    log('Beat sequencer stopped');
}

function clearSequencer() {
    // Clear all steps
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
        beatSequencer.sequence[trackIndex] = new Array(beatSequencer.patternLength).fill(false);
    }
    
    // Update UI
    document.querySelectorAll('.seq-step').forEach(btn => {
        btn.classList.remove('active');
    });
    
    log('Sequencer cleared');
}

function scheduleNextStep() {
    while (beatSequencer.nextStepTime < Tone.context.currentTime + beatSequencer.scheduleAheadTime) {
        scheduleStep(beatSequencer.currentStep, beatSequencer.nextStepTime);
        
        // Calculate next step timing with swing
        const stepDuration = (60 / Tone.Transport.bpm.value) / 4; // 16th note duration
        let swingOffset = 0;
        
        if (beatSequencer.swing > 0 && beatSequencer.currentStep % 2 === 1) {
            // Apply swing to odd steps (off-beats)
            swingOffset = (stepDuration * beatSequencer.swing / 100) * 0.3;
        }
        
        beatSequencer.nextStepTime += stepDuration + swingOffset;
        beatSequencer.currentStep = (beatSequencer.currentStep + 1) % beatSequencer.patternLength;
    }
    
    // Update playhead in UI
    requestAnimationFrame(updatePlayhead);
}

function scheduleStep(stepIndex, time) {
    // Check if any tracks have this step active
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
        if (beatSequencer.sequence[trackIndex][stepIndex]) {
            // Check mute/solo state
            const hasSolo = Object.values(beatSequencer.solo).some(s => s);
            const shouldPlay = !beatSequencer.muted[trackIndex] && 
                             (!hasSolo || beatSequencer.solo[trackIndex]);
            
            if (shouldPlay && audioEngine && audioEngine.tracks[trackIndex]) {
                const track = audioEngine.tracks[trackIndex];
                if (track.sample) {
                    // Use the sequencer volume
                    const volume = beatSequencer.volumes[trackIndex] / 100;
                    playSequencerStep(trackIndex, volume, time);
                }
            }
        }
    }
}

function playSequencerStep(trackIndex, volume, time) {
    try {
        // Use the enhanced audio engine method
        const player = audioEngine.playSequencerSample(trackIndex, volume, time);
        if (player) {
            log(`Sequencer step played: Track ${trackIndex + 1}, Volume: ${volume.toFixed(2)}`);
        }
    } catch (error) {
        log(`ERROR: Failed to play sequencer step for track ${trackIndex + 1}:`, error);
    }
}

function updatePlayhead() {
    const playhead = document.getElementById('sequencer-playhead');
    if (!playhead || !beatSequencer.isPlaying) {
        if (playhead) playhead.style.display = 'none';
        return;
    }
    
    const stepWidth = 100 / beatSequencer.patternLength;
    const position = beatSequencer.currentStep * stepWidth;
    
    playhead.style.display = 'block';
    playhead.style.left = position + '%';
    
    // Highlight current step
    document.querySelectorAll('.seq-step').forEach(btn => {
        btn.classList.remove('current');
    });
    
    document.querySelectorAll(`[data-step="${beatSequencer.currentStep}"]`).forEach(btn => {
        if (btn.classList.contains('seq-step')) {
            btn.classList.add('current');
        }
    });
}