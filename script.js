// 8-Track Multi-Instrument Studio
const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Audio engine
const audioEngine = new AudioEngine();

// Touch handling
const touches = new Map();
const particles = [];

// Track configurations (8 tracks)
const trackConfigs = [
    { instrument: 'synth' },
    { instrument: 'piano' },
    { instrument: 'strings' },
    { instrument: 'bells' },
    { instrument: 'pad' },
    { instrument: 'lead' },
    { instrument: 'pluck' },
    { instrument: 'bass' }
];

// Visual settings for all instruments
const colorThemes = {
    synth: ['#ff00ff', '#00ffff', '#ffff00'],
    piano: ['#ffffff', '#cccccc', '#888888'],
    strings: ['#ff6b35', '#f7931e', '#ffcc00'],
    bells: ['#00ffff', '#0099ff', '#0066cc'],
    bass: ['#ff0066', '#ff3366', '#ff6666'],
    lead: ['#ff00aa', '#ff00ff', '#aa00ff'],
    pad: ['#9966ff', '#6633ff', '#9933ff'],
    pluck: ['#00ff00', '#66ff00', '#00ff66'],
    organ: ['#8B4513', '#A0522D', '#D2691E'],
    flute: ['#87CEEB', '#87CEFA', '#00BFFF'],
    brass: ['#FFD700', '#FFA500', '#FF8C00'],
    choir: ['#FFE4E1', '#FFC0CB', '#FFB6C1']
};

// Track setup
const numTracks = 8;
let rowHeight = window.innerHeight / numTracks;

class TouchParticle {
    constructor(x, y, color, note) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.note = note;
        this.radius = 20;
        this.maxRadius = 100;
        this.opacity = 1;
        this.ripples = [];
    }
    
    update() {
        this.radius += 2;
        this.opacity = Math.max(0, 1 - (this.radius / this.maxRadius));
        
        if (this.radius % 10 === 0 && this.radius < 50) {
            this.ripples.push({
                radius: this.radius,
                opacity: 0.5
            });
        }
        
        this.ripples = this.ripples.filter(ripple => {
            ripple.radius += 3;
            ripple.opacity *= 0.95;
            return ripple.opacity > 0.01;
        });
    }
    
    draw(ctx) {
        this.ripples.forEach(ripple => {
            ctx.strokeStyle = this.color;
            ctx.globalAlpha = ripple.opacity;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, ripple.radius, 0, Math.PI * 2);
            ctx.stroke();
        });
        
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        if (this.opacity > 0.5) {
            ctx.globalAlpha = this.opacity;
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.note, this.x, this.y + 5);
        }
        
        ctx.globalAlpha = 1;
    }
}

// Touch indicator management
const touchIndicators = new Map();

class TouchIndicator {
    constructor(touchId, instrument, note, frequency) {
        this.touchId = touchId;
        this.element = document.createElement('div');
        this.element.className = 'touch-indicator-item';
        this.element.innerHTML = `
            <span class="indicator-instrument">${instrument.toUpperCase()}</span>
            <span class="indicator-note">${note}</span>
            <span class="indicator-freq">${Math.round(frequency)}Hz</span>
        `;
        document.querySelector('.touch-indicators').appendChild(this.element);
    }
    
    remove() {
        this.element.remove();
    }
}

// Get track and instrument from Y position
function getTrackFromY(y) {
    const trackIndex = Math.floor(y / rowHeight);
    return Math.min(Math.max(0, trackIndex), numTracks - 1);
}

// Note names
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function getMidiNoteName(midiNote) {
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12];
    return noteName + octave;
}

