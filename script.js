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
const topMenuHeight = 60; // Height of top menu
let rowHeight = (window.innerHeight - topMenuHeight) / numTracks;

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
    // Account for top menu offset
    const adjustedY = y - topMenuHeight;
    const trackIndex = Math.floor(adjustedY / rowHeight);
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
        
        // Skip touches on the control section
        const controlsWidth = getControlsWidth();
        if (x < controlsWidth) continue;
        
        // Adjust X coordinate for control section
        const adjustedX = x - controlsWidth;
        const adjustedWidth = canvas.width - controlsWidth;
        
        // Determine track and instrument
        const trackIndex = getTrackFromY(y);
        const instrument = trackConfigs[trackIndex].instrument;
        
        debugLog.log(`Touch start: Track ${trackIndex + 1} = ${instrument}, X:${Math.round(x)} Y:${Math.round(y)}`);
        
        // Use local Y position within the row for note calculation
        const localY = y % rowHeight;
        const { frequency, midiNote } = audioEngine.playNoteOrSample(adjustedX, localY, adjustedWidth, rowHeight, touch.identifier, trackIndex, instrument);
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
    for (let i = 0; i <= numTracks; i++) {
        const y = i * rowHeight + topMenuHeight;
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
        
        // Update audio engine
        audioEngine.setTrackInstrument(trackIndex, instrument);
        
        // Update grid labels if in grid view
        updateTrackLabels();
        
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

// Global effects removed - now using per-track effects

// BPM control
document.getElementById('bpm').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    audioEngine.setBPM(value);
    document.getElementById('bpmValue').textContent = value;
});

// Time signature control
document.getElementById('timesig').addEventListener('change', (e) => {
    const [numerator, denominator] = e.target.value.split('/').map(Number);
    audioEngine.setTimeSignature(numerator, denominator);
});

// Metronome toggle
let metronomeActive = false;
document.getElementById('metronome-toggle').addEventListener('click', (e) => {
    metronomeActive = !metronomeActive;
    audioEngine.setMetronomeEnabled(metronomeActive);
    
    const btn = e.target;
    if (metronomeActive) {
        btn.textContent = 'On';
        btn.classList.add('active');
        // Start the sequencer to hear the metronome
        audioEngine.startSequencer();
    } else {
        btn.textContent = 'Off';
        btn.classList.remove('active');
        // Stop the sequencer when metronome is off
        audioEngine.stopSequencer();
    }
});

