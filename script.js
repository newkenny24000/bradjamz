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
    stepNotes: {}, // Step pitches: { trackIndex: { stepIndex: semitones } }
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

// Project Save/Load functionality
let currentProjectName = null;

function saveProject(projectName = null) {
    try {
        // If no name provided, prompt for one
        if (!projectName) {
            projectName = prompt('Enter project name:', currentProjectName || `Project ${new Date().toLocaleString()}`);
            if (!projectName) return; // User cancelled
        }
        
        const projectState = {
            version: "1.0",
            name: projectName,
            timestamp: new Date().toISOString(),
            
            // Beat sequencer state
            beatSequencer: {
                patternLength: beatSequencer.patternLength,
                sequence: beatSequencer.sequence,
                stepNotes: beatSequencer.stepNotes,
                muted: beatSequencer.muted,
                solo: beatSequencer.solo,
                volumes: beatSequencer.volumes,
                swing: beatSequencer.swing
            },
            
            // Project settings
            projectSettings: {
                bpm: document.getElementById('bpm')?.value || '120',
                scale: document.getElementById('scale')?.value || 'major',
                key: document.getElementById('key')?.value || 'C',
                octave: document.getElementById('octave')?.value || '3'
            },
            
            // Track effects for all 8 tracks
            trackEffects: {},
            
            // Track sound assignments
            trackSounds: {},
            
            // Sound library (only user-generated sounds)
            soundLibrary: soundLibrary
        };
        
        // Capture track effects and sound assignments
        for (let i = 0; i < 8; i++) {
            projectState.trackEffects[i] = {
                reverb: document.querySelector(`.track-reverb[data-track="${i}"]`)?.value || '0',
                delay: document.querySelector(`.track-delay[data-track="${i}"]`)?.value || '0',
                volume: document.querySelector(`.track-volume[data-track="${i}"]`)?.value || '70',
                decay: document.querySelector(`.track-decay[data-track="${i}"]`)?.value || '0'
            };
            
            const soundSelector = document.querySelector(`.sound-selector[data-track="${i}"]`);
            projectState.trackSounds[i] = soundSelector?.value || '';
        }
        
        // Save to localStorage
        const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
        savedProjects[projectName] = projectState;
        localStorage.setItem('bradjamzProjects', JSON.stringify(savedProjects));
        
        currentProjectName = projectName;
        updateProjectNameDisplay();
        
        log('Project saved to localStorage:', projectName);
        showCustomMessage(`Project "${projectName}" saved successfully!`, 'success');
    } catch (error) {
        log('ERROR saving project:', error);
        showCustomMessage('Error saving project: ' + error.message, 'error');
    }
}

function saveProjectAs() {
    const newName = prompt('Save project as:', currentProjectName ? `${currentProjectName} (Copy)` : `Project ${new Date().toLocaleString()}`);
    if (newName) {
        saveProject(newName);
    }
}

function exportProject() {
    if (!currentProjectName) {
        showCustomMessage('No project to export. Save a project first.', 'error');
        return;
    }
    
    try {
        const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
        const projectData = savedProjects[currentProjectName];
        
        if (!projectData) {
            showCustomMessage('Project not found in localStorage', 'error');
            return;
        }
        
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        log('Project exported:', currentProjectName);
        showCustomMessage(`Project "${currentProjectName}" exported successfully!`, 'success');
    } catch (error) {
        log('ERROR exporting project:', error);
        showCustomMessage('Error exporting project: ' + error.message, 'error');
    }
}

function loadProject(projectNameOrFile) {
    try {
        if (typeof projectNameOrFile === 'string') {
            // Loading from localStorage
            const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
            const projectState = savedProjects[projectNameOrFile];
            
            if (!projectState) {
                showCustomMessage('Project not found', 'error');
                return;
            }
            
            loadProjectState(projectState);
            currentProjectName = projectNameOrFile;
            updateProjectNameDisplay();
            
        } else {
            // Loading from file
            const file = projectNameOrFile;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const projectState = JSON.parse(e.target.result);
                    loadProjectState(projectState);
                    currentProjectName = projectState.name || 'Imported Project';
                    updateProjectNameDisplay();
                    
                } catch (parseError) {
                    log('ERROR parsing project file:', parseError);
                    showCustomMessage('Error loading project: Invalid file format', 'error');
                }
            };
            
            reader.onerror = function() {
                log('ERROR reading project file');
                showCustomMessage('Error reading project file', 'error');
            };
            
            reader.readAsText(file);
        }
    } catch (error) {
        log('ERROR loading project:', error);
        showCustomMessage('Error loading project: ' + error.message, 'error');
    }
}

function loadProjectState(projectState) {
    log('Loading project version:', projectState.version);
    
    // Restore beat sequencer state
    if (projectState.beatSequencer) {
        beatSequencer.patternLength = projectState.beatSequencer.patternLength || 16;
        beatSequencer.sequence = projectState.beatSequencer.sequence || {};
        beatSequencer.stepNotes = projectState.beatSequencer.stepNotes || {};
        beatSequencer.muted = projectState.beatSequencer.muted || {};
        beatSequencer.solo = projectState.beatSequencer.solo || {};
        beatSequencer.volumes = projectState.beatSequencer.volumes || {};
        beatSequencer.swing = projectState.beatSequencer.swing || 0;
        
        // Update pattern length UI
        const patternLengthSelect = document.getElementById('pattern-length');
        if (patternLengthSelect) {
            patternLengthSelect.value = beatSequencer.patternLength;
        }
        
        // Update swing UI
        const swingControl = document.getElementById('swing-control');
        const swingValue = document.getElementById('swing-value');
        if (swingControl && swingValue) {
            swingControl.value = beatSequencer.swing;
            swingValue.textContent = beatSequencer.swing + '%';
        }
        
        // Rebuild sequencer UI
        rebuildSequencerGrid();
        updateSequencerFromState();
    }
    
    // Restore project settings
    if (projectState.projectSettings) {
        const settings = projectState.projectSettings;
        
        const bpmSlider = document.getElementById('bpm');
        const bpmValue = document.getElementById('bpmValue');
        if (bpmSlider && bpmValue) {
            bpmSlider.value = settings.bpm;
            bpmValue.textContent = settings.bpm;
            if (audioEngine) audioEngine.setBPM(parseInt(settings.bpm));
        }
        
        const scaleSelect = document.getElementById('scale');
        if (scaleSelect) {
            scaleSelect.value = settings.scale;
            if (audioEngine) audioEngine.setScale(settings.scale);
        }
        
        const keySelect = document.getElementById('key');
        if (keySelect) {
            keySelect.value = settings.key;
            if (audioEngine) audioEngine.setKey(settings.key);
        }
        
        const octaveSlider = document.getElementById('octave');
        const octaveValue = document.getElementById('octaveValue');
        if (octaveSlider && octaveValue) {
            octaveSlider.value = settings.octave;
            octaveValue.textContent = settings.octave;
            if (audioEngine) audioEngine.setOctave(parseInt(settings.octave));
        }
    }
    
    // Restore track effects
    if (projectState.trackEffects) {
        for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
            const effects = projectState.trackEffects[trackIndex];
            if (effects) {
                ['reverb', 'delay', 'volume', 'decay'].forEach(effect => {
                    const slider = document.querySelector(`.track-${effect}[data-track="${trackIndex}"]`);
                    const valueSpan = slider?.parentElement.querySelector('.effect-value');
                    if (slider && effects[effect] !== undefined) {
                        slider.value = effects[effect];
                        if (valueSpan) valueSpan.textContent = effects[effect];
                        if (audioEngine) {
                            audioEngine.updateTrackEffect(trackIndex, effect, parseInt(effects[effect]));
                        }
                    }
                });
            }
        }
    }
    
    // Restore sound library
    if (projectState.soundLibrary) {
        soundLibrary = projectState.soundLibrary;
        saveSoundLibrary();
        loadSoundLibrary();
    }
    
    // Restore track sound assignments
    if (projectState.trackSounds) {
        for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
            const soundId = projectState.trackSounds[trackIndex];
            const soundSelector = document.querySelector(`.sound-selector[data-track="${trackIndex}"]`);
            if (soundSelector && soundId) {
                soundSelector.value = soundId;
                // Trigger change event to load the sound
                soundSelector.dispatchEvent(new Event('change'));
            }
        }
    }
    
    log('Project loaded successfully');
    showCustomMessage(`Project "${projectState.name || 'Unknown'}" loaded successfully!`, 'success');
}

