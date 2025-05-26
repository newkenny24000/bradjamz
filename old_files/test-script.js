// Test script to isolate the issue
debugLog.log('Test 1: Script loaded');

try {
    debugLog.log('Test 2: Inside try block');
    
    // Test if Tone.js is loaded
    debugLog.log('Test 3: typeof Tone = ' + typeof Tone);
    
    // Test if ToneAudioEngine is available
    debugLog.log('Test 4: typeof ToneAudioEngine = ' + typeof ToneAudioEngine);
    
    // Test if AudioEngine is available  
    debugLog.log('Test 5: typeof AudioEngine = ' + typeof AudioEngine);
    
    // Try creating a simple Tone.js object
    if (typeof Tone !== 'undefined') {
        debugLog.log('Test 6: Creating Tone.Synth...');
        const testSynth = new Tone.Synth();
        debugLog.log('Test 7: Tone.Synth created successfully');
    }
    
} catch (error) {
    debugLog.log('ERROR in test: ' + error.message);
    debugLog.log('Stack: ' + error.stack);
}

debugLog.log('Test 8: Script completed');