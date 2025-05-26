// Proper app initialization that works around the broken script.js structure
debugLog.log('App-init.js starting...');

// Global variables that need to be accessible
window.canvas = null;
window.ctx = null;
window.audioEngine = null;
window.rowHeight = 0;
window.numTracks = 8;
window.mouseDown = false;

// Initialize when DOM is ready
function initializeApp() {
    debugLog.log('Initializing app...');
    debugLog.log('Document ready state: ' + document.readyState);
    
    // Debug what's happening
    debugLog.log('Trying to get canvas...');
    const canvasElement = document.getElementById('particleCanvas');
    debugLog.log('Canvas element result: ' + canvasElement);
    debugLog.log('Canvas element type: ' + typeof canvasElement);
    
    // Get canvas
    debugLog.log('window.canvas before assignment: ' + window.canvas);
    debugLog.log('canvasElement is: ' + canvasElement);
    window.canvas = canvasElement;
    debugLog.log('window.canvas after assignment: ' + window.canvas);
    debugLog.log('Testing direct access: ' + (window.canvas === canvasElement));
    
    if (!window.canvas) {
        debugLog.log('ERROR: Canvas not found or not assigned to window.canvas');
        
        // Try again with a delay
        setTimeout(() => {
            debugLog.log('Retrying canvas initialization...');
            window.canvas = document.getElementById('particleCanvas');
            if (window.canvas) {
                debugLog.log('Canvas found on retry!');
                initializeApp(); // Try again
            } else {
                debugLog.log('Canvas still not found on retry');
            }
        }, 500);
        return;
    }
    
    window.ctx = window.canvas.getContext('2d');
    if (!window.ctx) {
        debugLog.log('ERROR: Could not get canvas context');
        return;
    }
    
    // Set canvas size
    window.canvas.width = window.innerWidth - 400;
    window.canvas.height = window.innerHeight - 60;
    window.rowHeight = window.canvas.height / window.numTracks;
    
    debugLog.log('Canvas ready: ' + window.canvas.width + 'x' + window.canvas.height);
    
    // Initialize audio engine
    try {
        if (window.ToneAudioEngine) {
            debugLog.log('Creating Tone.js audio engine...');
            window.audioEngine = new ToneAudioEngine();
            debugLog.log('Tone.js audio engine created');
        } else {
            debugLog.log('Creating legacy audio engine...');
            window.audioEngine = new AudioEngine();
        }
    } catch (error) {
        debugLog.log('ERROR creating audio engine: ' + error.message);
        return;
    }
    
    // Set up the main animation
    const particles = [];
    const touches = new Map();
    
    function animate() {
        // Clear canvas
        window.ctx.fillStyle = '#111';
        window.ctx.fillRect(0, 0, window.canvas.width, window.canvas.height);
        
        // Draw track dividers (horizontal lines)
        window.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        window.ctx.lineWidth = 1;
        for (let i = 0; i <= window.numTracks; i++) {
            const y = i * window.rowHeight;
            window.ctx.beginPath();
            window.ctx.moveTo(0, y);
            window.ctx.lineTo(window.canvas.width, y);
            window.ctx.stroke();
        }
        
        // Draw vertical lines (for note positions)
        const numVerticalLines = 16; // 16 vertical divisions
        for (let i = 0; i <= numVerticalLines; i++) {
            const x = (i / numVerticalLines) * window.canvas.width;
            window.ctx.beginPath();
            window.ctx.moveTo(x, 0);
            window.ctx.lineTo(x, window.canvas.height);
            window.ctx.stroke();
        }
        
        // Draw track labels
        window.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        window.ctx.font = '14px Arial';
        const instruments = ['Synth', 'Piano', 'Strings', 'Bells', 'Pad', 'Lead', 'Pluck', 'Bass'];
        for (let i = 0; i < window.numTracks; i++) {
            const y = i * window.rowHeight + window.rowHeight / 2;
            window.ctx.fillText(instruments[i], 10, y + 5);
        }
        
        // Update and draw particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const particle = particles[i];
            
            // Update position
            particle.x += particle.vx || 0;
            particle.y += particle.vy || 0;
            particle.life -= 0.02;
            
            // Draw particle
            window.ctx.globalAlpha = particle.life;
            window.ctx.fillStyle = particle.color || '#fff';
            window.ctx.beginPath();
            window.ctx.arc(particle.x, particle.y, particle.size || 5, 0, Math.PI * 2);
            window.ctx.fill();
            
            // Remove dead particles
            if (particle.life <= 0) {
                particles.splice(i, 1);
            }
        }
        
        window.ctx.globalAlpha = 1;
        requestAnimationFrame(animate);
    }
    
    // Handle mouse/touch events
    async function handleInteraction(x, y, id, isEnd = false) {
        if (isEnd) {
            if (window.audioEngine.stopNote) {
                window.audioEngine.stopNote(id);
            }
            touches.delete(id);
            return;
        }
        
        // Get track from Y position
        const trackIndex = Math.min(Math.floor(y / window.rowHeight), window.numTracks - 1);
        
        // Create particles
        const colors = ['#ff00ff', '#00ffff', '#ffff00', '#ff6600', '#00ff00'];
        const color = colors[trackIndex % colors.length];
        
        for (let i = 0; i < 5; i++) {
            particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                color: color,
                life: 1,
                size: Math.random() * 10 + 5
            });
        }
        
        // Play sound
        if (window.audioEngine.playNoteOrSample) {
            try {
                // Use the stored instrument for this track
                const instrumentType = window.trackInstruments ? window.trackInstruments[trackIndex] : 'synth';
                const result = await window.audioEngine.playNoteOrSample(
                    x, y % window.rowHeight, window.canvas.width, window.rowHeight, 
                    id, trackIndex, instrumentType
                );
                debugLog.log('Playing track ' + trackIndex + ' with ' + instrumentType + ' at x:' + x);
            } catch (error) {
                debugLog.log('Error playing note: ' + error.message);
            }
        }
        
        touches.set(id, { x, y, trackIndex });
    }
    
    // Mouse events
    window.canvas.addEventListener('mousedown', async (e) => {
        // Start Tone.js audio context on first user interaction
        if (Tone.context.state !== 'running') {
            await Tone.start();
            debugLog.log('Tone.js started');
        }
        
        const rect = window.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        window.mouseDown = true;
        await handleInteraction(x, y, 'mouse');
    });
    
    window.canvas.addEventListener('mousemove', async (e) => {
        if (window.mouseDown) {
            const rect = window.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Stop the previous note before playing a new one
            if (window.audioEngine.stopNote) {
                window.audioEngine.stopNote('mouse');
            }
            
            await handleInteraction(x, y, 'mouse');
        }
    });
    
    window.canvas.addEventListener('mouseup', () => {
        window.mouseDown = false;
        handleInteraction(0, 0, 'mouse', true);
    });
    
    // Touch events
    window.canvas.addEventListener('touchstart', async (e) => {
        e.preventDefault();
        
        // Start Tone.js audio context on first user interaction
        if (Tone.context.state !== 'running') {
            await Tone.start();
            debugLog.log('Tone.js started');
        }
        
        const rect = window.canvas.getBoundingClientRect();
        for (let touch of e.changedTouches) {
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            await handleInteraction(x, y, touch.identifier);
        }
    }, { passive: false });
    
    window.canvas.addEventListener('touchmove', async (e) => {
        e.preventDefault();
        const rect = window.canvas.getBoundingClientRect();
        for (let touch of e.changedTouches) {
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            
            // Stop the previous note before playing a new one
            if (window.audioEngine.stopNote) {
                window.audioEngine.stopNote(touch.identifier);
            }
            
            await handleInteraction(x, y, touch.identifier);
        }
    }, { passive: false });
    
    window.canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        for (let touch of e.changedTouches) {
            handleInteraction(0, 0, touch.identifier, true);
        }
    }, { passive: false });
    
    // Start animation
    animate();
    
    // Set up sound generation buttons
    setupSoundGeneration();
    
    // Set up view toggles
    setupViewToggles();
    
    // Set up instrument selectors
    setupInstrumentSelectors();
    
    // Set up sound library
    setupSoundLibrary();
    
    debugLog.log('App initialized successfully');
}