// Loop recording toggle
let loopEnabled = false;
document.getElementById('loop-toggle').addEventListener('click', (e) => {
    loopEnabled = !loopEnabled;
    audioEngine.setLoopRecording(loopEnabled);
    
    const btn = e.target;
    if (loopEnabled) {
        btn.textContent = 'Loop On';
        btn.classList.add('active');
    } else {
        btn.textContent = 'Loop Off';
        btn.classList.remove('active');
    }
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
        
        // If loop is enabled and sequencer isn't running, start it
        if (loopEnabled && !audioEngine.isPlaying) {
            audioEngine.startSequencer();
        }
    } else {
        recordedNotes = audioEngine.stopRecording();
        isRecording = false;
        document.getElementById('record').textContent = '● Record';
        document.querySelector('.recording-indicator').style.display = 'none';
        
        // If loop recording, keep playing
        if (!loopEnabled && audioEngine.isPlaying && !metronomeActive) {
            audioEngine.stopSequencer();
        }
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

// Second panic button
document.getElementById('panic2').addEventListener('click', () => {
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
    
    const btn = document.getElementById('panic2');
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
            
            // Apply effects to all tracks
            for (let i = 0; i < 8; i++) {
                // Update reverb
                const reverbSlider = document.querySelector(`.track-reverb[data-track="${i}"]`);
                if (reverbSlider) {
                    reverbSlider.value = settings.reverb;
                    audioEngine.setTrackReverb(i, settings.reverb);
                    const reverbValue = reverbSlider.nextElementSibling;
                    if (reverbValue) reverbValue.textContent = settings.reverb;
                }
                
                // Update delay
                const delaySlider = document.querySelector(`.track-delay[data-track="${i}"]`);
                if (delaySlider) {
                    delaySlider.value = settings.delay;
                    audioEngine.setTrackDelay(i, settings.delay);
                    const delayValue = delaySlider.nextElementSibling;
                    if (delayValue) delayValue.textContent = settings.delay;
                }
                
                // Update filter
                const filterSlider = document.querySelector(`.track-filter[data-track="${i}"]`);
                if (filterSlider) {
                    filterSlider.value = settings.filter;
                    audioEngine.setTrackFilter(i, settings.filter);
                    const filterValue = filterSlider.nextElementSibling;
                    if (filterValue) filterValue.textContent = settings.filter;
                }
                
                // Update volume
                const volumeSlider = document.querySelector(`.track-volume[data-track="${i}"]`);
                if (volumeSlider) {
                    volumeSlider.value = settings.volume;
                    audioEngine.setTrackVolume(i, settings.volume);
                    const volumeValue = volumeSlider.nextElementSibling;
                    if (volumeValue) volumeValue.textContent = settings.volume;
                }
                
                // Update decay
                const decaySlider = document.querySelector(`.track-decay[data-track="${i}"]`);
                if (decaySlider) {
                    decaySlider.value = settings.decay;
                    audioEngine.setTrackDecay(i, settings.decay);
                    const decayValue = decaySlider.nextElementSibling;
                    if (decayValue) decayValue.textContent = settings.decay;
                }
            }
            
            // Update scale
            document.getElementById('scale').value = settings.scale;
            audioEngine.currentScale = settings.scale;
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
    
    // Update row height accounting for top menu
    rowHeight = (window.innerHeight - topMenuHeight) / numTracks;
    
    // Update instrument zones
    document.querySelectorAll('.instrument-zone').forEach((zone, index) => {
        zone.style.height = `${rowHeight}px`;
        zone.style.top = `${index * rowHeight + topMenuHeight}px`;
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

// View toggle
let isGridView = false;
let currentViewMode = 'multi'; // Global variable for view mode

// Grid sequencer functions
function generateSequencerGrid() {
    const grid = document.querySelector('.sequencer-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    for (let track = 0; track < 8; track++) {
        const trackRow = document.createElement('div');
        trackRow.className = 'track-row';
        
        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = `Track ${track + 1}`;
        trackRow.appendChild(label);
        
        const beatSlots = document.createElement('div');
        beatSlots.className = 'beat-slots';
        
        // Create resolution selector for this track
        const resolutionSelect = document.createElement('select');
        resolutionSelect.className = 'track-resolution';
        resolutionSelect.dataset.track = track;
        resolutionSelect.innerHTML = `
            <option value="quarter">1/4</option>
            <option value="eighth">1/8</option>
            <option value="sixteenth">1/16</option>
        `;
        trackRow.appendChild(resolutionSelect);
        
        // Always show 64 beats (maximum resolution) but size them based on track resolution
        const resolution = resolutionSelect.value;
        
        for (let beat = 0; beat < 64; beat++) {
            const slot = document.createElement('div');
            slot.className = 'beat-slot';
            slot.dataset.track = track;
            slot.dataset.beat = beat;
            slot.dataset.resolution = resolution;
            
            // Add bar boundary styling (every 16 beats)
            if (beat % 16 === 0 && beat > 0) {
                slot.classList.add('bar-start');
            }
            
            // Size and visibility based on resolution
            if (resolution === 'quarter') {
                // Quarter notes: show every 4th beat, make them 4x wider
                if (beat % 4 === 0) {
                    slot.classList.add('quarter-note');
                } else {
                    slot.style.display = 'none';
                }
            } else if (resolution === 'eighth') {
                // Eighth notes: show every 2nd beat, make them 2x wider
                if (beat % 2 === 0) {
                    slot.classList.add('eighth-note');
                } else {
                    slot.style.display = 'none';
                }
            } else {
                // Sixteenth notes: show all beats, normal size
                slot.classList.add('sixteenth-note');
            }
            
            // Click handler for beat slots
            slot.addEventListener('click', () => {
                const isActive = slot.classList.contains('active');
                slot.classList.toggle('active');
                audioEngine.setSequencerBeat(track, beat, !isActive, resolution);
            });
            
            beatSlots.appendChild(slot);
        }
        
        // Handle resolution changes
        resolutionSelect.addEventListener('change', () => {
            // Regenerate this track's beats
            generateTrackBeats(track, beatSlots, resolutionSelect.value);
        });
        
        trackRow.appendChild(beatSlots);
        grid.appendChild(trackRow);
    }
}

function generateTrackBeats(track, beatSlots, resolution) {
    // Update existing beats instead of clearing
    const slots = beatSlots.querySelectorAll('.beat-slot');
    
    slots.forEach((slot, beat) => {
        slot.dataset.resolution = resolution;
        
        // Remove old resolution classes
        slot.classList.remove('quarter-note', 'eighth-note', 'sixteenth-note');
        slot.style.display = '';
        
        // Size and visibility based on resolution
        if (resolution === 'quarter') {
            // Quarter notes: show every 4th beat, make them 4x wider
            if (beat % 4 === 0) {
                slot.classList.add('quarter-note');
            } else {
                slot.style.display = 'none';
            }
        } else if (resolution === 'eighth') {
            // Eighth notes: show every 2nd beat, make them 2x wider
            if (beat % 2 === 0) {
                slot.classList.add('eighth-note');
            } else {
                slot.style.display = 'none';
            }
        } else {
            // Sixteenth notes: show all beats, normal size
            slot.classList.add('sixteenth-note');
        }
    });
}

function updateTrackLabels() {
    document.querySelectorAll('.track-label').forEach((label, index) => {
        const instrument = trackConfigs[index].instrument;
        label.textContent = `Track ${index + 1} - ${instrument.charAt(0).toUpperCase() + instrument.slice(1)}`;
    });
}

// View mode handling
let currentMode = 'multi'; // 'multi', 'grid', 'single'

document.getElementById('view-toggle').addEventListener('click', () => {
    const viewToggleBtn = document.getElementById('view-toggle');
    const gridSequencer = document.querySelector('.grid-sequencer');
    
    if (currentMode === 'multi') {
        currentMode = 'grid';
        currentViewMode = 'grid'; // Update global variable
        isGridView = true;
        canvas.style.display = 'none';
        document.querySelector('.instrument-zones').style.display = 'none';
        document.querySelector('.single-track-view').style.display = 'none';
        gridSequencer.style.display = 'block';
        viewToggleBtn.textContent = 'Multi Track';
        
        // Check if controls are minimized
        if (controlsMinimized) {
            gridSequencer.classList.add('fullscreen');
        }
        
        // Update track labels in grid
        updateTrackLabels();
    } else {
        currentMode = 'multi';
        currentViewMode = 'multi';
        isGridView = false;
        canvas.style.display = 'block';
        document.querySelector('.instrument-zones').style.display = 'block';
        gridSequencer.style.display = 'none';
        document.querySelector('.single-track-view').style.display = 'none';
        viewToggleBtn.textContent = 'Grid View';
    }
});

// Single track view toggle
document.getElementById('single-view-toggle').addEventListener('click', () => {
    if (currentMode !== 'single') {
        currentMode = 'single';
        currentViewMode = 'single';
        canvas.style.display = 'none';
        document.querySelector('.instrument-zones').style.display = 'none';
        gridSequencer.style.display = 'none';
        document.querySelector('.single-track-view').style.display = 'block';
        document.getElementById('single-view-toggle').textContent = 'Multi Track';
        
        // Check if controls are minimized
        if (controlsMinimized) {
            document.querySelector('.single-track-view').classList.add('fullscreen');
        }
    } else {
        currentMode = 'multi';
        currentViewMode = 'multi';
        canvas.style.display = 'block';
        document.querySelector('.instrument-zones').style.display = 'block';
        document.querySelector('.single-track-view').style.display = 'none';
        document.getElementById('single-view-toggle').textContent = 'Single Track';
    }
});

// Update beat playback indicator
let lastBeat = -1;
let sequencerStartTime = 0;

function updateBeatIndicator() {
    if (isGridView && audioEngine.isPlaying) {
        // Calculate visual beat based on actual audio time for perfect sync
        const currentAudioTime = audioEngine.audioContext.currentTime;
        const secondsPerBeat = 60.0 / audioEngine.bpm;
        
        // Calculate how much time has passed since the sequencer started playing
        if (sequencerStartTime === 0) {
            sequencerStartTime = currentAudioTime;
        }
        
        const elapsedTime = currentAudioTime - sequencerStartTime;
        const quarterNoteBeat = Math.floor(elapsedTime / secondsPerBeat) % 16;
        
        // Remove playing class from all previous beats
        document.querySelectorAll('.beat-slot.playing').forEach(slot => {
            slot.classList.remove('playing');
        });
        
        // Add playing class based on each track's resolution
        document.querySelectorAll('.track-row').forEach((trackRow, trackIndex) => {
            const resolutionSelect = trackRow.querySelector('.track-resolution');
            const resolution = resolutionSelect ? resolutionSelect.value : 'quarter';
            
            let visualBeat = quarterNoteBeat;
            
            if (resolution === 'quarter') {
                // Quarter notes: highlight every 4th beat
                visualBeat = quarterNoteBeat * 4;
            } else if (resolution === 'eighth') {
                // For eighth notes, calculate which of the 2 sub-beats we're on
                const subBeatProgress = (elapsedTime % secondsPerBeat) / secondsPerBeat;
                const eighthSubBeat = Math.floor(subBeatProgress * 2);
                visualBeat = (quarterNoteBeat * 2 + eighthSubBeat) * 2; // Show every 2nd beat
            } else if (resolution === 'sixteenth') {
                // For sixteenth notes, calculate which of the 4 sub-beats we're on
                const subBeatProgress = (elapsedTime % secondsPerBeat) / secondsPerBeat;
                const sixteenthSubBeat = Math.floor(subBeatProgress * 4);
                visualBeat = quarterNoteBeat * 4 + sixteenthSubBeat;
            }
            
            // Highlight the current beat for this track (only if it's visible)
            const currentSlot = trackRow.querySelector(`.beat-slot[data-beat="${visualBeat}"]`);
            if (currentSlot && currentSlot.style.display !== 'none') {
                currentSlot.classList.add('playing');
            }
        });
        
        lastBeat = quarterNoteBeat;
    } else {
        // Reset when not playing
        sequencerStartTime = 0;
        document.querySelectorAll('.beat-slot.playing').forEach(slot => {
            slot.classList.remove('playing');
        });
        lastBeat = -1;
    }
    
    requestAnimationFrame(updateBeatIndicator);
}

// Sequencer controls
document.getElementById('sequencer-play').addEventListener('click', async () => {
    if (!audioEngine.isPlaying) {
        console.log('Starting sequencer...');
        // Check if any beats are active
        let hasActiveBeats = false;
        document.querySelectorAll('.beat-slot.active').forEach(() => {
            hasActiveBeats = true;
        });
        
        if (!hasActiveBeats && !metronomeActive) {
            alert('No beats programmed! Click on the grid to add beats, or turn on the metronome.');
            return;
        }
        
        await audioEngine.startSequencer();
        document.getElementById('sequencer-play').textContent = '⏸ Pause';
    } else {
        console.log('Stopping sequencer...');
        audioEngine.stopSequencer();
        document.getElementById('sequencer-play').textContent = '▶ Play';
    }
});

document.getElementById('sequencer-stop').addEventListener('click', () => {
    console.log('Stopping sequencer...');
    audioEngine.stopSequencer();
    document.getElementById('sequencer-play').textContent = '▶ Play';
});

document.getElementById('sequencer-clear').addEventListener('click', () => {
    // Clear all beats
    for (let track = 0; track < 8; track++) {
        for (let beat = 0; beat < 64; beat++) {
            audioEngine.setSequencerBeat(track, beat, false);
        }
    }
    
    // Update UI
    document.querySelectorAll('.beat-slot').forEach(slot => {
        slot.classList.remove('active');
    });
});

// Initialize grid and sync track instruments
generateSequencerGrid();
updateBeatIndicator();

// Sync track instruments with audio engine
trackConfigs.forEach((config, index) => {
    audioEngine.setTrackInstrument(index, config.instrument);
});

// Add a test pattern - simple kick pattern on track 7 (bass)
// This helps verify the sequencer is working
audioEngine.setSequencerBeat(7, 0, true);
audioEngine.setSequencerBeat(7, 4, true);
audioEngine.setSequencerBeat(7, 8, true);
audioEngine.setSequencerBeat(7, 12, true);

// Update UI to show test pattern
setTimeout(() => {
    document.querySelectorAll('.beat-slot[data-track="7"]').forEach((slot, index) => {
        if (index === 0 || index === 4 || index === 8 || index === 12) {
            slot.classList.add('active');
        }
    });
}, 100); // Small delay to ensure grid is generated

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

// Per-track effects handlers
document.querySelectorAll('.effects-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackIndex = parseInt(btn.dataset.track);
        const panel = document.querySelector(`.track-effects-panel[data-track="${trackIndex}"]`);
        
        // Close all other panels first
        document.querySelectorAll('.track-effects-panel').forEach(p => {
            if (p !== panel) {
                p.classList.remove('active');
            }
        });
        document.querySelectorAll('.effects-toggle-btn').forEach(b => {
            if (b !== btn) {
                b.classList.remove('active');
            }
        });
        
        // Toggle current panel
        panel.classList.toggle('active');
        btn.classList.toggle('active');
    });
});

// Effects sliders handlers
document.querySelectorAll('.track-reverb').forEach(slider => {
    slider.addEventListener('input', (e) => {
        const trackIndex = parseInt(slider.dataset.track);
        const value = parseFloat(e.target.value);
        audioEngine.setTrackReverb(trackIndex, value);
        
        // Update value display
        const valueDisplay = e.target.nextElementSibling;
        if (valueDisplay && valueDisplay.classList.contains('effect-value')) {
            valueDisplay.textContent = Math.round(value);
        }
    });
});

document.querySelectorAll('.track-delay').forEach(slider => {
    slider.addEventListener('input', (e) => {
        const trackIndex = parseInt(slider.dataset.track);
        const value = parseFloat(e.target.value);
        audioEngine.setTrackDelay(trackIndex, value);
        
        // Update value display
        const valueDisplay = e.target.nextElementSibling;
        if (valueDisplay && valueDisplay.classList.contains('effect-value')) {
            valueDisplay.textContent = Math.round(value);
        }
    });
});

document.querySelectorAll('.track-filter').forEach(slider => {
    slider.addEventListener('input', (e) => {
        const trackIndex = parseInt(slider.dataset.track);
        const value = parseFloat(e.target.value);
        audioEngine.setTrackFilter(trackIndex, value);
        
        // Update value display
        const valueDisplay = e.target.nextElementSibling;
        if (valueDisplay && valueDisplay.classList.contains('effect-value')) {
            valueDisplay.textContent = Math.round(value);
        }
    });
});

document.querySelectorAll('.track-volume').forEach(slider => {
    slider.addEventListener('input', (e) => {
        const trackIndex = parseInt(slider.dataset.track);
        const value = parseFloat(e.target.value);
        audioEngine.setTrackVolume(trackIndex, value);
        
        // Update value display
        const valueDisplay = e.target.nextElementSibling;
        if (valueDisplay && valueDisplay.classList.contains('effect-value')) {
            valueDisplay.textContent = Math.round(value);
        }
    });
});

document.querySelectorAll('.track-decay').forEach(slider => {
    slider.addEventListener('input', (e) => {
        const trackIndex = parseInt(slider.dataset.track);
        const value = parseFloat(e.target.value);
        audioEngine.setTrackDecay(trackIndex, value);
        
        // Update value display
        const valueDisplay = e.target.nextElementSibling;
        if (valueDisplay && valueDisplay.classList.contains('effect-value')) {
            valueDisplay.textContent = Math.round(value);
        }
    });
});

// Minimize/Restore Controls
let controlsMinimized = false;

document.getElementById('minimize-controls').addEventListener('click', () => {
    const trackControls = document.querySelector('.track-controls');
    const minimizedControls = document.querySelector('.minimized-controls');
    const instrumentZones = document.querySelector('.instrument-zones');
    const topMenu = document.querySelector('.top-menu');
    
    trackControls.style.display = 'none';
    minimizedControls.style.display = 'flex';
    instrumentZones.classList.add('fullscreen');
    topMenu.classList.add('fullscreen');
    
    controlsMinimized = true;
    
    // Update grid sequencer if in grid view
    if (isGridView) {
        gridSequencer.classList.add('fullscreen');
    }
    
    // Update touch handling area
    updateTouchHandling();
});

document.getElementById('restore-controls').addEventListener('click', () => {
    const trackControls = document.querySelector('.track-controls');
    const minimizedControls = document.querySelector('.minimized-controls');
    const instrumentZones = document.querySelector('.instrument-zones');
    const topMenu = document.querySelector('.top-menu');
    
    trackControls.style.display = 'block';
    minimizedControls.style.display = 'none';
    instrumentZones.classList.remove('fullscreen');
    topMenu.classList.remove('fullscreen');
    
    controlsMinimized = false;
    
    // Update grid sequencer if in grid view
    if (isGridView) {
        gridSequencer.classList.remove('fullscreen');
    }
    
    // Update touch handling area
    updateTouchHandling();
});

function updateTouchHandling() {
    // This function will be used to update touch coordinate calculations
    // The touch handling in handleTouchStart will use this
}

// Update touch handling to be dynamic
function getControlsWidth() {
    return controlsMinimized ? 60 : 400;
}

// Top Menu Handlers
document.getElementById('sounds-menu').addEventListener('click', () => {
    // TODO: Open sounds library/manager
    alert('Sounds menu - Coming soon!');
});

document.getElementById('tracks-menu').addEventListener('click', () => {
    // TODO: Open tracks management (load/save/export)
    alert('Tracks menu - Coming soon!');
});

document.getElementById('profile-menu').addEventListener('click', () => {
    // TODO: Open user profile/settings
    alert('Profile menu - Coming soon!');
});