class ToneAudioEngine {
    constructor() {
        this.tracks = [];
        this.sequencerData = [];
        this.bpm = 120;
        this.currentScale = 'major';
        this.currentKey = 'C';
        this.currentOctave = 4;
        this.timeSignature = { numerator: 4, denominator: 4 };
        this.isPlaying = false;
        this.metronomeEnabled = false;
        
        // Initialize Tone.js
        this.initializeTone();
        
        // Initialize 8 tracks
        for (let i = 0; i < 8; i++) {
            this.initializeTrack(i);
        }
        
        // Setup metronome
        this.setupMetronome();
        
        // Sound library
        this.soundLibrary = this.loadSoundLibrary();
        
        // Scale definitions
        this.scales = {
            major: [0, 2, 4, 5, 7, 9, 11],
            minor: [0, 2, 3, 5, 7, 8, 10],
            dorian: [0, 2, 3, 5, 7, 9, 10],
            mixolydian: [0, 2, 4, 5, 7, 9, 10],
            blues: [0, 3, 5, 6, 7, 10],
            pentatonic: [0, 2, 4, 7, 9],
            chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            wholetone: [0, 2, 4, 6, 8, 10],
            arabic: [0, 1, 4, 5, 7, 8, 11],
            japanese: [0, 1, 5, 7, 8]
        };
        
        this.noteFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        };
    }
    
    initializeTone() {
        // Set up Tone.js Transport
        Tone.Transport.bpm.value = this.bpm;
        Tone.Transport.timeSignature = [this.timeSignature.numerator, this.timeSignature.denominator];
        
        // Set lower latency for better performance
        // Note: latencyHint is read-only after context creation
        // We'll just set lookAhead for performance
        if (Tone.context && Tone.context.lookAhead !== undefined) {
            Tone.context.lookAhead = 0.01;
        }
    }
    
    initializeTrack(index) {
        // Create a comprehensive effects chain for each track
        const effects = {
            // Dynamics
            compressor: new Tone.Compressor({
                threshold: -20,
                ratio: 4,
                attack: 0.003,
                release: 0.1
            }),
            
            // EQ
            eq3: new Tone.EQ3({
                low: 0,
                mid: 0,
                high: 0,
                lowFrequency: 400,
                highFrequency: 2500
            }),
            
            // Distortion/Saturation
            distortion: new Tone.Distortion({
                distortion: 0,
                wet: 0
            }),
            
            // Filter
            filter: new Tone.Filter({
                frequency: 5000,
                type: "lowpass",
                rolloff: -24
            }),
            
            // Spatial Effects
            chorus: new Tone.Chorus({
                frequency: 2,
                delayTime: 3.5,
                depth: 0.7,
                wet: 0
            }),
            
            phaser: new Tone.Phaser({
                frequency: 1,
                depth: 1,
                baseFrequency: 1000,
                wet: 0
            }),
            
            // Time-based effects
            delay: new Tone.FeedbackDelay({
                delayTime: 0.25,
                feedback: 0.2,
                wet: 0
            }),
            
            // Use Freeverb instead of Reverb - much more efficient
            reverb: new Tone.Freeverb({
                roomSize: 0.7,
                dampening: 3000,
                wet: 0 // Start with reverb off
            }),
            
            // Modulation
            tremolo: new Tone.Tremolo({
                frequency: 4,
                depth: 0,
                wet: 1
            }),
            
            vibrato: new Tone.Vibrato({
                frequency: 5,
                depth: 0,
                wet: 1
            }),
            
            // Special Effects
            bitcrusher: new Tone.BitCrusher({
                bits: 8,
                wet: 0
            }),
            
            pitchShift: new Tone.PitchShift({
                pitch: 0,
                wet: 0
            }),
            
            // Utility
            panner: new Tone.Panner(0),
            
            // Gain (Volume)
            gain: new Tone.Gain(0.7)
        };
        
        // Create synth based on default instrument
        const instrumentType = index < 8 ? ['synth', 'piano', 'strings', 'bells', 'pad', 'lead', 'pluck', 'bass'][index] : 'synth';
        const synth = this.createInstrument(instrumentType);
        
        // Simplified effects chain - connect only essential effects
        synth.connect(effects.filter);
        effects.filter.connect(effects.gain);
        effects.gain.toDestination();
        
        // Keep other effects ready but disconnected for performance
        effects.compressor.connect(effects.eq3);
        effects.eq3.connect(effects.distortion);
        effects.distortion.disconnect();
        
        effects.chorus.connect(effects.phaser);
        effects.phaser.connect(effects.tremolo);
        effects.tremolo.connect(effects.vibrato);
        effects.vibrato.disconnect();
        
        effects.bitcrusher.connect(effects.pitchShift);
        effects.pitchShift.disconnect();
        
        effects.delay.connect(effects.reverb);
        effects.reverb.connect(effects.panner);
        effects.panner.disconnect();
        
        // Store track data with effect routing info
        this.tracks[index] = {
            synth: synth,
            effects: effects,
            instrument: instrumentType,
            muted: false,
            solo: false,
            effectsActive: {
                filter: true,
                reverb: false,
                delay: false,
                eq3: false,
                compressor: false,
                distortion: false,
                chorus: false,
                phaser: false,
                tremolo: false,
                vibrato: false,
                bitcrusher: false,
                pitchShift: false,
                panner: false
            }
        };
        
        // Initialize sequencer data for this track
        this.sequencerData[index] = {
            beats: new Array(64).fill(false),
            resolution: 'quarter',
            notes: {} // For piano roll data
        };
    }
    
    createInstrument(type) {
        const instruments = {
            synth: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 8, // Limit polyphony
                oscillator: { type: "sawtooth" },
                envelope: {
                    attack: 0.01,
                    decay: 0.3,
                    sustain: 0.4,
                    release: 0.8
                }
            }),
            
            piano: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 8,
                oscillator: { type: "triangle" },
                envelope: {
                    attack: 0.005,
                    decay: 0.1,
                    sustain: 0.3,
                    release: 1.4
                }
            }),
            
            strings: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 6,
                oscillator: { type: "sawtooth" },
                envelope: {
                    attack: 0.4,
                    decay: 0.1,
                    sustain: 0.6,
                    release: 0.8
                },
                filterEnvelope: {
                    attack: 0.2,
                    decay: 0.2,
                    sustain: 0.5,
                    release: 0.8,
                    baseFrequency: 200,
                    octaves: 2
                }
            }),
            
            bells: () => new Tone.PolySynth(Tone.FMSynth, {
                maxPolyphony: 6,
                harmonicity: 3,
                modulationIndex: 10,
                envelope: {
                    attack: 0.001,
                    decay: 0.4,
                    sustain: 0.0,
                    release: 0.8
                }
            }),
            
            bass: () => new Tone.MonoSynth({
                oscillator: { type: "square" },
                envelope: {
                    attack: 0.01,
                    decay: 0.1,
                    sustain: 0.9,
                    release: 0.1
                },
                filterEnvelope: {
                    attack: 0.01,
                    decay: 0.1,
                    sustain: 0.5,
                    release: 0.1,
                    baseFrequency: 100,
                    octaves: 2.5
                }
            }),
            
            lead: () => new Tone.MonoSynth({
                oscillator: { type: "square" },
                envelope: {
                    attack: 0.02,
                    decay: 0.1,
                    sustain: 0.3,
                    release: 0.2
                },
                filterEnvelope: {
                    attack: 0.02,
                    decay: 0.1,
                    sustain: 0.8,
                    release: 0.3,
                    baseFrequency: 800,
                    octaves: 1.5
                }
            }),
            
            pad: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 4,
                oscillator: { type: "sine" },
                envelope: {
                    attack: 0.8,
                    decay: 0.5,
                    sustain: 0.8,
                    release: 2.0
                }
            }),
            
            pluck: () => new Tone.PluckSynth({
                attackNoise: 2,
                dampening: 4000,
                resonance: 0.98
            }),
            
            organ: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 6,
                oscillator: { type: "sine" },
                envelope: {
                    attack: 0.01,
                    decay: 0.0,
                    sustain: 1.0,
                    release: 0.5
                }
            }),
            
            flute: () => new Tone.MonoSynth({
                oscillator: { type: "sine" },
                envelope: {
                    attack: 0.1,
                    decay: 0.0,
                    sustain: 1.0,
                    release: 0.5
                },
                filterEnvelope: {
                    attack: 0.06,
                    decay: 0.1,
                    sustain: 0.5,
                    release: 0.1,
                    baseFrequency: 2000,
                    octaves: 2
                }
            }),
            
            brass: () => new Tone.MonoSynth({
                oscillator: { type: "sawtooth" },
                envelope: {
                    attack: 0.1,
                    decay: 0.1,
                    sustain: 0.6,
                    release: 0.5
                },
                filterEnvelope: {
                    attack: 0.05,
                    decay: 0.1,
                    sustain: 0.4,
                    release: 0.5,
                    baseFrequency: 300,
                    octaves: 3
                }
            }),
            
            choir: () => new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 4,
                oscillator: { type: "triangle" },
                envelope: {
                    attack: 0.4,
                    decay: 0.2,
                    sustain: 0.6,
                    release: 0.9
                }
            })
        };
        
        return instruments[type] ? instruments[type]() : instruments.synth();
    }
    
    setupMetronome() {
        this.metronome = new Tone.MembraneSynth({
            pitchDecay: 0.01,
            octaves: 4,
            oscillator: { type: "sine" },
            envelope: {
                attack: 0.001,
                decay: 0.1,
                sustain: 0,
                release: 0.1
            }
        }).toDestination();
        
        // Setup metronome pattern
        this.metronomePattern = new Tone.Pattern((time, note) => {
            if (this.metronomeEnabled) {
                this.metronome.triggerAttackRelease(note, "16n", time);
            }
        }, ["C2", "C1", "C1", "C1"], "up");
        this.metronomePattern.interval = "4n";
    }
    
    // Track control methods
    setTrackInstrument(trackIndex, instrumentType) {
        const track = this.tracks[trackIndex];
        if (!track) return;
        
        // Disconnect old synth
        track.synth.disconnect();
        
        // Create new synth
        track.synth = this.createInstrument(instrumentType);
        track.instrument = instrumentType;
        
        // Reconnect to effects chain (connect to filter which is our main input)
        track.synth.connect(track.effects.filter);
    }
    
    // Legacy compatibility methods
    setTrackReverb(trackIndex, value) {
        this.setTrackEffect(trackIndex, 'reverb', value);
        // Connect reverb chain when reverb is turned on
        const track = this.tracks[trackIndex];
        if (track && value > 0 && !track.effectsActive.reverb) {
            track.effects.filter.disconnect();
            track.effects.filter.connect(track.effects.delay);
            track.effects.panner.connect(track.effects.gain);
            track.effectsActive.reverb = true;
            track.effectsActive.delay = true;
            track.effectsActive.panner = true;
        } else if (track && value === 0 && track.effectsActive.reverb) {
            // Disconnect reverb chain when turned off
            track.effects.filter.disconnect();
            track.effects.filter.connect(track.effects.gain);
            track.effectsActive.reverb = false;
            track.effectsActive.delay = false;
            track.effectsActive.panner = false;
        }
    }
    
    setTrackDelay(trackIndex, value) {
        this.setTrackEffect(trackIndex, 'delay', value);
    }
    
    setTrackFilter(trackIndex, value) {
        this.setTrackEffect(trackIndex, 'filter', value);
    }
    
    setTrackVolume(trackIndex, value) {
        this.setTrackEffect(trackIndex, 'gain', value);
    }
    
    setTrackDecay(trackIndex, value) {
        // Map decay to envelope release time
        const track = this.tracks[trackIndex];
        if (track && track.synth.envelope) {
            track.synth.envelope.release = 0.1 + (value / 100) * 2;
        }
    }
    
    setTrackPan(trackIndex, value) {
        this.setTrackEffect(trackIndex, 'panner', value);
    }
    
    setTrackEQ(trackIndex, band, value) {
        const track = this.tracks[trackIndex];
        if (!track || !track.effects.eq3) return;
        
        // Convert -20 to +20 dB range to gain values
        const gain = value; // Already in dB
        
        switch(band) {
            case 'low':
                track.effects.eq3.low.value = gain;
                break;
            case 'mid':
                track.effects.eq3.mid.value = gain;
                break;
            case 'high':
                track.effects.eq3.high.value = gain;
                break;
        }
    }
    
    // Effect control methods
    setTrackEffect(trackIndex, effectName, value) {
        const track = this.tracks[trackIndex];
        if (!track || !track.effects[effectName]) return;
        
        const effect = track.effects[effectName];
        
        switch(effectName) {
            case 'reverb':
                effect.wet.value = value / 100;
                break;
            case 'delay':
                effect.wet.value = value / 100;
                break;
            case 'filter':
                effect.frequency.value = 50 + (value / 100) * 19950; // 50Hz to 20kHz
                break;
            case 'distortion':
                effect.wet.value = value / 100;
                effect.distortion = value / 100;
                break;
            case 'chorus':
                effect.wet.value = value / 100;
                break;
            case 'phaser':
                effect.wet.value = value / 100;
                break;
            case 'tremolo':
                effect.depth.value = value / 100;
                break;
            case 'vibrato':
                effect.depth.value = value / 100;
                break;
            case 'bitcrusher':
                effect.wet.value = value / 100;
                effect.bits = Math.max(1, 8 - (value / 100) * 7);
                break;
            case 'pitchShift':
                effect.pitch = (value - 50) / 50 * 12; // -12 to +12 semitones
                effect.wet.value = Math.abs(value - 50) / 50;
                break;
            case 'eq3':
                // For EQ, we'd need separate controls for low/mid/high
                break;
            case 'compressor':
                effect.threshold.value = -60 + (value / 100) * 60; // -60 to 0 dB
                break;
            case 'panner':
                effect.pan.value = (value - 50) / 50; // -1 to 1
                break;
            case 'gain':
                effect.gain.value = value / 100;
                break;
        }
    }
    
    // Sequencer methods
    setSequencerBeat(trackIndex, beatIndex, active) {
        if (this.sequencerData[trackIndex]) {
            this.sequencerData[trackIndex].beats[beatIndex] = active;
        }
    }
    
    setTrackResolution(trackIndex, resolution) {
        if (this.sequencerData[trackIndex]) {
            this.sequencerData[trackIndex].resolution = resolution;
        }
    }
    
    async startSequencer() {
        await Tone.start();
        
        // Clear any existing sequences
        Tone.Transport.cancel();
        
        // Setup the main sequencer loop
        const sequence = new Tone.Sequence((time, beatIndex) => {
            // Play each track
            this.sequencerData.forEach((trackData, trackIndex) => {
                const track = this.tracks[trackIndex];
                if (!track || track.muted) return;
                
                const resolution = trackData.resolution || 'quarter';
                
                if (resolution === 'quarter') {
                    if (trackData.beats[beatIndex]) {
                        this.playSequencerNote(trackIndex, time);
                    }
                } else if (resolution === 'eighth') {
                    const eighthBeat1 = beatIndex * 2;
                    const eighthBeat2 = beatIndex * 2 + 1;
                    const eighthDuration = Tone.Time("8n").toSeconds();
                    
                    if (trackData.beats[eighthBeat1]) {
                        this.playSequencerNote(trackIndex, time);
                    }
                    if (trackData.beats[eighthBeat2]) {
                        this.playSequencerNote(trackIndex, time + eighthDuration);
                    }
                } else if (resolution === 'sixteenth') {
                    const sixteenthDuration = Tone.Time("16n").toSeconds();
                    for (let i = 0; i < 4; i++) {
                        const sixteenthBeat = beatIndex * 4 + i;
                        if (trackData.beats[sixteenthBeat]) {
                            this.playSequencerNote(trackIndex, time + (i * sixteenthDuration));
                        }
                    }
                }
            });
        }, Array.from({length: 16}, (_, i) => i), "4n");
        
        sequence.start(0);
        
        // Start metronome if enabled
        if (this.metronomeEnabled) {
            this.metronomePattern.start(0);
        }
        
        Tone.Transport.start();
        this.isPlaying = true;
    }
    
    stopSequencer() {
        Tone.Transport.stop();
        Tone.Transport.cancel();
        this.metronomePattern.stop();
        this.isPlaying = false;
    }
    
    playSequencerNote(trackIndex, time) {
        const track = this.tracks[trackIndex];
        if (!track) return;
        
        const note = this.getNoteInScale(Math.floor(Math.random() * 8));
        track.synth.triggerAttackRelease(note, "16n", time);
    }
    
    // Note generation
    getNoteInScale(scaleIndex) {
        const scale = this.scales[this.currentScale] || this.scales.major;
        const noteIndex = scale[scaleIndex % scale.length];
        const keyOffset = Object.keys(this.noteFrequencies).indexOf(this.currentKey);
        const finalNoteIndex = (keyOffset + noteIndex) % 12;
        const noteName = Object.keys(this.noteFrequencies)[finalNoteIndex];
        return noteName + this.currentOctave;
    }
    
    // Legacy compatibility for samples
    stopSample(touchId) {
        // In Tone.js version, we just stop the note
        this.stopNote(touchId);
    }
    
    // Legacy compatibility method
    async playNoteOrSample(x, y, canvasWidth, canvasHeight, touchId, trackIndex, instrument) {
        // Start audio context on first touch
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        
        const track = this.tracks[trackIndex];
        if (!track || track.muted) return { frequency: 0, midiNote: 60 };
        
        // Map x position to scale degree with more resolution
        const numNotes = 16; // Use 16 notes across the width
        const scaleIndex = Math.floor((x / canvasWidth) * numNotes);
        const note = this.getNoteInScale(scaleIndex % this.scales[this.currentScale].length);
        const frequency = Tone.Frequency(note).toFrequency();
        const midiNote = Tone.Frequency(note).toMidi();
        
        // Store active notes for polyphonic playback
        if (!this.activeNotes) {
            this.activeNotes = new Map();
        }
        
        // Stop any existing note for this touch ID
        if (this.activeNotes.has(touchId)) {
            const oldNote = this.activeNotes.get(touchId);
            if (oldNote && oldNote.synth) {
                oldNote.synth.triggerRelease(oldNote.note);
            }
        }
        
        // Trigger the note with a duration for safety
        track.synth.triggerAttackRelease(note, "8n", Tone.now(), 0.8);
        this.activeNotes.set(touchId, { trackIndex, note, synth: track.synth });
        
        if (window.debugLog) {
            window.debugLog.log('Note started: ' + note + ' touchId: ' + touchId);
        }
        
        return { frequency, midiNote };
    }
    
    // Play methods for multi-track view
    playNote(trackIndex, touchId, frequency) {
        const track = this.tracks[trackIndex];
        if (!track || track.muted) return;
        
        // Convert frequency to note name
        const note = Tone.Frequency(frequency).toNote();
        
        // Store active notes for polyphonic playback
        if (!this.activeNotes) {
            this.activeNotes = new Map();
        }
        
        // Stop any existing note for this touch ID
        if (this.activeNotes.has(touchId)) {
            const oldNote = this.activeNotes.get(touchId);
            if (oldNote && oldNote.synth) {
                oldNote.synth.triggerRelease(oldNote.note);
            }
        }
        
        // Trigger the note with a duration for safety
        track.synth.triggerAttackRelease(note, "8n", Tone.now(), 0.8);
        this.activeNotes.set(touchId, { trackIndex, note, synth: track.synth });
        
        if (window.debugLog) {
            window.debugLog.log('Note started: ' + note + ' touchId: ' + touchId);
        }
        
        return frequency;
    }
    
    stopNote(touchId) {
        if (window.debugLog) {
            window.debugLog.log('stopNote called for touchId: ' + touchId);
        }
        
        if (!this.activeNotes || !this.activeNotes.has(touchId)) {
            if (window.debugLog) {
                window.debugLog.log('No active note found for touchId: ' + touchId);
            }
            return;
        }
        
        const noteData = this.activeNotes.get(touchId);
        const track = this.tracks[noteData.trackIndex];
        
        if (track && track.synth) {
            track.synth.triggerRelease(noteData.note, Tone.now());
            if (window.debugLog) {
                window.debugLog.log('Note stopped: ' + noteData.note + ' touchId: ' + touchId);
            }
        }
        
        this.activeNotes.delete(touchId);
    }
    
    // Change instrument for a track
    changeInstrument(trackIndex, instrumentType) {
        if (trackIndex < 0 || trackIndex >= this.tracks.length) return;
        
        const track = this.tracks[trackIndex];
        const oldSynth = track.synth;
        
        // Create new instrument
        const newSynth = this.createInstrument(instrumentType);
        
        // Connect to effects chain
        newSynth.connect(track.effectsChain.eq3);
        
        // Disconnect old synth
        oldSynth.disconnect();
        
        // Update track
        track.synth = newSynth;
        track.instrument = instrumentType;
        
        if (window.debugLog) {
            window.debugLog.log('Changed track ' + trackIndex + ' to ' + instrumentType);
        }
    }
    
    // Settings
    setBPM(bpm) {
        this.bpm = bpm;
        Tone.Transport.bpm.value = bpm;
    }
    
    setTimeSignature(numerator, denominator) {
        this.timeSignature = { numerator, denominator };
        Tone.Transport.timeSignature = [numerator, denominator];
    }
    
    setMetronomeEnabled(enabled) {
        this.metronomeEnabled = enabled;
    }
    
    // Sound Library Methods
    loadSoundLibrary() {
        const saved = localStorage.getItem('soundLibrary');
        return saved ? JSON.parse(saved) : {
            categories: {
                'Bass': [],
                'Lead': [],
                'Pad': [],
                'Drums': [],
                'FX': [],
                'User': []
            },
            presets: []
        };
    }
    
    saveSoundLibrary() {
        localStorage.setItem('soundLibrary', JSON.stringify(this.soundLibrary));
    }
    
    saveSound(name, category, trackIndex) {
        const track = this.tracks[trackIndex];
        if (!track) return;
        
        const soundData = {
            name: name,
            category: category,
            instrument: track.instrument,
            effects: {}
        };
        
        // Save all effect settings
        Object.keys(track.effects).forEach(effectName => {
            const effect = track.effects[effectName];
            if (effect.wet) {
                soundData.effects[effectName] = {
                    wet: effect.wet.value
                };
            }
            // Add specific effect parameters
            switch(effectName) {
                case 'filter':
                    soundData.effects[effectName].frequency = effect.frequency.value;
                    break;
                case 'distortion':
                    soundData.effects[effectName].distortion = effect.distortion;
                    break;
                case 'pitchShift':
                    soundData.effects[effectName].pitch = effect.pitch;
                    break;
                case 'panner':
                    soundData.effects[effectName].pan = effect.pan.value;
                    break;
                case 'gain':
                    soundData.effects[effectName].gain = effect.gain.value;
                    break;
            }
        });
        
        // Add to library
        if (!this.soundLibrary.categories[category]) {
            this.soundLibrary.categories[category] = [];
        }
        this.soundLibrary.categories[category].push(soundData);
        
        this.saveSoundLibrary();
        return soundData;
    }
    
    loadSound(soundData, trackIndex) {
        if (!soundData) return;
        
        // Set instrument
        this.setTrackInstrument(trackIndex, soundData.instrument);
        
        // Apply all saved effects
        Object.keys(soundData.effects).forEach(effectName => {
            const effectData = soundData.effects[effectName];
            const track = this.tracks[trackIndex];
            const effect = track.effects[effectName];
            
            if (effect && effectData.wet !== undefined) {
                effect.wet.value = effectData.wet;
            }
            
            // Apply specific parameters
            switch(effectName) {
                case 'filter':
                    if (effectData.frequency) effect.frequency.value = effectData.frequency;
                    break;
                case 'distortion':
                    if (effectData.distortion) effect.distortion = effectData.distortion;
                    break;
                case 'pitchShift':
                    if (effectData.pitch) effect.pitch = effectData.pitch;
                    break;
                case 'panner':
                    if (effectData.pan) effect.pan.value = effectData.pan;
                    break;
                case 'gain':
                    if (effectData.gain) effect.gain.value = effectData.gain;
                    break;
            }
        });
    }
    
    deleteSound(category, index) {
        if (this.soundLibrary.categories[category]) {
            this.soundLibrary.categories[category].splice(index, 1);
            this.saveSoundLibrary();
        }
    }
}

// Export for use in main script
window.ToneAudioEngine = ToneAudioEngine;