// Touch event handlers
function handleTouchStart(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    
    // Clean up orphaned touches
    const activeTouchIds = Array.from(e.touches).map(t => t.identifier);
    touches.forEach((value, touchId) => {
        if (!activeTouchIds.includes(touchId) && touchId !== 'mouse') {
            console.log('Cleaning up orphaned touch:', touchId);
            audioEngine.stopNote(touchId);
            touches.delete(touchId);
            const indicator = touchIndicators.get(touchId);
            if (indicator) {
                indicator.remove();
                touchIndicators.delete(touchId);
            }
        }
    });
    
    for (let touch of e.changedTouches) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        // Determine track and instrument
        const trackIndex = getTrackFromY(y);
        const instrument = trackConfigs[trackIndex].instrument;
        
        debugLog.log(`Touch start: Track ${trackIndex + 1} = ${instrument}, X:${Math.round(x)} Y:${Math.round(y)}`);
        
        // Use local Y position within the row for note calculation
        const localY = y % rowHeight;
        const { frequency, midiNote } = audioEngine.playNoteOrSample(x, localY, canvas.width, rowHeight, touch.identifier, trackIndex, instrument);
        const noteName = getMidiNoteName(midiNote);
        
        const colors = colorThemes[instrument] || colorThemes.synth;
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        const particle = new TouchParticle(x, y, color, noteName);
        touches.set(touch.identifier, { x, y, particle, frequency, instrument });
        
        // Create touch indicator
        const indicator = new TouchIndicator(touch.identifier, instrument, noteName, frequency);
        touchIndicators.set(touch.identifier, indicator);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    
    for (let touch of e.changedTouches) {
        const touchData = touches.get(touch.identifier);
        if (touchData) {
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            
            const dx = x - touchData.x;
            const dy = y - touchData.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 5) {
                const steps = Math.ceil(distance / 5);
                for (let i = 0; i < steps; i++) {
                    const ratio = i / steps;
                    const px = touchData.x + dx * ratio;
                    const py = touchData.y + dy * ratio;
                    
                    particles.push({
                        x: px,
                        y: py,
                        vx: (Math.random() - 0.5) * 2,
                        vy: (Math.random() - 0.5) * 2,
                        color: touchData.particle.color,
                        life: 1,
                        size: Math.random() * 3 + 1
                    });
                }
            }
            
            touchData.x = x;
            touchData.y = y;
        }
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    
    for (let touch of e.changedTouches) {
        // Stop either synthesized note or sample
        audioEngine.stopNote(touch.identifier);
        audioEngine.stopSample(touch.identifier);
        
        const touchData = touches.get(touch.identifier);
        if (touchData) {
            particles.push(touchData.particle);
        }
        touches.delete(touch.identifier);
        
        const indicator = touchIndicators.get(touch.identifier);
        if (indicator) {
            indicator.remove();
            touchIndicators.delete(touch.identifier);
        }
    }
}

// Clean up on visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        touches.forEach((touchData, touchId) => {
            audioEngine.stopNote(touchId);
            audioEngine.stopSample(touchId);
            const indicator = touchIndicators.get(touchId);
            if (indicator) {
                indicator.remove();
            }
        });
        touches.clear();
        touchIndicators.clear();
    }
});

// Mouse events (for testing)
let mouseDown = false;
canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    handleTouchStart({
        preventDefault: () => {},
        changedTouches: [{
            identifier: 'mouse',
            clientX: e.clientX,
            clientY: e.clientY
        }],
        touches: [{ identifier: 'mouse' }]
    });
});

canvas.addEventListener('mousemove', (e) => {
    if (mouseDown) {
        handleTouchMove({
            preventDefault: () => {},
            changedTouches: [{
                identifier: 'mouse',
                clientX: e.clientX,
                clientY: e.clientY
            }]
        });
    }
});

canvas.addEventListener('mouseup', () => {
    mouseDown = false;
    handleTouchEnd({
        preventDefault: () => {},
        changedTouches: [{ identifier: 'mouse' }]
    });
});

// Touch events
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

// Prevent context menu
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
});

// Animation loop
function animate() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw track dividers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < numTracks; i++) {
        const y = i * rowHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    
    // Draw vertical note guides
    for (let i = 0; i < 8; i++) {
        const x = (i / 8) * canvas.width;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    
    // Update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        
        if (particle instanceof TouchParticle) {
            particle.update();
            particle.draw(ctx);
            
            if (particle.opacity <= 0) {
                particles.splice(i, 1);
            }
        } else {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 0.01;
            particle.vy += 0.1;
            
            ctx.fillStyle = particle.color;
            ctx.globalAlpha = particle.life;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
            
            if (particle.life <= 0) {
                particles.splice(i, 1);
            }
        }
    }
    
    ctx.globalAlpha = 1;
    requestAnimationFrame(animate);
}

// Track instrument selectors
document.querySelectorAll('.track-selector').forEach(selector => {
    selector.addEventListener('change', (e) => {
        const trackIndex = parseInt(e.target.dataset.track);
        const instrument = e.target.value;
        trackConfigs[trackIndex].instrument = instrument;
        console.log(`Track ${trackIndex + 1} changed to ${instrument}`);
    });
});

// UI Controls
document.getElementById('scale').addEventListener('change', (e) => {
    audioEngine.currentScale = e.target.value;
});

document.getElementById('key').addEventListener('change', (e) => {
    audioEngine.currentKey = e.target.value;
});

