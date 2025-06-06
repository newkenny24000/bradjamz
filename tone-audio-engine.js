// Tone.js Audio Engine for 8-Track Studio
// Focused on sample playback with ElevenLabs generated sounds

class ToneAudioEngine {
    constructor() {
        this.tracks = [];
        this.isInitialized = false;
        this.numTracks = 8;
        
        // Musical settings
        this.scale = 'chromatic';
        this.key = 'C';
        this.octave = 3;
        this.bpm = 120;
        
        // Metronome
        this.metronome = null;
        this.metronomeOn = false;
        
        // Sequencer
        this.sequence = null;
        this.isPlaying = false;
        
        // Pending samples to load after initialization
        this.pendingSamples = {};
        
        log('ToneAudioEngine created');
    }
    
    async initialize() {
        log('Initializing Tone.js audio engine...');
        
        try {
            // Check if Tone is available
            if (typeof Tone === 'undefined') {
                throw new Error('Tone.js library not loaded');
            }
            
            // Log current audio context state
            if (Tone.context) {
                log(`Audio context state: ${Tone.context.state}`);
            }
            
            // Start Tone.js with timeout
            log('Starting Tone.js...');
            try {
                const startPromise = Tone.start();
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Tone.js start timeout - please check your browser audio permissions')), 10000);
                });
                
                await Promise.race([startPromise, timeoutPromise]);
                log('Tone.js started successfully');
            } catch (timeoutError) {
                log('Initial Tone.js start timed out, trying without timeout...');
                await Tone.start();
                log('Tone.js started successfully (without timeout)');
            }
            
            // Set up master output
            this.masterGain = new Tone.Gain(0.7).toDestination();
            log('Master gain created');
            
            // Initialize tracks
            for (let i = 0; i < this.numTracks; i++) {
                this.tracks[i] = this.createTrack(i);
            }
            log(`Created ${this.numTracks} tracks`);
            
            // Set up metronome
            this.setupMetronome();
            log('Metronome setup complete');
            
            // Set initial BPM
            Tone.Transport.bpm.value = this.bpm;
            log(`BPM set to ${this.bpm}`);
            
            this.isInitialized = true;
            log('Audio engine initialized successfully');
            