// Set up sound generation functionality
function setupSoundGeneration() {
    const soundGenBtns = document.querySelectorAll('.sound-gen-btn');
    const soundGenModal = document.getElementById('sound-gen-modal');
    const generateSoundBtn = document.getElementById('generate-sound');
    const closeSoundGenBtn = document.getElementById('close-sound-gen');
    const soundPromptInput = document.getElementById('sound-prompt');
    let currentGeneratingTrack = 0;
    
    soundGenBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentGeneratingTrack = parseInt(btn.dataset.track);
            soundGenModal.style.display = 'flex';
            soundPromptInput.focus();
        });
    });
    
    closeSoundGenBtn.addEventListener('click', () => {
        soundGenModal.style.display = 'none';
    });
    
    generateSoundBtn.addEventListener('click', async () => {
        const prompt = soundPromptInput.value.trim();
        const apiKey = localStorage.getItem('elevenlabs_api_key');
        const loadingIndicator = document.getElementById('loading-indicator');
        const soundGenSection = document.getElementById('sound-gen-section');
        
        if (!prompt) {
            alert('Please enter a sound description');
            return;
        }
        
        if (!apiKey) {
            alert('ElevenLabs API key not found');
            return;
        }
        
        debugLog.log('Generating sound for track ' + currentGeneratingTrack + ': ' + prompt);
        
        // Show loading
        soundGenSection.style.display = 'none';
        loadingIndicator.style.display = 'block';
        
        try {
            // Call ElevenLabs API
            const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: prompt,
                    duration_seconds: 2.0,
                    prompt_influence: 0.3
                })
            });
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            
            // Get audio data
            const audioData = await response.arrayBuffer();
            
            // Create audio element to play the sound
            const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            // Store the generated sound for later use
            if (!window.generatedSounds) {
                window.generatedSounds = {};
            }
            window.generatedSounds[currentGeneratingTrack] = {
                url: audioUrl,
                prompt: prompt,
                audio: audio
            };
            
            // Update button appearance
            const btn = document.querySelector(`.sound-gen-btn[data-track="${currentGeneratingTrack}"]`);
            if (btn) {
                btn.classList.add('has-sample');
                btn.style.background = '#4CAF50';
            }
            
            debugLog.log('Sound generated successfully for track ' + currentGeneratingTrack);
            
            // Play preview
            audio.play();
            
        } catch (error) {
            debugLog.log('Error generating sound: ' + error.message);
            alert('Error generating sound: ' + error.message);
        } finally {
            // Hide loading and close modal
            loadingIndicator.style.display = 'none';
            soundGenSection.style.display = 'block';
            soundGenModal.style.display = 'none';
            soundPromptInput.value = '';
        }
    });
}