function deleteProject(projectName) {
    if (confirm(`Delete project "${projectName}"? This cannot be undone.`)) {
        try {
            const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
            delete savedProjects[projectName];
            localStorage.setItem('bradjamzProjects', JSON.stringify(savedProjects));
            
            if (currentProjectName === projectName) {
                currentProjectName = null;
                updateProjectNameDisplay();
            }
            
            log('Project deleted:', projectName);
            showCustomMessage(`Project "${projectName}" deleted`, 'success');
            
            // Refresh project list if modal is open
            if (document.getElementById('project-manager-modal').style.display !== 'none') {
                displayProjectList();
            }
        } catch (error) {
            log('ERROR deleting project:', error);
            showCustomMessage('Error deleting project: ' + error.message, 'error');
        }
    }
}

function renameProject(oldName) {
    const newName = prompt('Enter new name:', oldName);
    if (newName && newName !== oldName) {
        try {
            const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
            
            if (savedProjects[newName]) {
                showCustomMessage('Project with that name already exists', 'error');
                return;
            }
            
            // Copy project with new name
            savedProjects[newName] = { ...savedProjects[oldName], name: newName };
            delete savedProjects[oldName];
            localStorage.setItem('bradjamzProjects', JSON.stringify(savedProjects));
            
            if (currentProjectName === oldName) {
                currentProjectName = newName;
                updateProjectNameDisplay();
            }
            
            log('Project renamed:', oldName, '->', newName);
            showCustomMessage(`Project renamed to "${newName}"`, 'success');
            
            // Refresh project list if modal is open
            if (document.getElementById('project-manager-modal').style.display !== 'none') {
                displayProjectList();
            }
        } catch (error) {
            log('ERROR renaming project:', error);
            showCustomMessage('Error renaming project: ' + error.message, 'error');
        }
    }
}

function newProject() {
    if (!currentProjectName || confirm('Start new project? Unsaved changes will be lost.')) {
        // Reset everything to defaults
        currentProjectName = null;
        updateProjectNameDisplay();
        
        // Reset sequencer
        for (let i = 0; i < 8; i++) {
            beatSequencer.sequence[i] = new Array(16).fill(false);
            beatSequencer.stepNotes[i] = {};
            beatSequencer.muted[i] = false;
            beatSequencer.solo[i] = false;
            beatSequencer.volumes[i] = 70;
        }
        beatSequencer.patternLength = 16;
        beatSequencer.swing = 0;
        
        // Reset UI
        rebuildSequencerGrid();
        updateSequencerFromState();
        
        // Reset project settings
        document.getElementById('bpm').value = 120;
        document.getElementById('bpmValue').textContent = 120;
        document.getElementById('scale').value = 'major';
        document.getElementById('key').value = 'C';
        document.getElementById('octave').value = 3;
        document.getElementById('octaveValue').textContent = 3;
        
        // Reset track effects
        for (let i = 0; i < 8; i++) {
            const effects = ['reverb', 'delay', 'volume', 'decay'];
            const defaults = { reverb: 0, delay: 0, volume: 70, decay: 0 };
            
            effects.forEach(effect => {
                const slider = document.querySelector(`.track-${effect}[data-track="${i}"]`);
                const valueSpan = slider?.parentElement.querySelector('.effect-value');
                if (slider) {
                    slider.value = defaults[effect];
                    if (valueSpan) valueSpan.textContent = defaults[effect];
                }
            });
        }
        
        showCustomMessage('New project created', 'success');
        log('New project created');
    }
}

function updateProjectNameDisplay() {
    const titleElement = document.querySelector('.sequencer-title h3');
    if (titleElement) {
        titleElement.textContent = currentProjectName ? `Beat Sequencer - ${currentProjectName}` : 'Beat Sequencer';
    }
}

// Project Manager Functions
function openProjectManager() {
    const modal = document.getElementById('project-manager-modal');
    modal.style.display = 'flex';
    displayProjectList();
    updateStorageInfo();
    log('Project manager opened');
}

function closeProjectManager() {
    const modal = document.getElementById('project-manager-modal');
    modal.style.display = 'none';
    log('Project manager closed');
}

function displayProjectList() {
    const projectsList = document.getElementById('projects-list');
    const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
    
    if (Object.keys(savedProjects).length === 0) {
        projectsList.innerHTML = '<div class="no-projects">No saved projects found. Create your first project!</div>';
        return;
    }
    
    // Sort projects by last modified (newest first)
    const sortedProjects = Object.entries(savedProjects).sort((a, b) => {
        const dateA = new Date(a[1].timestamp);
        const dateB = new Date(b[1].timestamp);
        return dateB - dateA;
    });
    
    projectsList.innerHTML = '';
    
    sortedProjects.forEach(([projectName, projectData]) => {
        const projectItem = document.createElement('div');
        projectItem.className = 'project-item';
        if (currentProjectName === projectName) {
            projectItem.classList.add('current-project');
        }
        
        const lastModified = new Date(projectData.timestamp).toLocaleString();
        
        projectItem.innerHTML = `
            <div class="project-info">
                <div class="project-name">${projectName}</div>
                <div class="project-meta">
                    <span class="project-date">${lastModified}</span>
                    <span class="project-version">v${projectData.version}</span>
                </div>
            </div>
            <div class="project-actions">
                <button class="project-btn load-btn" onclick="loadProjectFromManager('${projectName}')">Load</button>
                <button class="project-btn rename-btn" onclick="renameProject('${projectName}')">Rename</button>
                <button class="project-btn export-btn" onclick="exportProjectFromManager('${projectName}')">Export</button>
                <button class="project-btn delete-btn" onclick="deleteProject('${projectName}')">Delete</button>
            </div>
        `;
        
        projectsList.appendChild(projectItem);
    });
    
    log(`Displayed ${sortedProjects.length} projects`);
}

function loadProjectFromManager(projectName) {
    try {
        loadProject(projectName);
        closeProjectManager();
    } catch (error) {
        log('ERROR loading project from manager:', error);
        showCustomMessage('Error loading project: ' + error.message, 'error');
    }
}

function exportProjectFromManager(projectName) {
    try {
        const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
        const projectData = savedProjects[projectName];
        
        if (!projectData) {
            showCustomMessage('Project not found', 'error');
            return;
        }
        
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        log('Project exported from manager:', projectName);
        showCustomMessage(`Project "${projectName}" exported successfully!`, 'success');
    } catch (error) {
        log('ERROR exporting project from manager:', error);
        showCustomMessage('Error exporting project: ' + error.message, 'error');
    }
}

function updateStorageInfo() {
    const storageInfo = document.getElementById('storage-info');
    
    try {
        const savedProjects = JSON.parse(localStorage.getItem('bradjamzProjects')) || {};
        const projectCount = Object.keys(savedProjects).length;
        
        // Estimate storage usage
        const projectsData = JSON.stringify(savedProjects);
        const soundLibraryData = JSON.stringify(soundLibrary);
        const totalSize = new Blob([projectsData + soundLibraryData]).size;
        const sizeInKB = Math.round(totalSize / 1024);
        
        storageInfo.innerHTML = `
            <span>${projectCount} project${projectCount !== 1 ? 's' : ''} saved</span>
            <span>•</span>
            <span>~${sizeInKB} KB used</span>
        `;
    } catch (error) {
        storageInfo.innerHTML = '<span>Storage info unavailable</span>';
        log('ERROR updating storage info:', error);
    }
}