            // Test audio output with a simple tone
            this.testAudioOutput();
            
        } catch (error) {
            log('ERROR: Failed to initialize audio engine:', error);
            this.isInitialized = false;
            throw error;
        }
    }
    
    testAudioOutput() {
        try {
            log('Testing audio output...');
            const testOsc = new Tone.Oscillator(440, 'sine').toDestination();
            testOsc.start();
            testOsc.stop('+0.1');
            log('Audio test completed - you should have heard a brief 440Hz tone');
        } catch (error) {
            log('ERROR: Audio test failed:', error);
        }
    }
    
    createTrack(index) {
        log(`Creating track ${index + 1}...`);
        
        // Create player for better sample control
        const player = new Tone.Player({
            onload: () => {
                log(`Track ${index + 1} player ready`);
            }
        });
        
        // Create effects chain - start with effects disabled
        const reverb = new Tone.Reverb({
            decay: 2.5,
            wet: 0 // Start disabled
        });
        
        const delay = new Tone.FeedbackDelay({
            delayTime: '8n',
            feedback: 0.3,
            wet: 0 // Already disabled
        });
        
        const gain = new Tone.Gain(0.7);
        
        // Connect chain for processed audio
        player.chain(delay, reverb, gain, this.masterGain);
        
        // Create a direct bypass player for original sound
        const bypassPlayer = new Tone.Player().toDestination();
        bypassPlayer.onerror = (error) => {
            log(`ERROR: Bypass player error for track ${index + 1}:`, error);
        };
        bypassPlayer.onstop = () => {
            log(`Bypass player stopped for track ${index + 1}`);
        };
        bypassPlayer.onload = () => {
            log(`Track ${index + 1} bypass player ready`);
        };
        
        // Create Sampler for sequencer - better for repeated playback
        const sampler = new Tone.Sampler({
            onload: () => {
                log(`Track ${index + 1} sampler ready for sequencer`);
            }
        });
        sampler.chain(delay, reverb, gain, this.masterGain);
        
        return {
            player: player,
            bypassPlayer: bypassPlayer, // Direct to output, no effects
            sampler: sampler, // For sequencer playback
            effects: {
                reverb: reverb,
                delay: delay,
                gain: gain
            },
            sample: null,
            sampleName: null,
            noteLength: '8n'
        };
    }
    
    async loadSample(trackIndex, url, name) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) {
            log(`ERROR: Invalid track index: ${trackIndex}`);
            return;
        }
        
        log(`Loading sample "${name}" into track ${trackIndex + 1}...`);
        
        // Check if audio engine is initialized
        if (!this.isInitialized || !this.tracks || !this.tracks[trackIndex]) {
            log(`Audio engine not ready, storing sample for later: "${name}"`);
            // Store the sample info for when audio engine is ready
            this.pendingSamples[trackIndex] = { url, name };
            return;
        }
        
        try {
            const track = this.tracks[trackIndex];
            
            if (!track || !track.player) {
                throw new Error(`Track ${trackIndex + 1} not properly initialized`);
            }
            
            // Load the sample into players
            await Promise.all([
                track.player.load(url),
                track.bypassPlayer.load(url)
            ]);
            
            // Load into sampler (different method for Sampler)
            track.sampler.add('C4', url);
            
            track.sample = url;
            track.sampleName = name;
            
            log(`Sample loaded successfully: "${name}" on track ${trackIndex + 1} - Player: ${track.player.loaded}, Bypass: ${track.bypassPlayer.loaded}, Sampler: ${track.sampler.loaded}`);
            
        } catch (error) {
            log(`ERROR: Failed to load sample:`, error);
            throw error;
        }
    }
    
    async playNote(trackIndex, normalizedX, normalizedY) {
        if (!this.isInitialized || trackIndex < 0 || trackIndex >= this.numTracks) {
            return null;
        }
        
        const track = this.tracks[trackIndex];
        
        if (!track.sample) {
            log(`Track ${trackIndex + 1} has no sample loaded`);
            return null;
        }
        
        // Map X position to pitch (semitones from base note)
        // Full range: -12 to +12 semitones (1 octave down to 1 octave up)
        const pitchRange = 24; // 2 octaves total
        const semitones = Math.floor(normalizedX * pitchRange) - 12;
        
        // Map Y position to velocity and slight pitch variation
        const velocity = Math.max(0.1, Math.min(1.0, normalizedY));
        
        // Calculate playback rate for pitch shifting
        const playbackRate = Math.pow(2, semitones / 12);
        
        // Determine if we should use original sound (center area)
        const centerTolerance = 0.05; // 5% tolerance around center
        const isOriginalPitch = Math.abs(normalizedX - 0.5) < centerTolerance && semitones === 0;
        
        // Play the sample
        try {
            // Make sure Tone.js is started
            if (Tone.context.state !== 'running') {
                log('Tone.js context not running, attempting to start...');
                await Tone.start();
            }
            
            if (isOriginalPitch && track.bypassPlayer.loaded) {
                // Use bypass player for original, unprocessed sound
                if (track.bypassPlayer.state === 'started') {
                    track.bypassPlayer.stop();
                }
                
                track.bypassPlayer.volume.value = Tone.gainToDb(velocity * 0.7); // Match master gain
                track.bypassPlayer.start();
                
                log(`Playing ORIGINAL sound on track ${trackIndex + 1}: velocity=${velocity.toFixed(2)} (no effects, no pitch shift)`);
                
                return {
                    semitones: 0,
                    velocity: velocity,
                    playbackRate: 1.0,
                    original: true
                };
            }
            
            // Use regular processed player for all other positions
            if (!track.player.loaded) {
                log(`ERROR: Track ${trackIndex + 1} player not loaded yet`);
                return null;
            }
            
            // Stop any previous playback
            if (track.player.state === 'started') {
                track.player.stop();
            }
            
            // Set playback rate for pitch shifting
            track.player.playbackRate = playbackRate;
            
            // Set volume through the gain node
            if (track.effects && track.effects.gain) {
                track.effects.gain.gain.value = velocity;
            } else {
                log(`WARNING: Track ${trackIndex + 1} has no gain control`);
            }
            
            // Start the player
            track.player.start();
            
            // Debug audio context and volume levels
            const trackVolume = track.effects && track.effects.gain ? track.effects.gain.gain.value : 'N/A';
            log(`Audio context state: ${Tone.context.state}, Master volume: ${this.masterGain.gain.value}, Track volume: ${trackVolume}`);
            log(`Playing track ${trackIndex + 1}: pitch=${semitones} semitones, velocity=${velocity.toFixed(2)}, rate=${playbackRate.toFixed(2)}, state=${track.player.state}`);
            
            return {
                semitones: semitones,
                velocity: velocity,
                playbackRate: playbackRate
            };
        } catch (error) {
            log(`ERROR: Failed to play note:`, error);
            return null;
        }
    }
    
    stopNote(trackIndex) {
        if (!this.isInitialized || trackIndex < 0 || trackIndex >= this.numTracks) {
            return;
        }
        
        const track = this.tracks[trackIndex];
        
        try {
            track.player.stop();
        } catch (error) {
            log(`ERROR: Failed to stop note:`, error);
        }
    }
    
    updateTrackEffect(trackIndex, effectName, value) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) {
            return;
        }
        
        const track = this.tracks[trackIndex];
        const normalizedValue = value / 100;
        
        switch (effectName) {
            case 'reverb':
                track.effects.reverb.wet.value = normalizedValue * 0.8;
                break;
            case 'delay':
                track.effects.delay.wet.value = normalizedValue * 0.6;
                break;
            case 'volume':
                track.effects.gain.gain.value = normalizedValue;
                break;
            case 'decay':
                // Adjust sample envelope if possible
                track.noteLength = normalizedValue < 0.3 ? '16n' : 
                                 normalizedValue < 0.6 ? '8n' : '4n';
                break;
        }
    }
    
    setupMetronome() {
        log('Setting up metronome...');
        
        this.metronome = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.001,
                decay: 0.1,
                sustain: 0,
                release: 0.1
            }
        }).toDestination();
        
        // Create metronome pattern
        this.metronomeLoop = new Tone.Loop((time) => {
            if (this.metronomeOn) {
                const beat = Math.floor(Tone.Transport.position.split(':')[1]);
                const freq = beat === 0 ? 880 : 440;
                this.metronome.triggerAttackRelease(freq, '16n', time);
            }
        }, '4n');
    }
    
    toggleMetronome() {
        this.metronomeOn = !this.metronomeOn;
        
        if (this.metronomeOn && !this.metronomeLoop.state === 'started') {
            this.metronomeLoop.start(0);
            Tone.Transport.start();
        }
        
        log(`Metronome ${this.metronomeOn ? 'enabled' : 'disabled'}`);
        return this.metronomeOn;
    }
    
    setScale(scale) {
        this.scale = scale;
        log(`Scale set to: ${scale}`);
    }
    
    setKey(key) {
        this.key = key;
        log(`Key set to: ${key}`);
    }
    
    setOctave(octave) {
        this.octave = octave;
        log(`Octave set to: ${octave}`);
    }
    
    setBPM(bpm) {
        this.bpm = bpm;
        Tone.Transport.bpm.value = bpm;
        log(`BPM set to: ${bpm}`);
    }
    
    startSequencer() {
        if (!this.isPlaying) {
            Tone.Transport.start();
            this.isPlaying = true;
            log('Sequencer started');
        }
    }
    
    stopSequencer() {
        if (this.isPlaying) {
            Tone.Transport.stop();
            this.isPlaying = false;
            log('Sequencer stopped');
        }
    }
    
    clearSequence() {
        // Clear the beat sequencer patterns
        if (typeof clearSequencer === 'function') {
            clearSequencer();
        }
        log('Sequence cleared');
    }
    
    // Enhanced sequencer support
    playSequencerSample(trackIndex, volume = 1.0, time = null, semitones = 0) {
        const track = this.tracks[trackIndex];
        if (!track || !track.sample) {
            return null;
        }
        
        try {
            // Use sampler for polyphonic sequencer playback
            const playTime = time || Tone.now();
            
            // Set volume by adjusting the gain effect
            const originalGain = track.effects.gain.gain.value;
            track.effects.gain.gain.setValueAtTime(volume, playTime);
            
            // Calculate note based on semitone offset
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const baseNoteIndex = 0; // C4 = 0
            const targetNoteIndex = (baseNoteIndex + semitones + 12 * 10) % 12;
            const octaveOffset = Math.floor((baseNoteIndex + semitones + 12 * 10) / 12) - 10 + 4; // Base octave 4
            const noteName = noteNames[targetNoteIndex] + octaveOffset;
            
            // Trigger the sample at the calculated pitch
            track.sampler.triggerAttack(noteName, playTime);
            
            // Reset gain after a short time to avoid affecting other playback
            track.effects.gain.gain.setValueAtTime(originalGain, playTime + 0.1);
            
            log(`Sequencer triggered sampler for track ${trackIndex + 1}, volume: ${volume.toFixed(2)}, note: ${noteName} (${semitones > 0 ? '+' : ''}${semitones})`);
            return track.sampler;
            
        } catch (error) {
            log(`ERROR: Failed to play sequencer sample on track ${trackIndex + 1}:`, error);
            return null;
        }
    }
    
    panic() {
        log('PANIC: Stopping all sounds...');
        
        // Stop all tracks
        this.tracks.forEach((track, index) => {
            try {
                track.sampler.releaseAll();
            } catch (error) {
                log(`Error stopping track ${index + 1}:`, error);
            }
        });
        
        // Stop transport
        Tone.Transport.stop();
        Tone.Transport.cancel();
        
        // Reset
        this.isPlaying = false;
        
        log('All sounds stopped');
    }
    
    dispose() {
        log('Disposing audio engine...');
        
        this.panic();
        
        // Dispose tracks
        this.tracks.forEach(track => {
            track.sampler.dispose();
            track.effects.reverb.dispose();
            track.effects.delay.dispose();
            track.effects.gain.dispose();
        });
        
        // Dispose metronome
        if (this.metronome) {
            this.metronome.dispose();
            this.metronomeLoop.dispose();
        }
        
        // Dispose master
        this.masterGain.dispose();
        
        this.isInitialized = false;
        log('Audio engine disposed');
    }
}