// Set up view toggles
function setupViewToggles() {
    const viewBtns = document.querySelectorAll('.view-btn');
    const multiTrackView = document.querySelector('.multi-track-view');
    const gridSequencer = document.querySelector('.grid-sequencer');
    const singleTrackView = document.querySelector('.single-track-view');
    
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            debugLog.log('Switching to view: ' + view);
            
            // Remove active class from all buttons
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Hide all views
            multiTrackView.style.display = 'none';
            gridSequencer.style.display = 'none';
            singleTrackView.style.display = 'none';
            
            // Show selected view
            switch(view) {
                case 'multi':
                    multiTrackView.style.display = 'block';
                    break;
                case 'grid':
                    gridSequencer.style.display = 'block';
                    break;
                case 'single':
                    singleTrackView.style.display = 'block';
                    break;
            }
        });
    });
}

// Set up instrument selectors
function setupInstrumentSelectors() {
    const instrumentSelects = document.querySelectorAll('.instrument-select');
    
    // Store current instruments for each track
    if (!window.trackInstruments) {
        window.trackInstruments = ['synth', 'piano', 'strings', 'bells', 'pad', 'lead', 'pluck', 'bass'];
    }
    
    instrumentSelects.forEach(select => {
        select.addEventListener('change', (e) => {
            const trackIndex = parseInt(select.dataset.track);
            const instrumentType = e.target.value;
            
            debugLog.log('Changing track ' + trackIndex + ' to instrument: ' + instrumentType);
            
            // Update stored instrument
            window.trackInstruments[trackIndex] = instrumentType;
            
            if (window.audioEngine && window.audioEngine.changeInstrument) {
                window.audioEngine.changeInstrument(trackIndex, instrumentType);
            }
            
            // Update any other instrument selectors for the same track
            document.querySelectorAll(`.instrument-select[data-track="${trackIndex}"]`).forEach(otherSelect => {
                if (otherSelect !== select) {
                    otherSelect.value = instrumentType;
                }
            });
            
            // If single track view is showing this track, update it too
            const singleTrackSelect = document.getElementById('single-track-select');
            if (singleTrackSelect && parseInt(singleTrackSelect.value) === trackIndex) {
                debugLog.log('Updating single track view instrument');
                // Trigger any single track view updates here if needed
            }
        });
    });
}