// Helper functions for project loading
function rebuildSequencerGrid() {
    log('Rebuilding sequencer grid with pattern length:', beatSequencer.patternLength);
    
    // Update pattern length dropdown
    const patternLengthSelect = document.getElementById('pattern-length');
    if (patternLengthSelect) {
        patternLengthSelect.value = beatSequencer.patternLength;
    }
    
    // Clear existing steps
    document.querySelectorAll('.seq-steps').forEach(stepsContainer => {
        stepsContainer.innerHTML = '';
    });
    
    // Rebuild step numbers
    const stepNumbers = document.querySelector('.step-numbers');
    if (stepNumbers) {
        stepNumbers.innerHTML = '';
        for (let i = 0; i < beatSequencer.patternLength; i++) {
            const stepNum = document.createElement('div');
            stepNum.className = 'step-number';
            stepNum.textContent = i + 1;
            stepNumbers.appendChild(stepNum);
        }
    }
    
    // Rebuild steps for each track
    document.querySelectorAll('.seq-track').forEach((track, trackIndex) => {
        const stepsContainer = track.querySelector('.seq-steps');
        if (stepsContainer) {
            for (let stepIndex = 0; stepIndex < beatSequencer.patternLength; stepIndex++) {
                const stepBtn = document.createElement('button');
                stepBtn.className = 'seq-step';
                stepBtn.dataset.track = trackIndex;
                stepBtn.dataset.step = stepIndex;
                
                // Add event listeners for step interaction
                stepBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    toggleStep(trackIndex, stepIndex);
                });
                
                stepBtn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    adjustStepPitch(trackIndex, stepIndex);
                });
                
                stepsContainer.appendChild(stepBtn);
            }
        }
    });
    
    log('Sequencer grid rebuilt successfully');
}

function updateSequencerFromState() {
    log('Updating sequencer UI from state...');
    
    // Update step buttons based on sequence state
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
        const sequence = beatSequencer.sequence[trackIndex] || [];
        const stepNotes = beatSequencer.stepNotes[trackIndex] || {};
        
        // Ensure sequence array has correct length
        while (sequence.length < beatSequencer.patternLength) {
            sequence.push(false);
        }
        
        for (let stepIndex = 0; stepIndex < beatSequencer.patternLength; stepIndex++) {
            const stepBtn = document.querySelector(`[data-track="${trackIndex}"][data-step="${stepIndex}"]`);
            if (stepBtn) {
                const isActive = sequence[stepIndex];
                stepBtn.classList.toggle('active', isActive);
                
                // Update pitch indication if step has custom pitch
                if (stepNotes[stepIndex] !== undefined) {
                    const semitones = stepNotes[stepIndex];
                    stepBtn.style.backgroundColor = getPitchColor(semitones);
                    stepBtn.title = `Step ${stepIndex + 1} (${semitones > 0 ? '+' : ''}${semitones} semitones)`;
                } else {
                    stepBtn.style.backgroundColor = '';
                    stepBtn.title = `Step ${stepIndex + 1}`;
                }
            }
        }
        
        // Update track controls
        const muteBtn = document.querySelector(`.seq-track-mute[data-track="${trackIndex}"]`);
        const soloBtn = document.querySelector(`.seq-track-solo[data-track="${trackIndex}"]`);
        const volumeSlider = document.querySelector(`.seq-track-volume[data-track="${trackIndex}"]`);
        
        if (muteBtn) {
            muteBtn.classList.toggle('active', beatSequencer.muted[trackIndex]);
        }
        
        if (soloBtn) {
            soloBtn.classList.toggle('active', beatSequencer.solo[trackIndex]);
        }
        
        if (volumeSlider && beatSequencer.volumes[trackIndex] !== undefined) {
            volumeSlider.value = beatSequencer.volumes[trackIndex];
        }
    }
    
    log('Sequencer UI updated from state');
}

function getPitchColor(semitones) {
    // Generate a color based on pitch offset
    const hue = (semitones * 15 + 180) % 360; // Spread colors around the hue wheel
    return `hsl(${hue}, 70%, 50%)`;
}

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
    
    // Toggle controls
    const trackControls = document.querySelector('.track-controls');
    const toggleBtn = document.querySelector('.track-controls-toggle');
    const toggleIcon = document.querySelector('.toggle-icon');
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            trackControls.classList.toggle('collapsed');
            const isCollapsed = trackControls.classList.contains('collapsed');
            
            // Update icon
            if (toggleIcon) {
                toggleIcon.textContent = isCollapsed ? '+' : '−';
            }
            
            log(isCollapsed ? 'Collapsed track controls' : 'Expanded track controls');
        });
    }
}

// Effect Sliders Setup
function setupEffectSliders() {
    const effects = ['reverb', 'delay', 'volume', 'decay'];
    
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
    
    // New Project button
    const newProjectBtn = document.getElementById('new-project-btn');
    if (newProjectBtn) {
        newProjectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('New project button clicked');
            newProject();
        });
    }
    
    // Save Project button
    const saveProjectBtn = document.getElementById('save-project-btn');
    if (saveProjectBtn) {
        log('Setting up save project button');
        saveProjectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Save project button clicked');
            try {
                saveProject();
            } catch (error) {
                log('ERROR saving project:', error);
            }
        });
    } else {
        log('ERROR: save-project-btn element not found');
    }
    
    // Save As button
    const saveAsBtn = document.getElementById('save-as-btn');
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Save as button clicked');
            saveProjectAs();
        });
    }
    
    // Projects button (opens project manager)
    const projectsBtn = document.getElementById('projects-btn');
    if (projectsBtn) {
        projectsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Projects button clicked');
            openProjectManager();
        });
    }
    
    // Import Project button
    const importBtn = document.getElementById('import-btn');
    const importProjectInput = document.getElementById('import-project-input');
    if (importBtn && importProjectInput) {
        log('Setting up import project button');
        importBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Import project button clicked');
            importProjectInput.click();
        });
        
        importProjectInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                log('Project file selected for import:', file.name);
                try {
                    loadProject(file);
                } catch (error) {
                    log('ERROR importing project:', error);
                }
                // Reset the input so the same file can be loaded again
                e.target.value = '';
            }
        });
    } else {
        log('ERROR: import-btn or import-project-input element not found');
    }
    
    // Export Project button
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Export project button clicked');
            exportProject();
        });
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
    
    // Setup prompt builder buttons
    setupPromptBuilders();
    
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
    
    // Project manager modal
    document.getElementById('close-project-manager').addEventListener('click', () => {
        closeProjectManager();
    });
    
    document.getElementById('new-project-from-manager').addEventListener('click', () => {
        newProject();
        closeProjectManager();
    });
    
    document.getElementById('refresh-projects').addEventListener('click', () => {
        displayProjectList();
        updateStorageInfo();
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
    
    document.getElementById('toggle-debug').addEventListener('click', () => {
        const debugPanel = document.querySelector('.debug-panel');
        const toggleBtn = document.getElementById('toggle-debug');
        
        if (debugPanel.classList.contains('collapsed')) {
            debugPanel.classList.remove('collapsed');
            toggleBtn.textContent = 'Hide';
            log('Debug panel expanded');
        } else {
            debugPanel.classList.add('collapsed');
            toggleBtn.textContent = 'Show';
            log('Debug panel collapsed');
        }
    });
    
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
    
    // Update project value displays in prompt builder
    updateProjectValueDisplays();
    
    log(`Opened sound generation modal for track ${trackIndex + 1}`);
}

function closeSoundGenerationModal() {
    document.querySelector('.sound-gen-modal').style.display = 'none';
    document.getElementById('sound-prompt').value = '';
    log('Closed sound generation modal');
}

// Store generated sounds temporarily
let generatedSounds = [];

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
    
    log(`Generating 3 sound variations: "${prompt}" for track ${selectedTrack + 1}`);
    
    // Show loading indicator
    document.querySelector('.loading-indicator').style.display = 'block';
    document.getElementById('generate-sound').disabled = true;
    
    // Hide any previous results
    document.querySelector('.generated-sounds-section').style.display = 'none';
    
    try {
        const promises = [];
        
        // Generate 3 variations concurrently
        for (let i = 0; i < 3; i++) {
            promises.push(generateSingleSound(prompt, i + 1));
        }
        
        // Wait for all generations to complete
        const results = await Promise.all(promises);
        
        // Debug logging
        log(`Promise.all returned ${results.length} results`);
        results.forEach((result, index) => {
            if (result) {
                log(`Result ${index}: variation ${result.variationNumber}, name: "${result.name}"`);
            } else {
                log(`Result ${index}: null (failed)`);
            }
        });
        
        // Store results and display them
        generatedSounds = results.filter(result => result !== null); // Filter out any failed generations
        
        if (generatedSounds.length === 0) {
            throw new Error('All sound generations failed');
        }
        
        log(`Successfully generated ${generatedSounds.length} sound variations`);
        log('generatedSounds array:', generatedSounds.map(s => `Variation ${s.variationNumber}`));
        displayGeneratedSounds();
        
    } catch (error) {
        log('ERROR: Failed to generate sounds:', error);
        alert(`Failed to generate sounds: ${error.message}`);
    } finally {
        document.querySelector('.loading-indicator').style.display = 'none';
        document.getElementById('generate-sound').disabled = false;
    }
}