document.getElementById('octave').addEventListener('input', (e) => {
    audioEngine.currentOctave = parseInt(e.target.value);
    document.getElementById('octaveValue').textContent = e.target.value;
});

document.getElementById('decay').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    audioEngine.sustainTime = (value / 100) * 2;
    document.getElementById('decayValue').textContent = audioEngine.sustainTime.toFixed(1) + 's';
});

// Effects
document.getElementById('reverb').addEventListener('input', (e) => {
    audioEngine.updateEffects(
        parseInt(document.getElementById('reverb').value),
        parseInt(document.getElementById('delay').value),
        parseInt(document.getElementById('filter').value)
    );
});

document.getElementById('delay').addEventListener('input', (e) => {
    audioEngine.updateEffects(
        parseInt(document.getElementById('reverb').value),
        parseInt(document.getElementById('delay').value),
        parseInt(document.getElementById('filter').value)
    );
});

document.getElementById('filter').addEventListener('input', (e) => {
    audioEngine.updateEffects(
        parseInt(document.getElementById('reverb').value),
        parseInt(document.getElementById('delay').value),
        parseInt(document.getElementById('filter').value)
    );
});

document.getElementById('volume').addEventListener('input', (e) => {
    const value = parseInt(e.target.value) / 100;
    audioEngine.masterGain.gain.setTargetAtTime(value, audioEngine.audioContext.currentTime, 0.01);
});

// Recording
let isRecording = false;
let recordedNotes = [];

document.getElementById('record').addEventListener('click', () => {
    if (!isRecording) {
        audioEngine.startRecording();
        isRecording = true;
        document.getElementById('record').textContent = '⬛ Stop';
        document.querySelector('.recording-indicator').style.display = 'block';
    } else {
        recordedNotes = audioEngine.stopRecording();
        isRecording = false;
        document.getElementById('record').textContent = '● Record';
        document.querySelector('.recording-indicator').style.display = 'none';
    }
});

document.getElementById('play').addEventListener('click', () => {
    if (recordedNotes.length > 0) {
        audioEngine.playRecording(recordedNotes);
    }
});

document.getElementById('clear').addEventListener('click', () => {
    recordedNotes = [];
});

// Panic button
document.getElementById('panic').addEventListener('click', () => {
    console.log('PANIC! Stopping all notes');
    
    try {
        audioEngine.stopAllNotes();
        // Also stop all samples
        audioEngine.sampleVoices.forEach((voice, touchId) => {
            audioEngine.stopSample(touchId);
        });
    } catch (e) {
        console.error('Error in stopAllNotes:', e);
    }
    
    touches.clear();
    touchIndicators.forEach(indicator => indicator.remove());
    touchIndicators.clear();
    mouseDown = false;
    
    const btn = document.getElementById('panic');
    btn.style.background = '#ff0000';
    btn.textContent = 'Stopped!';
    setTimeout(() => {
        btn.style.background = '';
        btn.textContent = 'Stop All';
    }, 500);
});

