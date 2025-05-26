// Web Audio API Musical Instrument Engine
class AudioEngine {
    constructor() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Audio context created, state:', this.audioContext.state);
        } catch (e) {
            console.error('Failed to create audio context:', e);
            alert('Your browser does not support Web Audio API');
            return;
        }
        
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
        
        // Effects chain
        this.reverb = this.createReverb();
        this.delay = this.createDelay();
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.setValueAtTime(5000, this.audioContext.currentTime);
        
        // Connect effects chain
        this.filter.connect(this.delay.input);
        this.delay.output.connect(this.reverb.input);
        this.reverb.output.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
        
        // Active voices for polyphony
        this.voices = new Map();
        
        // Recording
        this.recording = false;
        this.recordedNotes = [];
        this.recordStartTime = 0;
        
        // Current instrument settings
        this.currentInstrument = 'synth';
        this.currentScale = 'major';
        this.currentKey = 'C';
        this.currentOctave = 4;
        this.sustainTime = 0.1; // How long note plays after release
        
        // Sample storage for generated sounds
        this.samples = new Map(); // trackIndex -> { buffer, name, mode }
        this.sampleVoices = new Map(); // touchId -> bufferSource
    }
    
    createReverb() {
        const convolver = this.audioContext.createConvolver();
        const length = this.audioContext.sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        convolver.buffer = impulse;
        
        const wetGain = this.audioContext.createGain();
        const dryGain = this.audioContext.createGain();
        const output = this.audioContext.createGain();
        
        wetGain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        dryGain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
        
        // Create proper input splitter
        const input = this.audioContext.createGain();
        
        input.connect(convolver);
        input.connect(dryGain);
        convolver.connect(wetGain);
        wetGain.connect(output);
        dryGain.connect(output);
        
        return {
            input: input,
            dryGain: dryGain,
            wetGain: wetGain,
            output: output,
            setMix: (value) => {
                const wet = value / 100;
                const dry = 1 - wet;
                wetGain.gain.setTargetAtTime(wet, this.audioContext.currentTime, 0.01);
                dryGain.gain.setTargetAtTime(dry, this.audioContext.currentTime, 0.01);
            }
        };
    }
    
    createDelay() {
        const delay = this.audioContext.createDelay(1);
        const feedback = this.audioContext.createGain();
        const wetGain = this.audioContext.createGain();
        const dryGain = this.audioContext.createGain();
        const output = this.audioContext.createGain();
        
        delay.delayTime.setValueAtTime(0.25, this.audioContext.currentTime);
        feedback.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        wetGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        dryGain.gain.setValueAtTime(1, this.audioContext.currentTime);
        
        // Create proper input splitter
        const input = this.audioContext.createGain();
        
        input.connect(delay);
        input.connect(dryGain);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wetGain);
        wetGain.connect(output);
        dryGain.connect(output);
        
        return {
            input: input,
            output: output,
            dryGain: dryGain,
            setMix: (value) => {
                const wet = value / 100 * 0.5;
                const dry = 1 - wet;
                wetGain.gain.setTargetAtTime(wet, this.audioContext.currentTime, 0.01);
                dryGain.gain.setTargetAtTime(dry, this.audioContext.currentTime, 0.01);
            },
            setTime: (value) => {
                delay.delayTime.setTargetAtTime(value / 100 * 0.5, this.audioContext.currentTime, 0.01);
            }
        };
    }
    
    getFrequency(x, y, width, height) {
        const scales = {
            major: [0, 2, 4, 5, 7, 9, 11, 12],
            minor: [0, 2, 3, 5, 7, 8, 10, 12],
            pentatonic: [0, 2, 4, 7, 9, 12],
            blues: [0, 3, 5, 6, 7, 10, 12],
            arabic: [0, 1, 4, 5, 7, 8, 11, 12],
            chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            japanese: [0, 1, 5, 7, 8, 12],
            wholetone: [0, 2, 4, 6, 8, 10, 12]
        };
        
        const keyOffsets = { 
            'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 
            'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 
        };
        const baseNote = 60 + keyOffsets[this.currentKey] + (this.currentOctave - 4) * 12;
        
        const scale = scales[this.currentScale];
        const horizontalSteps = 8;
        
        // For multi-instrument mode, we use the same octave range for each row
        const xStep = Math.floor(x / width * horizontalSteps);
        const noteIndex = xStep % scale.length;
        
        const midiNote = baseNote + scale[noteIndex];
        const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        console.log(`Note calc: X:${Math.round(x)} -> MIDI:${midiNote} Freq:${Math.round(frequency)}Hz`);
        
        return { frequency, midiNote };
    }
    
    createVoice(frequency, touchId, instrument) {
        const now = this.audioContext.currentTime;
        const voice = {
            oscillators: [],
            gain: this.audioContext.createGain(),
            touchId: touchId,
            instrument: instrument || this.currentInstrument
        };
        
        console.log(`Creating ${voice.instrument} voice at ${Math.round(frequency)}Hz`);
        
        switch (voice.instrument) {
            case 'synth':
                this.createSynthVoice(voice, frequency);
                break;
            case 'piano':
                this.createPianoVoice(voice, frequency);
                break;
            case 'strings':
                this.createStringsVoice(voice, frequency);
                break;
            case 'bells':
                this.createBellsVoice(voice, frequency);
                break;
            case 'bass':
                this.createBassVoice(voice, frequency);
                break;
            case 'lead':
                this.createLeadVoice(voice, frequency);
                break;
            case 'pad':
                this.createPadVoice(voice, frequency);
                break;
            case 'pluck':
                this.createPluckVoice(voice, frequency);
                break;
            case 'organ':
                this.createOrganVoice(voice, frequency);
                break;
            case 'flute':
                this.createFluteVoice(voice, frequency);
                break;
            case 'brass':
                this.createBrassVoice(voice, frequency);
                break;
            case 'choir':
                this.createChoirVoice(voice, frequency);
                break;
            default:
                console.warn('Unknown instrument:', voice.instrument);
                this.createSynthVoice(voice, frequency);
                break;
        }
        
        voice.gain.connect(this.filter);
        voice.gain.gain.setValueAtTime(0, now);
        voice.gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        
        // Add a safety timeout to auto-stop after 10 seconds
        voice.safetyTimeout = setTimeout(() => {
            console.log('Safety timeout - stopping voice:', touchId);
            this.stopNote(touchId);
        }, 10000);
        
        return voice;
    }
    
    createSynthVoice(voice, frequency) {
        // Classic analog synth with filter sweep
        const osc1 = this.audioContext.createOscillator();
        const osc2 = this.audioContext.createOscillator();
        const filter = this.audioContext.createBiquadFilter();
        
        osc1.type = 'sawtooth';
        osc2.type = 'square';
        
        osc1.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        osc2.frequency.setValueAtTime(frequency * 0.5, this.audioContext.currentTime);
        osc1.detune.setValueAtTime(5, this.audioContext.currentTime);
        
        // Resonant filter
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 8, this.audioContext.currentTime);
        filter.Q.setValueAtTime(12, this.audioContext.currentTime);
        
        // Filter envelope
        const now = this.audioContext.currentTime;
        filter.frequency.exponentialRampToValueAtTime(frequency * 2, now + 0.2);
        
        const gain1 = this.audioContext.createGain();
        const gain2 = this.audioContext.createGain();
        gain1.gain.setValueAtTime(0.6, this.audioContext.currentTime);
        gain2.gain.setValueAtTime(0.4, this.audioContext.currentTime);
        
        osc1.connect(gain1);
        osc2.connect(gain2);
        gain1.connect(filter);
        gain2.connect(filter);
        filter.connect(voice.gain);
        
        osc1.start();
        osc2.start();
        
        voice.oscillators.push(osc1, osc2);
    }
    
    createPianoVoice(voice, frequency) {
        // Realistic piano with inharmonic partials and hammer noise
        const partials = [
            {freq: 1, amp: 1},
            {freq: 2.01, amp: 0.5},
            {freq: 3.02, amp: 0.25},
            {freq: 4.04, amp: 0.125},
            {freq: 5.06, amp: 0.06}
        ];
        
        // Create partials
        partials.forEach(partial => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency * partial.freq, this.audioContext.currentTime);
            
            // Piano-like envelope
            const now = this.audioContext.currentTime;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(partial.amp * 0.8, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(partial.amp * 0.3, now + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 2);
            
            osc.connect(gain);
            gain.connect(voice.gain);
            osc.start();
            voice.oscillators.push(osc);
        });
        
        // Add hammer noise
        const noise = this.audioContext.createBufferSource();
        const noiseBuffer = this.audioContext.createBuffer(1, 0.05 * this.audioContext.sampleRate, this.audioContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() - 0.5) * Math.exp(-i / noiseData.length * 10);
        }
        noise.buffer = noiseBuffer;
        
        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.setValueAtTime(0.02, this.audioContext.currentTime);
        
        noise.connect(noiseGain);
        noiseGain.connect(voice.gain);
        noise.start();
    }
    
    createStringsVoice(voice, frequency) {
        // Lush string ensemble with multiple layers
        const oscillators = [];
        const filter = this.audioContext.createBiquadFilter();
        const vibrato = this.audioContext.createOscillator();
        const vibratoGain = this.audioContext.createGain();
        
        // Create 5 string layers for rich ensemble
        for (let i = 0; i < 5; i++) {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sawtooth';
            const detune = (i - 2) * 15; // More detune for ensemble
            osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            osc.detune.setValueAtTime(detune, this.audioContext.currentTime);
            
            // Slow attack for strings
            const now = this.audioContext.currentTime;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2, now + 0.3);
            
            // Add vibrato
            vibratoGain.connect(osc.frequency);
            
            osc.connect(gain);
            gain.connect(filter);
            
            osc.start();
            oscillators.push(osc);
        }
        
        // Vibrato settings
        vibrato.frequency.setValueAtTime(4.5, this.audioContext.currentTime);
        vibratoGain.gain.setValueAtTime(3, this.audioContext.currentTime);
        vibrato.connect(vibratoGain);
        vibrato.start();
        oscillators.push(vibrato);
        
        // Warm string filter
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 3, this.audioContext.currentTime);
        filter.Q.setValueAtTime(0.7, this.audioContext.currentTime);
        filter.connect(voice.gain);
        
        voice.oscillators = oscillators;
    }
    
    createBellsVoice(voice, frequency) {
        // Complex FM synthesis for bright metallic bells
        const carrier = this.audioContext.createOscillator();
        const modulator1 = this.audioContext.createOscillator();
        const modulator2 = this.audioContext.createOscillator();
        const modulator3 = this.audioContext.createOscillator();
        const modulatorGain1 = this.audioContext.createGain();
        const modulatorGain2 = this.audioContext.createGain();
        const modulatorGain3 = this.audioContext.createGain();
        const highpass = this.audioContext.createBiquadFilter();
        
        carrier.type = 'sine';
        modulator1.type = 'sine';
        modulator2.type = 'sine';
        modulator3.type = 'sine';
        
        // Bell-like inharmonic frequency ratios
        carrier.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        modulator1.frequency.setValueAtTime(frequency * 5.4, this.audioContext.currentTime);
        modulator2.frequency.setValueAtTime(frequency * 1.4, this.audioContext.currentTime);
        modulator3.frequency.setValueAtTime(frequency * 8.1, this.audioContext.currentTime);
        
        // Strong initial modulation
        const now = this.audioContext.currentTime;
        modulatorGain1.gain.setValueAtTime(frequency * 3, now);
        modulatorGain2.gain.setValueAtTime(frequency * 1.5, now);
        modulatorGain3.gain.setValueAtTime(frequency * 0.8, now);
        
        // Quick decay for bell-like sound
        modulatorGain1.gain.exponentialRampToValueAtTime(0.01, now + 3);
        modulatorGain2.gain.exponentialRampToValueAtTime(0.01, now + 2);
        modulatorGain3.gain.exponentialRampToValueAtTime(0.01, now + 1);
        
        // High-pass filter for shimmer
        highpass.type = 'highpass';
        highpass.frequency.setValueAtTime(frequency * 2, this.audioContext.currentTime);
        highpass.Q.setValueAtTime(0.5, this.audioContext.currentTime);
        
        modulator1.connect(modulatorGain1);
        modulator2.connect(modulatorGain2);
        modulator3.connect(modulatorGain3);
        modulatorGain1.connect(carrier.frequency);
        modulatorGain2.connect(carrier.frequency);
        modulatorGain3.connect(carrier.frequency);
        carrier.connect(highpass);
        highpass.connect(voice.gain);
        
        // Amplitude envelope for bell
        voice.gain.gain.setValueAtTime(0.8, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.01, now + 4);
        
        carrier.start();
        modulator1.start();
        modulator2.start();
        modulator3.start();
        
        voice.oscillators.push(carrier, modulator1, modulator2, modulator3);
    }
    
    createBassVoice(voice, frequency) {
        // Deep bass with sub harmonics
        const osc = this.audioContext.createOscillator();
        const subOsc = this.audioContext.createOscillator();
        const filter = this.audioContext.createBiquadFilter();
        
        osc.type = 'square';
        subOsc.type = 'sine';
        
        // Bass frequencies
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        subOsc.frequency.setValueAtTime(frequency / 2, this.audioContext.currentTime);
        
        // Filter for punch
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 2, this.audioContext.currentTime);
        filter.Q.setValueAtTime(10, this.audioContext.currentTime);
        
        // Mix the oscillators
        const oscGain = this.audioContext.createGain();
        const subGain = this.audioContext.createGain();
        
        oscGain.gain.setValueAtTime(0.4, this.audioContext.currentTime);
        subGain.gain.setValueAtTime(0.6, this.audioContext.currentTime);
        
        osc.connect(oscGain);
        subOsc.connect(subGain);
        
        oscGain.connect(filter);
        subGain.connect(filter);
        filter.connect(voice.gain);
        
        osc.start();
        subOsc.start();
        
        voice.oscillators.push(osc, subOsc);
    }
    
    createLeadVoice(voice, frequency) {
        // Screaming lead synth with distortion
        const osc1 = this.audioContext.createOscillator();
        const osc2 = this.audioContext.createOscillator();
        const osc3 = this.audioContext.createOscillator();
        const filter = this.audioContext.createBiquadFilter();
        const distortion = this.audioContext.createWaveShaper();
        
        // Generate distortion curve
        const samples = 44100;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = i * 2 / samples - 1;
            curve[i] = Math.tanh(x * 5);
        }
        distortion.curve = curve;
        
        osc1.type = 'square';
        osc2.type = 'sawtooth';
        osc3.type = 'triangle';
        
        osc1.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        osc2.frequency.setValueAtTime(frequency * 1.01, this.audioContext.currentTime);
        osc3.frequency.setValueAtTime(frequency * 2.005, this.audioContext.currentTime);
        
        // Super resonant filter
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 10, this.audioContext.currentTime);
        filter.Q.setValueAtTime(20, this.audioContext.currentTime);
        
        // Filter sweep
        const now = this.audioContext.currentTime;
        filter.frequency.setValueAtTime(frequency * 15, now);
        filter.frequency.exponentialRampToValueAtTime(frequency * 4, now + 0.1);
        
        const gain1 = this.audioContext.createGain();
        const gain2 = this.audioContext.createGain();
        const gain3 = this.audioContext.createGain();
        
        gain1.gain.setValueAtTime(0.5, this.audioContext.currentTime);
        gain2.gain.setValueAtTime(0.4, this.audioContext.currentTime);
        gain3.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        
        osc1.connect(gain1);
        osc2.connect(gain2);
        osc3.connect(gain3);
        
        gain1.connect(distortion);
        gain2.connect(distortion);
        gain3.connect(distortion);
        
        distortion.connect(filter);
        filter.connect(voice.gain);
        
        osc1.start();
        osc2.start();
        osc3.start();
        
        voice.oscillators.push(osc1, osc2, osc3);
    }
    
    createPadVoice(voice, frequency) {
        // Ultra-lush evolving pad with PWM and chorusing
        const oscillators = [];
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        const filter2 = this.audioContext.createBiquadFilter();
        
        // Create 6 oscillators for super-wide sound
        for (let i = 0; i < 6; i++) {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const pan = this.audioContext.createStereoPanner();
            
            // Mix of waveforms
            osc.type = ['sine', 'triangle', 'sine', 'sawtooth', 'triangle', 'sine'][i];
            osc.frequency.setValueAtTime(frequency * (1 + i * 0.005), this.audioContext.currentTime);
            osc.detune.setValueAtTime((i - 2.5) * 12, this.audioContext.currentTime);
            
            // Stereo spread
            pan.pan.setValueAtTime((i - 2.5) * 0.3, this.audioContext.currentTime);
            
            gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
            
            // LFO modulation
            lfoGain.connect(osc.frequency);
            
            osc.connect(gain);
            gain.connect(pan);
            pan.connect(filter);
            
            osc.start();
            oscillators.push(osc);
        }
        
        // LFO for movement
        lfo.frequency.setValueAtTime(0.3, this.audioContext.currentTime);
        lfoGain.gain.setValueAtTime(5, this.audioContext.currentTime);
        lfo.connect(lfoGain);
        lfo.start();
        oscillators.push(lfo);
        
        // Dual filters for movement
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 2, this.audioContext.currentTime);
        filter.Q.setValueAtTime(3, this.audioContext.currentTime);
        
        filter2.type = 'highpass';
        filter2.frequency.setValueAtTime(frequency * 0.25, this.audioContext.currentTime);
        
        filter.connect(filter2);
        filter2.connect(voice.gain);
        
        // Very slow attack
        const now = this.audioContext.currentTime;
        voice.gain.gain.setValueAtTime(0, now);
        voice.gain.gain.linearRampToValueAtTime(0.25, now + 1.0);
        
        voice.oscillators = oscillators;
    }
    
    createPluckVoice(voice, frequency) {
        // Plucked string sound with quick decay
        const osc = this.audioContext.createOscillator();
        const filter = this.audioContext.createBiquadFilter();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(frequency * 0.5, this.audioContext.currentTime);
        filter.Q.setValueAtTime(1, this.audioContext.currentTime);
        
        // Quick decay envelope
        const now = this.audioContext.currentTime;
        filter.frequency.setValueAtTime(frequency * 4, now);
        filter.frequency.exponentialRampToValueAtTime(frequency * 0.5, now + 0.1);
        
        osc.connect(filter);
        filter.connect(voice.gain);
        
        osc.start();
        voice.oscillators.push(osc);
    }
    
    createOrganVoice(voice, frequency) {
        // Hammond organ-like sound with drawbars
        const drawbars = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8];
        const amplitudes = [0.8, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
        
        drawbars.forEach((mult, i) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency * mult, this.audioContext.currentTime);
            gain.gain.setValueAtTime(amplitudes[i] * 0.3, this.audioContext.currentTime);
            
            osc.connect(gain);
            gain.connect(voice.gain);
            
            osc.start();
            voice.oscillators.push(osc);
        });
    }
    
    createFluteVoice(voice, frequency) {
        // Flute-like sound with breathy tone
        const osc = this.audioContext.createOscillator();
        const noise = this.audioContext.createOscillator();
        const noiseGain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        // Add slight vibrato
        const vibrato = this.audioContext.createOscillator();
        const vibratoGain = this.audioContext.createGain();
        vibrato.frequency.setValueAtTime(5, this.audioContext.currentTime);
        vibratoGain.gain.setValueAtTime(5, this.audioContext.currentTime);
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);
        vibrato.start();
        
        // Breathy noise
        noise.type = 'square';
        noise.frequency.setValueAtTime(frequency * 8, this.audioContext.currentTime);
        noiseGain.gain.setValueAtTime(0.02, this.audioContext.currentTime);
        
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        filter.Q.setValueAtTime(5, this.audioContext.currentTime);
        
        osc.connect(filter);
        noise.connect(noiseGain);
        noiseGain.connect(filter);
        filter.connect(voice.gain);
        
        osc.start();
        noise.start();
        
        voice.oscillators.push(osc, noise, vibrato);
    }
    
    createBrassVoice(voice, frequency) {
        // Brass sound with bright harmonics
        const osc1 = this.audioContext.createOscillator();
        const osc2 = this.audioContext.createOscillator();
        const filter = this.audioContext.createBiquadFilter();
        
        osc1.type = 'sawtooth';
        osc2.type = 'square';
        
        osc1.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        osc2.frequency.setValueAtTime(frequency * 0.5, this.audioContext.currentTime);
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency * 3, this.audioContext.currentTime);
        filter.Q.setValueAtTime(5, this.audioContext.currentTime);
        
        // Brass "blat" attack
        const now = this.audioContext.currentTime;
        filter.frequency.setValueAtTime(frequency * 6, now);
        filter.frequency.exponentialRampToValueAtTime(frequency * 3, now + 0.05);
        
        const gain2 = this.audioContext.createGain();
        gain2.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        
        osc1.connect(filter);
        osc2.connect(gain2);
        gain2.connect(filter);
        filter.connect(voice.gain);
        
        osc1.start();
        osc2.start();
        
        voice.oscillators.push(osc1, osc2);
    }
    
    createChoirVoice(voice, frequency) {
        // Choir sound with formants
        const vowels = {
            'ah': [700, 1220, 2600],
            'oh': [450, 800, 2830],
            'oo': [325, 700, 2530]
        };
        
        const formants = vowels['ah'];
        const oscillators = [];
        
        // Create multiple voices with slight detuning
        for (let i = 0; i < 3; i++) {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency * (1 + i * 0.002), this.audioContext.currentTime);
            osc.detune.setValueAtTime((i - 1) * 10, this.audioContext.currentTime);
            
            // Create formant filters
            let node = osc;
            formants.forEach((freq, j) => {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = j === 0 ? 'lowpass' : 'bandpass';
                filter.frequency.setValueAtTime(freq, this.audioContext.currentTime);
                filter.Q.setValueAtTime(10, this.audioContext.currentTime);
                node.connect(filter);
                node = filter;
            });
            
            gain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            node.connect(gain);
            gain.connect(voice.gain);
            
            osc.start();
            oscillators.push(osc);
        }
        
        voice.oscillators = oscillators;
    }
    
    playNote(x, y, width, height, touchId, instrument) {
        // Stop any existing note with this touchId first
        if (this.voices.has(touchId)) {
            this.stopNote(touchId);
        }
        
        const { frequency, midiNote } = this.getFrequency(x, y, width, height);
        const voice = this.createVoice(frequency, touchId, instrument || this.currentInstrument);
        
        this.voices.set(touchId, voice);
        
        if (this.recording) {
            this.recordedNotes.push({
                time: this.audioContext.currentTime - this.recordStartTime,
                frequency: frequency,
                midiNote: midiNote,
                x: x / width,
                y: y / height,
                instrument: instrument || this.currentInstrument
            });
        }
        
        return { frequency, midiNote };
    }
    
    stopNote(touchId) {
        const voice = this.voices.get(touchId);
        if (voice && !voice.stopping) {
            voice.stopping = true; // Prevent double-stopping
            
            // Clear safety timeout
            if (voice.safetyTimeout) {
                clearTimeout(voice.safetyTimeout);
            }
            
            const now = this.audioContext.currentTime;
            
            try {
                voice.gain.gain.cancelScheduledValues(now);
                voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
                
                // Use the configurable sustain time
                voice.gain.gain.exponentialRampToValueAtTime(0.001, now + this.sustainTime);
            } catch (e) {
                // If scheduling fails, just set to 0
                voice.gain.gain.setValueAtTime(0, now);
            }
            
            setTimeout(() => {
                voice.oscillators.forEach(osc => {
                    try {
                        osc.stop();
                        osc.disconnect();
                    } catch (e) {
                        // Already stopped
                    }
                });
                try {
                    voice.gain.disconnect();
                } catch (e) {
                    // Already disconnected
                }
                this.voices.delete(touchId);
            }, this.sustainTime * 1000 + 100);
        }
    }
    
    // Emergency stop all notes
    stopAllNotes() {
        console.log('Stopping all notes, active voices:', this.voices.size);
        
        // First, mute everything immediately
        this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        // Stop all voices
        this.voices.forEach((voice, touchId) => {
            try {
                // Immediately silence the voice
                voice.gain.gain.cancelScheduledValues(this.audioContext.currentTime);
                voice.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                
                // Stop all oscillators
                voice.oscillators.forEach(osc => {
                    try {
                        osc.stop();
                        osc.disconnect();
                    } catch (e) {
                        // Already stopped
                    }
                });
                
                // Disconnect the gain
                voice.gain.disconnect();
            } catch (e) {
                console.error('Error stopping voice:', e);
            }
        });
        
        // Clear all voices
        this.voices.clear();
        
        // Restore master gain after a short delay
        setTimeout(() => {
            this.masterGain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
        }, 100);
    }
    
    updateEffects(reverb, delay, filter) {
        this.reverb.setMix(reverb);
        this.delay.setMix(delay);
        this.delay.setTime(delay);
        
        const maxFreq = 20000;
        const minFreq = 100;
        const freq = minFreq + (filter / 100) * (maxFreq - minFreq);
        this.filter.frequency.setTargetAtTime(freq, this.audioContext.currentTime, 0.01);
    }
    
    startRecording() {
        this.recording = true;
        this.recordedNotes = [];
        this.recordStartTime = this.audioContext.currentTime;
    }
    
    stopRecording() {
        this.recording = false;
        return this.recordedNotes;
    }
    
    playRecording(notes) {
        notes.forEach(note => {
            setTimeout(() => {
                const voice = this.createVoice(note.frequency, 'playback-' + Math.random(), note.instrument);
                this.voices.set(voice.touchId, voice);
                
                setTimeout(() => {
                    this.stopNote(voice.touchId);
                }, 200);
            }, note.time * 1000);
        });
    }
    
    // Sample loading and playback methods
    async loadSample(trackIndex, audioData, name) {
        try {
            const buffer = await this.audioContext.decodeAudioData(audioData);
            this.samples.set(trackIndex, { buffer, name, mode: 'sample' });
            console.log(`Sample loaded for track ${trackIndex + 1}: ${name}`);
            return true;
        } catch (e) {
            console.error('Failed to decode audio data:', e);
            return false;
        }
    }
    
    playSample(trackIndex, touchId, playbackRate = 1.0) {
        const sampleData = this.samples.get(trackIndex);
        if (!sampleData) {
            console.warn(`No sample loaded for track ${trackIndex + 1}`);
            return null;
        }
        
        // Stop any existing sample with this touchId
        this.stopSample(touchId);
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = sampleData.buffer;
        source.playbackRate.setValueAtTime(playbackRate, this.audioContext.currentTime);
        
        source.connect(gain);
        gain.connect(this.filter); // Connect to effects chain
        
        gain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
        
        source.start();
        
        this.sampleVoices.set(touchId, { source, gain });
        
        // Auto-cleanup when sample ends
        source.onended = () => {
            this.sampleVoices.delete(touchId);
        };
        
        return source;
    }
    
    stopSample(touchId) {
        const sampleVoice = this.sampleVoices.get(touchId);
        if (sampleVoice) {
            try {
                const now = this.audioContext.currentTime;
                sampleVoice.gain.gain.cancelScheduledValues(now);
                sampleVoice.gain.gain.setValueAtTime(sampleVoice.gain.gain.value, now);
                sampleVoice.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                
                setTimeout(() => {
                    try {
                        sampleVoice.source.stop();
                        sampleVoice.source.disconnect();
                        sampleVoice.gain.disconnect();
                    } catch (e) {
                        // Already stopped
                    }
                    this.sampleVoices.delete(touchId);
                }, 150);
            } catch (e) {
                console.error('Error stopping sample:', e);
            }
        }
    }
    
    setSampleMode(trackIndex, usesSample) {
        const sampleData = this.samples.get(trackIndex);
        if (sampleData) {
            sampleData.mode = usesSample ? 'sample' : 'synth';
        }
    }
    
    hasSample(trackIndex) {
        return this.samples.has(trackIndex);
    }
    
    isSampleMode(trackIndex) {
        const sampleData = this.samples.get(trackIndex);
        return sampleData && sampleData.mode === 'sample';
    }
    
    clearSample(trackIndex) {
        this.samples.delete(trackIndex);
        // Stop any playing samples from this track
        this.sampleVoices.forEach((voice, touchId) => {
            // We'd need to track which track each sample belongs to for this
            // For now, just clear the reference
        });
    }
    
    // Modified playNote to support samples
    playNoteOrSample(x, y, width, height, touchId, trackIndex, instrument) {
        // Check if this track should play a sample
        if (this.isSampleMode(trackIndex)) {
            // Calculate playback rate based on X position (pitch variation)
            const normalizedX = x / width;
            const playbackRate = 0.5 + normalizedX * 1.5; // 0.5x to 2x speed
            
            const source = this.playSample(trackIndex, touchId, playbackRate);
            if (source) {
                return { frequency: 440 * playbackRate, midiNote: 69 }; // Approximate values
            }
        }
        
        // Otherwise play synthesized note
        return this.playNote(x, y, width, height, touchId, instrument);
    }
}