async function generateSingleSound(prompt, variationNumber) {
    try {
        log(`Generating variation ${variationNumber}...`);
        
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
                prompt_influence: 0.3 + (variationNumber - 1) * 0.1 // Slight variation in influence
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        // Get audio data
        const audioBlob = await response.blob();
        
        // Convert blob to base64 for storage
        const base64Data = await blobToBase64(audioBlob);
        
        // Create blob URL for immediate playback
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Determine category automatically - first try prompt builder, then analyze prompt text
        let autoCategory = 'favorites';
        if (promptBuilder.selectedSoundType) {
            autoCategory = getCategoryForSoundType(promptBuilder.selectedSoundType);
            log(`Category from prompt builder: ${autoCategory} (sound type: ${promptBuilder.selectedSoundType})`);
        } else {
            // Fallback to text analysis if no prompt builder selection
            autoCategory = detectCategoryFromPrompt(prompt) || 'favorites';
            log(`Category from text analysis: ${autoCategory}`);
        }
        
        return {
            id: Date.now().toString() + '_' + variationNumber,
            name: prompt,
            url: base64Data,
            playbackUrl: audioUrl, // For immediate playback
            category: autoCategory,
            variationNumber: variationNumber,
            created: new Date().toISOString()
        };
        
    } catch (error) {
        log(`ERROR: Failed to generate variation ${variationNumber}:`, error);
        return null;
    }
}

function displayGeneratedSounds() {
    const grid = document.getElementById('generated-sounds-grid');
    if (!grid) {
        log('ERROR: generated-sounds-grid element not found');
        return;
    }
    
    grid.innerHTML = '';
    
    log(`displayGeneratedSounds called with ${generatedSounds.length} sounds`);
    
    generatedSounds.forEach((sound, index) => {
        log(`Creating display for sound ${index}: Variation ${sound.variationNumber}`);
        const soundItem = document.createElement('div');
        soundItem.className = 'generated-sound-item';
        soundItem.innerHTML = `
            <div class="sound-preview">
                <div class="sound-info">
                    <h5>Variation ${sound.variationNumber}</h5>
                    <p class="sound-prompt">${sound.name}</p>
                </div>
                <div class="sound-controls">
                    <button class="preview-play-btn" data-index="${index}" title="Play preview">▶</button>
                    <button class="add-to-library-btn" data-index="${index}" title="Add to library">
                        <span class="plus-icon">+</span>
                    </button>
                </div>
            </div>
        `;
        
        grid.appendChild(soundItem);
        log(`Added sound item ${index} to grid`);
    });
    
    // Show the results section
    const resultsSection = document.querySelector('.generated-sounds-section');
    if (resultsSection) {
        resultsSection.style.display = 'block';
        log('Showed generated-sounds-section');
    } else {
        log('ERROR: generated-sounds-section not found');
    }
    
    // Setup event listeners
    setupGeneratedSoundsListeners();
    
    log(`Displayed ${generatedSounds.length} generated sound variations`);
}

function setupGeneratedSoundsListeners() {
    // Preview play buttons
    document.querySelectorAll('.preview-play-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target.closest('.preview-play-btn'); // Get the actual button even if child element clicked
            const index = parseInt(target.dataset.index);
            if (!isNaN(index)) {
                playGeneratedSound(index);
            } else {
                log('ERROR: Invalid index for play button:', target.dataset.index);
            }
        });
    });
    
    // Add to library buttons
    document.querySelectorAll('.add-to-library-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target.closest('.add-to-library-btn'); // Get the actual button even if child element clicked
            const index = parseInt(target.dataset.index);
            if (!isNaN(index)) {
                addSoundToLibrary(index);
            } else {
                log('ERROR: Invalid index for add button:', target.dataset.index);
            }
        });
    });
    
    // Results action buttons
    document.getElementById('add-all-sounds').onclick = addAllSoundsToLibrary;
    document.getElementById('generate-more').onclick = generateSound;
    document.getElementById('close-results').onclick = closeGenerationResults;
}

function playGeneratedSound(index) {
    const sound = generatedSounds[index];
    if (!sound || !sound.playbackUrl) return;
    
    try {
        const audio = new Audio(sound.playbackUrl);
        audio.play();
        log(`Playing generated sound variation ${sound.variationNumber}`);
        
        // Visual feedback
        const btn = document.querySelector(`[data-index="${index}"].preview-play-btn`);
        if (btn) {
            btn.textContent = '🔊';
            setTimeout(() => {
                btn.textContent = '▶';
            }, 2000);
        }
        
    } catch (error) {
        log(`ERROR: Failed to play generated sound:`, error);
    }
}

function addSoundToLibrary(index) {
    const sound = generatedSounds[index];
    if (!sound) {
        log('ERROR: No sound found at index', index);
        return;
    }
    
    // Determine the correct category based on the prompt content
    const detectedCategory = detectCategoryFromPrompt(sound.name);
    const finalCategory = detectedCategory || sound.category || 'favorites';
    
    log(`Adding sound to library: "${sound.name}" -> Category: ${finalCategory}`);
    
    // Ensure the category array exists
    if (!soundLibrary[finalCategory]) {
        soundLibrary[finalCategory] = [];
        log(`Created new category: ${finalCategory}`);
    }
    
    // Create the sound data object
    const soundData = {
        id: sound.id,
        name: sound.name,
        url: sound.url,
        category: finalCategory,
        created: sound.created
    };
    
    // Add to sound library
    soundLibrary[finalCategory].push(soundData);
    
    // Save to localStorage
    saveSoundLibrary();
    
    // Visual feedback
    const btn = document.querySelector(`[data-index="${index}"].add-to-library-btn`);
    if (btn) {
        btn.innerHTML = '<span class="check-icon">✓</span>';
        btn.disabled = true;
        btn.style.background = '#4a9eff';
        btn.style.color = '#fff';
    }
    
    log(`Successfully added variation ${sound.variationNumber} to ${finalCategory} category: ${sound.name}`);
    showMessage(`Added "${sound.name}" to ${finalCategory}`, 'success');
    
    // Debug: Log current sound library state
    log(`Sound library now has ${Object.keys(soundLibrary).length} categories`);
    Object.keys(soundLibrary).forEach(cat => {
        if (Array.isArray(soundLibrary[cat])) {
            log(`  ${cat}: ${soundLibrary[cat].length} sounds`);
        }
    });
    
    // Update sound selectors with new sound
    populateAllSoundSelectors();
}