// Presets
document.getElementById('preset').addEventListener('click', () => {
    document.querySelector('.preset-menu').style.display = 'block';
});

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        
        if (preset === 'close') {
            document.querySelector('.preset-menu').style.display = 'none';
            return;
        }
        
        const presets = {
            ambient: {
                tracks: ['pad', 'strings', 'bells', 'choir', 'flute', 'pad', 'bells', 'bass'],
                reverb: 90,
                delay: 70,
                filter: 30,
                scale: 'pentatonic',
                decay: 90,
                volume: 60
            },
            jazz: {
                tracks: ['piano', 'bass', 'brass', 'organ', 'pluck', 'flute', 'strings', 'lead'],
                reverb: 40,
                delay: 20,
                filter: 70,
                scale: 'blues',
                decay: 30,
                volume: 70
            },
            electronic: {
                tracks: ['synth', 'lead', 'bass', 'pluck', 'pad', 'synth', 'lead', 'bass'],
                reverb: 30,
                delay: 50,
                filter: 80,
                scale: 'minor',
                decay: 10,
                volume: 80
            },
            orchestral: {
                tracks: ['strings', 'brass', 'flute', 'bells', 'choir', 'strings', 'organ', 'bass'],
                reverb: 60,
                delay: 10,
                filter: 50,
                scale: 'major',
                decay: 50,
                volume: 65
            },
            rockband: {
                tracks: ['lead', 'lead', 'organ', 'piano', 'bass', 'brass', 'strings', 'bass'],
                reverb: 25,
                delay: 30,
                filter: 75,
                scale: 'blues',
                decay: 20,
                volume: 85
            },
            world: {
                tracks: ['pluck', 'flute', 'bells', 'choir', 'strings', 'organ', 'brass', 'bass'],
                reverb: 50,
                delay: 40,
                filter: 60,
                scale: 'arabic',
                decay: 40,
                volume: 70
            },
            experimental: {
                tracks: ['bells', 'synth', 'choir', 'organ', 'lead', 'flute', 'pad', 'bass'],
                reverb: 70,
                delay: 60,
                filter: 40,
                scale: 'wholetone',
                decay: 60,
                volume: 65
            }
        };
        
        const settings = presets[preset];
        if (settings) {
            // Set track instruments
            settings.tracks.forEach((instrument, index) => {
                const selector = document.querySelector(`[data-track="${index}"]`);
                if (selector) {
                    selector.value = instrument;
                    trackConfigs[index].instrument = instrument;
                }
            });
            
            document.getElementById('reverb').value = settings.reverb;
            document.getElementById('delay').value = settings.delay;
            document.getElementById('filter').value = settings.filter;
            document.getElementById('scale').value = settings.scale;
            document.getElementById('decay').value = settings.decay;
            document.getElementById('volume').value = settings.volume;
            
            audioEngine.currentScale = settings.scale;
            audioEngine.sustainTime = (settings.decay / 100) * 2;
            document.getElementById('decayValue').textContent = audioEngine.sustainTime.toFixed(1) + 's';
            
            const volume = settings.volume / 100;
            audioEngine.masterGain.gain.setTargetAtTime(volume, audioEngine.audioContext.currentTime, 0.01);
            
            audioEngine.updateEffects(settings.reverb, settings.delay, settings.filter);
        }
        
        document.querySelector('.preset-menu').style.display = 'none';
    });
});

// Help menu
document.getElementById('help').addEventListener('click', () => {
    document.querySelector('.help-menu').style.display = 'block';
});

document.querySelector('.help-close').addEventListener('click', () => {
    document.querySelector('.help-menu').style.display = 'none';
});

// Panel collapse
let panelCollapsed = false;
document.getElementById('collapse-btn').addEventListener('click', () => {
    panelCollapsed = !panelCollapsed;
    const panel = document.querySelector('.control-panel');
    const content = document.querySelector('.panel-content');
    
    if (panelCollapsed) {
        content.style.display = 'none';
        panel.style.transform = 'translateY(calc(100% - 40px))';
        document.getElementById('collapse-btn').textContent = '+';
    } else {
        content.style.display = 'flex';
        panel.style.transform = 'translateY(0)';
        document.getElementById('collapse-btn').textContent = '−';
    }
});

// Resize handler
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Update row height
    rowHeight = window.innerHeight / numTracks;
    
    // Update instrument zones
    document.querySelectorAll('.instrument-zone').forEach((zone, index) => {
        zone.style.height = `${rowHeight}px`;
        zone.style.top = `${index * rowHeight}px`;
    });
});

// Initialize instrument zones
document.querySelectorAll('.instrument-zone').forEach((zone, index) => {
    zone.style.height = `${rowHeight}px`;
    zone.style.top = `${index * rowHeight}px`;
});

// Prevent scrolling
document.body.addEventListener('touchmove', (e) => {
    e.preventDefault();
}, { passive: false });

// Start animation
animate();

// Log initialization
console.log('8-Track Multi-instrument studio loaded');
console.log('12 instruments available: synth, piano, strings, bells, bass, lead, pad, pluck, organ, flute, brass, choir');

// ElevenLabs Integration
let elevenLabsApiKey = localStorage.getItem('elevenlabs_api_key') || '';
let currentGeneratingTrack = null;

// Sound generation modal elements
const soundGenModal = document.querySelector('.sound-gen-modal');
const apiKeyInput = document.getElementById('elevenlabs-api-key');
const saveApiKeyBtn = document.getElementById('save-api-key');
const soundPromptInput = document.getElementById('sound-prompt');
const generateSoundBtn = document.getElementById('generate-sound');
const cancelGenBtn = document.getElementById('cancel-gen');
const loadingIndicator = document.querySelector('.loading-indicator');
const soundGenSection = document.querySelector('.sound-gen-section');
const useSampleModeCheckbox = document.getElementById('use-sample-mode');

// Initialize API key if saved
if (elevenLabsApiKey) {
    apiKeyInput.value = elevenLabsApiKey;
}