// Set up sound library
function setupSoundLibrary() {
    const soundsBtn = document.getElementById('sounds-btn');
    const soundLibraryModal = document.getElementById('sound-library-modal');
    const closeSoundLibraryBtn = document.getElementById('close-sound-library');
    const soundList = document.getElementById('sound-list');
    const categoryBtns = document.querySelectorAll('.category-btn');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const importSoundBtn = document.getElementById('import-sound-btn');
    
    // Open modal when Sounds button is clicked
    soundsBtn.addEventListener('click', () => {
        soundLibraryModal.style.display = 'flex';
    });
    
    // Close modal
    closeSoundLibraryBtn.addEventListener('click', () => {
        soundLibraryModal.style.display = 'none';
    });
    
    // Default sounds for each category
    const defaultSounds = {
        all: [],
        bass: ['Deep Bass', 'Sub Bass', 'Synth Bass', 'Electric Bass'],
        lead: ['Saw Lead', 'Square Lead', 'Pluck Lead', 'Bright Lead'],
        pad: ['Warm Pad', 'String Pad', 'Choir Pad', 'Ambient Pad'],
        drums: ['Kick', 'Snare', 'Hi-Hat', 'Crash'],
        fx: ['Sweep', 'Riser', 'Impact', 'Noise'],
        user: []
    };
    
    let currentCategory = 'all';
    let selectedSound = null;
    
    // Load sounds for a category
    function loadSounds(category) {
        soundList.innerHTML = '';
        
        let sounds = [];
        if (category === 'all') {
            // Combine all sounds
            Object.keys(defaultSounds).forEach(cat => {
                if (cat !== 'all') {
                    sounds = sounds.concat(defaultSounds[cat]);
                }
            });
        } else {
            sounds = defaultSounds[category] || [];
        }
        
        sounds.forEach(sound => {
            const soundItem = document.createElement('div');
            soundItem.className = 'sound-item';
            soundItem.textContent = sound;
            soundItem.addEventListener('click', () => {
                // Remove previous selection
                document.querySelectorAll('.sound-item').forEach(item => {
                    item.classList.remove('selected');
                });
                soundItem.classList.add('selected');
                selectedSound = sound;
                debugLog.log('Selected sound: ' + sound);
            });
            soundList.appendChild(soundItem);
        });
    }
    
    // Category button clicks
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.category;
            loadSounds(currentCategory);
        });
    });
    
    // Add category button
    addCategoryBtn.addEventListener('click', () => {
        const name = prompt('Enter new category name:');
        if (name && !defaultSounds[name.toLowerCase()]) {
            defaultSounds[name.toLowerCase()] = [];
            
            // Create new category button
            const newBtn = document.createElement('button');
            newBtn.className = 'category-btn';
            newBtn.dataset.category = name.toLowerCase();
            newBtn.textContent = name;
            newBtn.addEventListener('click', () => {
                categoryBtns.forEach(b => b.classList.remove('active'));
                newBtn.classList.add('active');
                currentCategory = name.toLowerCase();
                loadSounds(currentCategory);
            });
            
            document.querySelector('.sound-categories').appendChild(newBtn);
            debugLog.log('Added category: ' + name);
        }
    });
    
    // Import sound button
    importSoundBtn.addEventListener('click', () => {
        alert('Import functionality would open file picker here');
    });
    
    // Load initial sounds
    loadSounds('all');
}

// Initialize when ready - with extra delay to ensure DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeApp, 200); // Add delay after DOMContentLoaded
    });
} else {
    setTimeout(initializeApp, 200); // Increase delay
}