// Enhanced category detection focusing on main sound types (not adjectives)
function detectCategoryFromPrompt(promptText) {
    const prompt = promptText.toLowerCase();
    
    // Primary sound type keywords - these get highest priority
    const primarySoundTypes = {
        // Drum specifics
        'kick': ['kick drum', 'kick', 'bass drum', '808'],
        'snare': ['snare drum', 'snare', 'rim shot'],
        'hihat': ['hi-hat', 'hihat', 'hi hat', 'closed hat', 'open hat'],
        'percussion': ['cymbal', 'tom', 'clap', 'shaker', 'cowbell', 'conga', 'bongo', 'djembe', 'tabla'],
        
        // Bass types
        'bass': ['bass', 'sub bass', 'bass drop', 'bassline', 'low end'],
        
        // Synth specifics
        'lead': ['lead', 'synth lead', 'solo', 'melody'],
        'arp': ['arp', 'arpeggio', 'sequence', 'pattern'],
        'pluck': ['pluck', 'pizzicato', 'picked'],
        'stab': ['stab', 'hit', 'chord stab'],
        
        // Atmospheric
        'pad': ['pad', 'wash', 'background', 'sustained'],
        'drone': ['drone', 'sustained tone', 'continuous'],
        'strings': ['string', 'violin', 'viola', 'cello', 'orchestral'],
        'bells': ['bell', 'chime', 'glockenspiel', 'carillon'],
        
        // Human
        'vocal': ['vocal', 'voice', 'choir', 'chant', 'sing', 'breath', 'ahh', 'ohh'],
        
        // Effects
        'fx': ['sweep', 'zap', 'whoosh', 'impact', 'riser', 'drop', 'reverse', 'scratch', 'noise', 'laser', 'explosion'],
        
        // World
        'world': ['sitar', 'didgeridoo', 'flute', 'ethnic', 'tribal', 'traditional'],
        
        // Organic
        'organic': ['rain', 'wind', 'fire', 'water', 'footstep', 'bird', 'nature', 'ocean', 'wave', 'forest']
    };
    
    // First pass: Look for exact primary sound type matches (highest priority)
    for (const [category, keywords] of Object.entries(primarySoundTypes)) {
        for (const keyword of keywords) {
            if (prompt.includes(keyword)) {
                log(`Category detection for "${promptText}": ${category} (exact match: "${keyword}")`);
                return category;
            }
        }
    }
    
    // Second pass: Look for generic terms if no specific match found
    const genericTerms = {
        'percussion': ['drum', 'beat', 'percussion', 'rhythm'],
        'lead': ['synth', 'synthesizer', 'electronic'],
        'pad': ['ambient', 'atmosphere', 'texture'],
        'fx': ['effect', 'transition', 'sound effect']
    };
    
    for (const [category, keywords] of Object.entries(genericTerms)) {
        for (const keyword of keywords) {
            if (prompt.includes(keyword)) {
                log(`Category detection for "${promptText}": ${category} (generic match: "${keyword}")`);
                return category;
            }
        }
    }
    
    log(`Category detection for "${promptText}": favorites (no matches found)`);
    return 'favorites'; // Default fallback
}

function addAllSoundsToLibrary() {
    let addedCount = 0;
    
    generatedSounds.forEach((sound, index) => {
        const btn = document.querySelector(`[data-index="${index}"].add-to-library-btn`);
        if (btn && !btn.disabled) {
            addSoundToLibrary(index);
            addedCount++;
        }
    });
    
    if (addedCount > 0) {
        showMessage(`Added ${addedCount} variations to library`, 'success');
        log(`Added all available variations to library: ${addedCount} sounds`);
    } else {
        showMessage(`All variations already added`, 'info');
        log('All variations were already added to library');
    }
}