// Sound generation button handlers
document.querySelectorAll('.sound-gen-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackIndex = parseInt(btn.dataset.track);
        currentGeneratingTrack = trackIndex;
        
        // Update modal title
        document.getElementById('track-number').textContent = `Track ${trackIndex + 1}`;
        
        // Update checkbox state
        useSampleModeCheckbox.checked = audioEngine.isSampleMode(trackIndex);
        useSampleModeCheckbox.dataset.track = trackIndex;
        
        // Update button state
        if (audioEngine.hasSample(trackIndex)) {
            btn.classList.add('has-sample');
        }
        
        // Show modal
        soundGenModal.style.display = 'flex';
        soundPromptInput.focus();
    });
});

// Save API key
saveApiKeyBtn.addEventListener('click', () => {
    elevenLabsApiKey = apiKeyInput.value.trim();
    localStorage.setItem('elevenlabs_api_key', elevenLabsApiKey);
    
    // Visual feedback
    saveApiKeyBtn.textContent = 'Saved!';
    saveApiKeyBtn.style.background = 'rgba(0, 255, 0, 0.5)';
    setTimeout(() => {
        saveApiKeyBtn.textContent = 'Save';
        saveApiKeyBtn.style.background = '';
    }, 1500);
});

// Generate sound
generateSoundBtn.addEventListener('click', async () => {
    const prompt = soundPromptInput.value.trim();
    
    if (!prompt) {
        alert('Please enter a sound description');
        return;
    }
    
    if (!elevenLabsApiKey) {
        alert('Please enter your ElevenLabs API key');
        apiKeyInput.focus();
        return;
    }
    
    // Show loading
    soundGenSection.style.display = 'none';
    loadingIndicator.style.display = 'block';
    
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
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        
        // Get audio data
        const audioData = await response.arrayBuffer();
        
        // Load into audio engine
        const success = await audioEngine.loadSample(currentGeneratingTrack, audioData, prompt);
        
        if (success) {
            // Update button appearance
            const btn = document.querySelector(`.sound-gen-btn[data-track="${currentGeneratingTrack}"]`);
            btn.classList.add('has-sample');
            
            // Auto-enable sample mode
            audioEngine.setSampleMode(currentGeneratingTrack, true);
            useSampleModeCheckbox.checked = true;
            
            // Success feedback
            loadingIndicator.innerHTML = '<p style="color: #0f0;">✓ Sound generated successfully!</p>';
            setTimeout(() => {
                soundGenModal.style.display = 'none';
                resetModal();
            }, 1500);
        } else {
            throw new Error('Failed to decode audio');
        }
        
    } catch (error) {
        console.error('Sound generation error:', error);
        loadingIndicator.innerHTML = `<p style="color: #f00;">Error: ${error.message}</p>`;
        setTimeout(() => {
            loadingIndicator.style.display = 'none';
            soundGenSection.style.display = 'flex';
        }, 3000);
    }
});

// Cancel button
cancelGenBtn.addEventListener('click', () => {
    soundGenModal.style.display = 'none';
    resetModal();
});

// Sample mode toggle
useSampleModeCheckbox.addEventListener('change', (e) => {
    const trackIndex = parseInt(e.target.dataset.track);
    audioEngine.setSampleMode(trackIndex, e.target.checked);
});

// Close modal on background click
soundGenModal.addEventListener('click', (e) => {
    if (e.target === soundGenModal) {
        soundGenModal.style.display = 'none';
        resetModal();
    }
});

// Reset modal state
function resetModal() {
    soundGenSection.style.display = 'flex';
    loadingIndicator.style.display = 'none';
    soundPromptInput.value = '';
}

// Keyboard shortcuts for modal
soundPromptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateSoundBtn.click();
    } else if (e.key === 'Escape') {
        soundGenModal.style.display = 'none';
        resetModal();
    }
});

// Initialize audio on first touch
let audioInitialized = false;
document.addEventListener('touchstart', () => {
    if (!audioInitialized) {
        if (audioEngine.audioContext.state === 'suspended') {
            audioEngine.audioContext.resume().then(() => {
                debugLog.log('Audio context resumed successfully');
                const indicator = document.createElement('div');
                indicator.textContent = '🔊 Audio Enabled';
                indicator.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#00ff00;padding:20px;border-radius:10px;z-index:1000';
                document.body.appendChild(indicator);
                setTimeout(() => indicator.remove(), 1000);
            }).catch(err => {
                debugLog.error('Failed to resume audio: ' + err.message);
            });
        }
        audioInitialized = true;
    }
}, { once: true });

document.addEventListener('click', () => {
    if (!audioInitialized && audioEngine.audioContext.state === 'suspended') {
        audioEngine.audioContext.resume();
        audioInitialized = true;
    }
}, { once: true });