function closeGenerationResults() {
    // Clean up blob URLs
    generatedSounds.forEach(sound => {
        if (sound.playbackUrl) {
            URL.revokeObjectURL(sound.playbackUrl);
        }
    });
    
    generatedSounds = [];
    document.querySelector('.generated-sounds-section').style.display = 'none';
    
    // Close sound generation modal and open sound library
    closeSoundGenerationModal();
    
    // Open sound library to show the newly added sounds
    setTimeout(() => {
        openSoundLibraryModal();
        log('Redirected to Sound Library after generation');
    }, 100); // Small delay to ensure proper modal transition
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
    try {
        const jsonString = JSON.stringify(soundLibrary);
        localStorage.setItem('soundLibrary', jsonString);
        
        // Debug: verify it was saved
        const saved = localStorage.getItem('soundLibrary');
        if (saved) {
            const parsed = JSON.parse(saved);
            const totalSounds = Object.values(parsed).reduce((total, category) => {
                return total + (Array.isArray(category) ? category.length : 0);
            }, 0);
            log(`Successfully saved sound library to storage (${totalSounds} total sounds)`);
        } else {
            log('ERROR: Failed to save sound library - localStorage.getItem returned null');
        }
    } catch (error) {
        log('ERROR: Failed to save sound library:', error);
    }
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
        const isFavorite = sound.category === 'favorites';
        const favoriteIcon = isFavorite ? '⭐' : '☆';
        const favoriteTitle = isFavorite ? 'Remove from favorites' : 'Add to favorites';
        
        soundItem.innerHTML = `
            <span class="sound-name">${sound.name}</span>
            <div class="sound-buttons">
                <button class="sound-action-btn edit-sound-btn" data-sound-id="${sound.id}">Edit</button>
                <button class="sound-action-btn load-sound-btn" data-sound-id="${sound.id}">Load</button>
                <button class="sound-action-btn play-preview-btn" data-sound-id="${sound.id}">▶</button>
                <button class="sound-action-btn favorite-sound-btn" data-sound-id="${sound.id}" title="${favoriteTitle}">${favoriteIcon}</button>
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
        
        soundItem.querySelector('.favorite-sound-btn').addEventListener('click', () => {
            toggleFavorite(sound);
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
        
        // Add to favorites category
        if (!soundLibrary.favorites) {
            soundLibrary.favorites = [];
        }
        soundLibrary.favorites.push(trimmedSound);
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

// Toggle Favorite Function
function toggleFavorite(sound) {
    // Find the sound in the library and get its current category
    let currentCategory = null;
    let soundIndex = -1;
    
    for (const [category, sounds] of Object.entries(soundLibrary)) {
        if (Array.isArray(sounds)) {
            soundIndex = sounds.findIndex(s => s.id === sound.id);
            if (soundIndex !== -1) {
                currentCategory = category;
                break;
            }
        }
    }
    
    if (currentCategory && soundIndex !== -1) {
        // Remove from current category
        const soundData = soundLibrary[currentCategory][soundIndex];
        soundLibrary[currentCategory].splice(soundIndex, 1);
        
        if (currentCategory === 'favorites') {
            // Moving out of favorites - determine original category based on sound type
            // Try to determine from the sound name/prompt
            let newCategory = 'favorites'; // Default fallback
            
            // Simple heuristic based on sound name keywords
            const soundName = soundData.name.toLowerCase();
            if (soundName.includes('kick') || soundName.includes('snare') || soundName.includes('drum') || soundName.includes('808') || soundName.includes('cymbal') || soundName.includes('clap')) {
                newCategory = 'drums';
            } else if (soundName.includes('bass') || soundName.includes('sub')) {
                newCategory = 'bass';
            } else if (soundName.includes('synth') || soundName.includes('lead') || soundName.includes('arp') || soundName.includes('pluck') || soundName.includes('stab')) {
                newCategory = 'synth';
            } else if (soundName.includes('pad') || soundName.includes('drone') || soundName.includes('strings') || soundName.includes('ambient')) {
                newCategory = 'pad';
            } else if (soundName.includes('vocal') || soundName.includes('voice') || soundName.includes('choir')) {
                newCategory = 'vocal';
            } else if (soundName.includes('sweep') || soundName.includes('zap') || soundName.includes('whoosh') || soundName.includes('riser') || soundName.includes('impact')) {
                newCategory = 'fx';
            } else if (soundName.includes('djembe') || soundName.includes('tabla') || soundName.includes('sitar') || soundName.includes('didgeridoo') || soundName.includes('flute')) {
                newCategory = 'world';
            } else if (soundName.includes('rain') || soundName.includes('wind') || soundName.includes('fire') || soundName.includes('water') || soundName.includes('footsteps')) {
                newCategory = 'organic';
            }
            
            soundData.category = newCategory;
            showMessage(`Removed "${soundData.name}" from favorites`, 'success');
            log(`Removed sound from favorites: ${soundData.name} -> ${newCategory}`);
        } else {
            // Moving to favorites
            soundData.category = 'favorites';
            showMessage(`Added "${soundData.name}" to favorites`, 'success');
            log(`Added sound to favorites: ${soundData.name}`);
        }
        
        // Add to new category
        if (!soundLibrary[soundData.category]) {
            soundLibrary[soundData.category] = [];
        }
        soundLibrary[soundData.category].push(soundData);
        
        saveSoundLibrary();
        displaySoundLibrary();
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
        beatSequencer.stepNotes[i] = {}; // Will store semitone offsets for each step
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
        if (!beatSequencer.stepNotes[trackIndex]) {
            beatSequencer.stepNotes[trackIndex] = {};
        }
        
        for (let stepIndex = 0; stepIndex < beatSequencer.patternLength; stepIndex++) {
            const stepBtn = document.createElement('button');
            stepBtn.className = 'seq-step';
            stepBtn.dataset.track = trackIndex;
            stepBtn.dataset.step = stepIndex;
            
            // Add note indicator inside the button
            const noteIndicator = document.createElement('span');
            noteIndicator.className = 'note-indicator';
            noteIndicator.textContent = ''; // Will show note when set
            stepBtn.appendChild(noteIndicator);
            
            // Highlight every 4th step (downbeats)
            if (stepIndex % 4 === 0) {
                stepBtn.classList.add('downbeat');
            }
            
            // Left click to toggle step
            stepBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleStep(trackIndex, stepIndex);
            });
            
            // Right click to change note
            stepBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openNoteSelector(trackIndex, stepIndex, e.target);
            });
            
            // Long press for mobile (touch and hold)
            let longPressTimer;
            stepBtn.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => {
                    e.preventDefault();
                    openNoteSelector(trackIndex, stepIndex, e.target);
                }, 500);
            });
            
            stepBtn.addEventListener('touchend', () => {
                clearTimeout(longPressTimer);
            });
            
            stepBtn.addEventListener('touchmove', () => {
                clearTimeout(longPressTimer);
            });
            
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
        
        // If step is being activated and no note is set, set default (0 semitones)
        if (!isActive && !(stepIndex in beatSequencer.stepNotes[trackIndex])) {
            beatSequencer.stepNotes[trackIndex][stepIndex] = 0;
            updateStepNoteDisplay(trackIndex, stepIndex);
        }
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
        beatSequencer.stepNotes[trackIndex] = {}; // Clear note data too
    }
    
    // Update UI
    document.querySelectorAll('.seq-step').forEach(btn => {
        btn.classList.remove('active');
        const noteIndicator = btn.querySelector('.note-indicator');
        if (noteIndicator) {
            noteIndicator.textContent = '';
        }
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
                    // Get note offset for this step (default to 0 if not set)
                    const semitones = beatSequencer.stepNotes[trackIndex][stepIndex] || 0;
                    playSequencerStep(trackIndex, volume, time, semitones);
                }
            }
        }
    }
}

function playSequencerStep(trackIndex, volume, time, semitones = 0) {
    try {
        // Use the enhanced audio engine method with pitch offset
        const player = audioEngine.playSequencerSample(trackIndex, volume, time, semitones);
        if (player) {
            log(`Sequencer step played: Track ${trackIndex + 1}, Volume: ${volume.toFixed(2)}, Pitch: ${semitones > 0 ? '+' : ''}${semitones}`);
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

// ===== NOTE SELECTOR FUNCTIONS =====

function openNoteSelector(trackIndex, stepIndex, stepElement) {
    // Remove any existing note selector
    closeNoteSelector();
    
    const currentSemitones = beatSequencer.stepNotes[trackIndex][stepIndex] || 0;
    let selectedSemitones = currentSemitones; // Track temporary selection
    
    // Create note selector popup
    const noteSelector = document.createElement('div');
    noteSelector.className = 'note-selector-popup';
    noteSelector.id = 'note-selector-popup';
    
    // Add title
    const title = document.createElement('div');
    title.className = 'note-selector-title';
    title.textContent = `Track ${trackIndex + 1} - Step ${stepIndex + 1}`;
    noteSelector.appendChild(title);
    
    // Create notes grid container
    const notesGrid = document.createElement('div');
    notesGrid.className = 'note-selector-grid';
    
    // Note options from -12 to +12 semitones
    const noteOptions = [];
    for (let i = -12; i <= 12; i++) {
        const noteBtn = document.createElement('button');
        noteBtn.className = 'note-option';
        noteBtn.dataset.semitones = i;
        
        // Display note name
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const baseNote = 'C'; // Assuming C as base
        const noteIndex = (noteNames.indexOf(baseNote) + i + 12 * 10) % 12;
        const octaveOffset = Math.floor((i + 12 * 10) / 12) - 10;
        
        if (i === 0) {
            noteBtn.textContent = 'Original';
            noteBtn.classList.add('original');
        } else {
            noteBtn.textContent = `${noteNames[noteIndex]}${octaveOffset >= 0 ? '+' : ''}${octaveOffset !== 0 ? octaveOffset : ''}`;
        }
        
        if (i === currentSemitones) {
            noteBtn.classList.add('current');
        }
        
        if (i === selectedSemitones) {
            noteBtn.classList.add('selected');
        }
        
        noteBtn.addEventListener('click', () => {
            // Remove selection from all buttons
            noteOptions.forEach(btn => btn.classList.remove('selected'));
            
            // Add selection to clicked button
            noteBtn.classList.add('selected');
            selectedSemitones = i;
            
            // Preview the sound
            previewStepNote(trackIndex, i);
        });
        
        noteOptions.push(noteBtn);
    }
    
    noteOptions.forEach(btn => notesGrid.appendChild(btn));
    noteSelector.appendChild(notesGrid);
    
    // Add action buttons
    const actionButtons = document.createElement('div');
    actionButtons.className = 'note-selector-actions';
    
    const okBtn = document.createElement('button');
    okBtn.className = 'note-selector-ok';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => {
        setStepNote(trackIndex, stepIndex, selectedSemitones);
        closeNoteSelector();
    });
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'note-selector-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeNoteSelector);
    
    actionButtons.appendChild(okBtn);
    actionButtons.appendChild(cancelBtn);
    noteSelector.appendChild(actionButtons);
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'note-selector-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closeNoteSelector);
    noteSelector.appendChild(closeBtn);
    
    // Position near the step button
    const rect = stepElement.getBoundingClientRect();
    noteSelector.style.position = 'fixed';
    noteSelector.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
    noteSelector.style.top = Math.max(rect.top - 250, 10) + 'px';
    noteSelector.style.zIndex = '1000';
    
    document.body.appendChild(noteSelector);
    
    log(`Opened note selector for Track ${trackIndex + 1}, Step ${stepIndex + 1}`);
}

function closeNoteSelector() {
    const existing = document.getElementById('note-selector-popup');
    if (existing) {
        existing.remove();
    }
}

function setStepNote(trackIndex, stepIndex, semitones) {
    beatSequencer.stepNotes[trackIndex][stepIndex] = semitones;
    updateStepNoteDisplay(trackIndex, stepIndex);
    
    log(`Set Track ${trackIndex + 1}, Step ${stepIndex + 1} to ${semitones > 0 ? '+' : ''}${semitones} semitones`);
}

function updateStepNoteDisplay(trackIndex, stepIndex) {
    const stepBtn = document.querySelector(`.seq-step[data-track="${trackIndex}"][data-step="${stepIndex}"]`);
    const noteIndicator = stepBtn?.querySelector('.note-indicator');
    
    if (noteIndicator) {
        const semitones = beatSequencer.stepNotes[trackIndex][stepIndex];
        if (semitones === undefined || semitones === 0) {
            noteIndicator.textContent = '';
        } else {
            noteIndicator.textContent = semitones > 0 ? `+${semitones}` : `${semitones}`;
        }
    }
}

function previewStepNote(trackIndex, semitones) {
    if (!audioEngine || !audioEngine.tracks[trackIndex] || !audioEngine.tracks[trackIndex].sample) {
        log(`No sample loaded for track ${trackIndex + 1} preview`);
        return;
    }
    
    try {
        // Use the audio engine's sequencer method for preview
        const volume = beatSequencer.volumes[trackIndex] / 100;
        audioEngine.playSequencerSample(trackIndex, volume, null, semitones);
        
        log(`Previewed Track ${trackIndex + 1} with ${semitones > 0 ? '+' : ''}${semitones} semitones`);
    } catch (error) {
        log(`ERROR: Failed to preview note for track ${trackIndex + 1}:`, error);
    }
}

// Close note selector when clicking outside
document.addEventListener('click', (e) => {
    const noteSelector = document.getElementById('note-selector-popup');
    if (noteSelector && !noteSelector.contains(e.target) && !e.target.classList.contains('seq-step')) {
        closeNoteSelector();
    }
});

// ===== PROMPT BUILDER FUNCTIONS =====

// State for the new prompt builder
const promptBuilder = {
    selectedSoundType: null,
    selectedAdjectives: new Set(),
    musicalOptions: {
        includeKey: false,
        includeTempo: false,
        includeScale: false
    }
};

// Sound type to category mapping - updated with detailed categories
const soundTypeCategories = {
    // Specific Drum Types
    'kick drum': 'kick',
    'snare drum': 'snare', 
    'hi-hat': 'hihat',
    'cymbal': 'percussion',
    'tom drum': 'percussion',
    'clap': 'percussion',
    'shaker': 'percussion',
    'cowbell': 'percussion',
    '808': 'kick', // 808s are kick-style sounds
    
    // Bass & Low End
    'bass': 'bass',
    'sub bass': 'bass',
    'bass drop': 'bass',
    
    // Synths & Leads - More specific categories
    'synth lead': 'lead',
    'arpeggio': 'arp',
    'pluck': 'pluck',
    'stab': 'stab',
    'sequence': 'arp',
    
    // Pads & Atmosphere - More specific
    'pad': 'pad',
    'drone': 'drone',
    'choir': 'vocal',
    'strings': 'strings',
    'bells': 'bells',
    'ambient texture': 'pad',
    
    // Effects & Transitions
    'sweep': 'fx',
    'zap': 'fx',
    'whoosh': 'fx',
    'impact': 'fx',
    'riser': 'fx',
    
    // Vocal & Human
    'vocal': 'vocal',
    'voice': 'vocal',
    'chant': 'vocal',
    'breath': 'vocal',
    
    // World & Ethnic
    'djembe': 'world',
    'tabla': 'world',
    'sitar': 'world',
    'didgeridoo': 'world',
    'flute': 'world',
    
    // Organic & Foley
    'rain': 'organic',
    'wind': 'organic',
    'fire': 'organic',
    'water': 'organic',
    'footsteps': 'organic'
};

// Function to get category for a sound type
function getCategoryForSoundType(soundType) {
    return soundTypeCategories[soundType] || 'favorites';
}

function setupPromptBuilders() {
    log('Setting up new prompt builder system...');
    
    // Sound type selection (single selection) - immediate response
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('sound-type-btn')) {
            e.preventDefault();
            e.stopPropagation();
            
            // Check if button is already being processed
            if (e.target.dataset.processing === 'true') {
                log('Sound type button click ignored - already processing');
                return;
            }
            
            // Mark as processing to prevent rapid clicks
            e.target.dataset.processing = 'true';
            
            selectSoundType(e.target);
            
            // Reset processing flag after a short delay
            setTimeout(() => {
                e.target.dataset.processing = 'false';
            }, 150);
        }
    });
    
    // Adjective selection (multi-selection) - immediate response
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('adjective-btn')) {
            e.preventDefault();
            e.stopPropagation();
            
            // Check if button is already being processed
            if (e.target.dataset.processing === 'true') {
                log('Adjective button click ignored - already processing');
                return;
            }
            
            // Mark as processing to prevent rapid clicks
            e.target.dataset.processing = 'true';
            
            toggleAdjective(e.target);
            
            // Reset processing flag after a short delay
            setTimeout(() => {
                e.target.dataset.processing = 'false';
            }, 150);
        }
    });
    
    // Musical options checkboxes
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('musical-checkbox')) {
            updateMusicalOptions();
        }
    });
    
    // Builder action buttons
    document.getElementById('build-prompt-btn').addEventListener('click', buildAndInsertPrompt);
    document.getElementById('clear-prompt-btn').addEventListener('click', clearPromptOnly);
    document.getElementById('clear-selection-btn').addEventListener('click', clearAllSelections);
    
    // Update current project values in display
    updateProjectValueDisplays();
    
    log('New prompt builder system set up successfully');
}

function selectSoundType(button) {
    const soundType = button.dataset.sound;
    const isCurrentlySelected = button.classList.contains('selected');
    
    // Clear any existing inline styles and animations
    button.style.background = '';
    button.style.transform = '';
    button.classList.remove('select-flash', 'deselect-flash');
    
    if (isCurrentlySelected) {
        // Deselect if already selected
        button.classList.remove('selected');
        promptBuilder.selectedSoundType = null;
        
        // Visual feedback for deselection
        button.classList.add('deselect-flash');
        setTimeout(() => {
            button.classList.remove('deselect-flash');
        }, 300);
        
        log(`Deselected sound type: "${soundType}"`);
    } else {
        // Clear previous selection first
        document.querySelectorAll('.sound-type-btn').forEach(btn => {
            btn.classList.remove('selected', 'select-flash', 'deselect-flash');
            btn.style.background = '';
            btn.style.transform = '';
        });
        
        // Select new sound type
        button.classList.add('selected');
        promptBuilder.selectedSoundType = soundType;
        
        // Visual feedback for selection
        button.classList.add('select-flash');
        setTimeout(() => {
            button.classList.remove('select-flash');
        }, 300);
        
        log(`Selected sound type: "${promptBuilder.selectedSoundType}"`);
    }
    
    updatePromptPreview();
}

function toggleAdjective(button) {
    const adjective = button.dataset.adjective;
    const isCurrentlySelected = promptBuilder.selectedAdjectives.has(adjective);
    
    // Clear any existing inline styles and animations
    button.style.background = '';
    button.style.transform = '';
    button.classList.remove('select-flash', 'deselect-flash');
    
    if (isCurrentlySelected) {
        // Remove adjective
        promptBuilder.selectedAdjectives.delete(adjective);
        button.classList.remove('selected');
        
        // Visual feedback for removal
        button.classList.add('deselect-flash');
        setTimeout(() => {
            button.classList.remove('deselect-flash');
        }, 300);
        
        log(`Removed adjective: "${adjective}"`);
    } else {
        // Add adjective
        promptBuilder.selectedAdjectives.add(adjective);
        button.classList.add('selected');
        
        // Visual feedback for addition
        button.classList.add('select-flash');
        setTimeout(() => {
            button.classList.remove('select-flash');
        }, 300);
        
        log(`Added adjective: "${adjective}"`);
    }
    
    updatePromptPreview();
    log(`Current adjectives: [${Array.from(promptBuilder.selectedAdjectives).join(', ')}]`);
}

function updateMusicalOptions() {
    promptBuilder.musicalOptions.includeKey = document.getElementById('include-project-key').checked;
    promptBuilder.musicalOptions.includeTempo = document.getElementById('include-tempo').checked;
    promptBuilder.musicalOptions.includeScale = document.getElementById('include-scale').checked;
    
    updatePromptPreview();
    log(`Musical options: Key=${promptBuilder.musicalOptions.includeKey}, Tempo=${promptBuilder.musicalOptions.includeTempo}, Scale=${promptBuilder.musicalOptions.includeScale}`);
}

function updateProjectValueDisplays() {
    // Get current project values from the control panel
    const currentKey = document.getElementById('key')?.value || 'C';
    const currentBPM = document.getElementById('bpm')?.value || '120';
    const currentScale = document.getElementById('scale')?.value || 'major';
    
    // Update displays in the musical options
    const keyDisplay = document.getElementById('current-key-display');
    const bpmDisplay = document.getElementById('current-bpm-display');
    const scaleDisplay = document.getElementById('current-scale-display');
    
    if (keyDisplay) keyDisplay.textContent = currentKey;
    if (bpmDisplay) bpmDisplay.textContent = currentBPM;
    if (scaleDisplay) scaleDisplay.textContent = currentScale;
}

function updatePromptPreview() {
    const previewElement = document.getElementById('prompt-preview');
    if (!previewElement) return;
    
    let preview = '';
    
    if (!promptBuilder.selectedSoundType) {
        // Show adjectives only if no sound type selected
        const adjectives = Array.from(promptBuilder.selectedAdjectives);
        if (adjectives.length > 0) {
            preview = adjectives.join(' ') + ' [select a sound type]';
        } else {
            preview = 'Select a sound type and adjectives';
        }
    } else {
        // Start with adjectives
        const adjectives = Array.from(promptBuilder.selectedAdjectives);
        if (adjectives.length > 0) {
            preview = adjectives.join(' ') + ' ';
        }
        
        // Add sound type
        preview += promptBuilder.selectedSoundType;
        
        // Add musical options
        const musicalParts = [];
        if (promptBuilder.musicalOptions.includeKey) {
            const currentKey = document.getElementById('key')?.value || 'C';
            musicalParts.push(`in ${currentKey}`);
        }
        if (promptBuilder.musicalOptions.includeScale) {
            const currentScale = document.getElementById('scale')?.value || 'major';
            musicalParts.push(`${currentScale} scale`);
        }
        if (promptBuilder.musicalOptions.includeTempo) {
            const currentBPM = document.getElementById('bpm')?.value || '120';
            musicalParts.push(`at ${currentBPM} BPM`);
        }
        
        if (musicalParts.length > 0) {
            preview += ' ' + musicalParts.join(' ');
        }
    }
    
    previewElement.textContent = preview;
}

function buildAndInsertPrompt() {
    if (!promptBuilder.selectedSoundType) {
        alert('Please select a sound type first!');
        return;
    }
    
    let prompt = '';
    
    // Start with adjectives
    const adjectives = Array.from(promptBuilder.selectedAdjectives);
    if (adjectives.length > 0) {
        prompt = adjectives.join(' ') + ' ';
    }
    
    // Add sound type
    prompt += promptBuilder.selectedSoundType;
    
    // Add musical options
    const musicalParts = [];
    if (promptBuilder.musicalOptions.includeKey) {
        const currentKey = document.getElementById('key')?.value || 'C';
        musicalParts.push(`in ${currentKey}`);
    }
    if (promptBuilder.musicalOptions.includeScale) {
        const currentScale = document.getElementById('scale')?.value || 'major';
        musicalParts.push(`${currentScale} scale`);
    }
    if (promptBuilder.musicalOptions.includeTempo) {
        const currentBPM = document.getElementById('bpm')?.value || '120';
        musicalParts.push(`at ${currentBPM} BPM`);
    }
    
    if (musicalParts.length > 0) {
        prompt += ' ' + musicalParts.join(' ');
    }
    
    // Replace the entire prompt (don't append)
    insertPromptTextSilently(prompt);
    
    // Visual feedback on the build button
    const buildBtn = document.getElementById('build-prompt-btn');
    if (buildBtn) {
        const originalText = buildBtn.textContent;
        buildBtn.textContent = '✅ Prompt Built!';
        buildBtn.style.background = 'linear-gradient(145deg, #26de81, #20c973)';
        
        setTimeout(() => {
            buildBtn.textContent = originalText;
            buildBtn.style.background = '';
        }, 2000);
    }
    
    // Scroll to the generate button instead
    scrollToGenerateButton();
    
    log(`Built and replaced prompt: "${prompt}"`);
}

function insertPromptTextSilently(promptText) {
    const promptTextarea = document.getElementById('sound-prompt');
    if (!promptTextarea) {
        log('ERROR: sound-prompt textarea not found');
        return;
    }
    
    // ALWAYS replace the entire prompt when building from prompt builder
    // This ensures new prompts don't accumulate with old ones
    promptTextarea.value = promptText;
    
    // DON'T focus the textarea to avoid keyboard popup and scrolling
    // promptTextarea.focus(); // Removed this line
    
    log(`Replaced prompt text with: "${promptText}"`);
}

function scrollToGenerateButton() {
    // Find the generate button and scroll it into view smoothly
    const generateButton = document.getElementById('generate-sound');
    if (generateButton) {
        generateButton.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
        });
        
        // Add a subtle highlight to draw attention to the generate button
        generateButton.style.boxShadow = '0 0 20px rgba(74, 158, 255, 0.6)';
        generateButton.style.transform = 'scale(1.05)';
        
        setTimeout(() => {
            generateButton.style.boxShadow = '';
            generateButton.style.transform = '';
        }, 1500);
        
        log('Scrolled to generate button');
    }
}

function clearPromptOnly() {
    const promptTextarea = document.getElementById('sound-prompt');
    if (promptTextarea) {
        promptTextarea.value = '';
        
        // Visual feedback
        const clearBtn = document.getElementById('clear-prompt-btn');
        if (clearBtn) {
            const originalText = clearBtn.textContent;
            clearBtn.textContent = '✅ Cleared!';
            clearBtn.style.background = 'linear-gradient(145deg, #26de81, #20c973)';
            
            setTimeout(() => {
                clearBtn.textContent = originalText;
                clearBtn.style.background = '';
            }, 1500);
        }
        
        log('Cleared prompt text only');
    }
}

function clearAllSelections() {
    // Clear sound type
    document.querySelectorAll('.sound-type-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    promptBuilder.selectedSoundType = null;
    
    // Clear adjectives
    document.querySelectorAll('.adjective-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    promptBuilder.selectedAdjectives.clear();
    
    // Clear musical options
    document.querySelectorAll('.musical-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    promptBuilder.musicalOptions = {
        includeKey: false,
        includeTempo: false,
        includeScale: false
    };
    
    // Also clear the prompt text
    clearPromptOnly();
    
    updatePromptPreview();
    log('Cleared all prompt builder selections and prompt text');
}

function insertPromptText(promptText) {
    const promptTextarea = document.getElementById('sound-prompt');
    if (!promptTextarea) {
        log('ERROR: sound-prompt textarea not found');
        return;
    }
    
    const currentText = promptTextarea.value.trim();
    
    if (currentText === '') {
        // If empty, just set the new text
        promptTextarea.value = promptText;
    } else {
        // If there's existing text, add with comma separator
        promptTextarea.value = currentText + ', ' + promptText;
    }
    
    // For manual insertions (not from prompt builder), still focus and position cursor
    // This is used for any direct text insertions that aren't from the build button
    promptTextarea.focus();
    promptTextarea.setSelectionRange(promptTextarea.value.length, promptTextarea.value.length);
    
    log(`Inserted prompt text: "${promptText}"`);
}