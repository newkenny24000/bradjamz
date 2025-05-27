# 8-Track Studio Architecture Analysis

## Project Overview
This is a web-based 8-track multi-instrument digital audio workstation (DAW) that allows users to create music using AI-generated sounds through the ElevenLabs API. The application features touch-based interactions, real-time audio processing, and a beat sequencer.

## Core Architecture

### 1. Frontend Layer (HTML/CSS/JS)
The application is built as a single-page application (SPA) with no backend server requirements.

#### Key Files:
- **index.html**: Main application structure with 8 track controls, sequencer grid, and multiple modal dialogs
- **styles.css**: Modern dark theme with gradient effects and responsive design
- **script.js**: Main application logic and UI event handling (~1000+ lines)
- **tone-audio-engine.js**: Audio engine wrapper around Tone.js library
- **debug.js**: Debug logging system with visual console

### 2. Audio Engine Architecture

#### Tone.js Integration
The application uses Tone.js (v14.7.77) as the core audio processing library, providing:
- Sample playback with pitch shifting
- Real-time effects processing (reverb, delay, volume, decay)
- Sequencer timing and scheduling
- Polyphonic playback capabilities

#### Audio Signal Flow:
```
Sound Source (Player/Sampler)
    ↓
Track Effects Chain:
    → Delay (Feedback Delay)
    → Reverb (Convolver)
    → Gain (Volume Control)
    ↓
Master Gain (0.7)
    ↓
Audio Output (Destination)
```

#### Per-Track Architecture:
Each of the 8 tracks contains:
- **Player**: For direct sample playback with pitch shifting
- **Bypass Player**: For original unprocessed sound playback
- **Sampler**: For sequencer-based polyphonic playback
- **Effects Chain**: Individual reverb, delay, volume, and decay controls

### 3. Sound Generation System

#### ElevenLabs Integration:
- Uses ElevenLabs API for AI sound generation
- API key stored in localStorage
- Generates 3 variations per prompt request
- Sound generation modal with:
  - Text prompt input
  - Sound builder UI with categories and adjectives
  - Musical context options (key, tempo, scale)

#### Sound Storage:
- Generated sounds stored as base64 data URLs in localStorage
- Sound library organized by categories
- Each sound contains: name, category, data URL, favorite status

### 4. Beat Sequencer

#### Architecture:
- 8 tracks × 16/32 steps grid
- Per-step note control with pitch adjustment
- Track-level controls: mute, solo, volume
- Pattern storage in project state
- Web Worker-based timing for accurate playback

#### Sequencer State:
```javascript
beatSequencer = {
    isPlaying: boolean,
    currentStep: number,
    patternLength: 16 | 32,
    sequence: { trackIndex: [step states] },
    stepNotes: { trackIndex: { stepIndex: semitones } },
    muted/solo/volumes: { trackIndex: value },
    swing: 0-100
}
```

### 5. Touch Interface System

#### Multi-touch Canvas:
- Full-screen canvas divided into 8 horizontal zones
- Each zone corresponds to one track
- X-axis: Pitch control (-12 to +12 semitones)
- Y-axis: Velocity/volume control
- Visual feedback with colored touch indicators

#### Touch Event Flow:
1. Touch start → Create voice/indicator
2. Touch move → Update pitch/velocity
3. Touch end → Stop voice, fade indicator

### 6. Project Management System

#### Storage Structure:
Projects stored in localStorage with:
- Beat sequencer patterns and settings
- Track effects configurations
- Sound assignments per track
- Project metadata (name, timestamp)
- Sound library (user-generated sounds)

#### Project Operations:
- New/Save/Save As/Load
- Import/Export as JSON files
- Project manager modal with list view
- Storage usage tracking

### 7. UI Component Architecture

#### Modal Dialogs:
1. **Sound Generation Modal**: AI sound creation interface
2. **Sound Library Modal**: Browse and manage sounds
3. **Audio Editor Modal**: Waveform trimming (partially implemented)
4. **Track Picker Modal**: Sound assignment interface
5. **Project Manager Modal**: Project list and operations

#### Track Control Panel:
- Collapsible sidebar with 8 track controls
- Per-track sound selector
- Effects panel (hidden by default)
- Generate and FX toggle buttons

### 8. State Management

#### Global State:
- `audioEngine`: ToneAudioEngine instance
- `selectedTrack`: Currently selected track
- `soundLibrary`: All available sounds
- `beatSequencer`: Sequencer state object
- `currentProjectName`: Active project name

#### Event-Driven Updates:
- UI events trigger state changes
- State changes update audio engine
- Audio engine confirms changes via console logs

## Key Design Patterns

### 1. Module Pattern
Audio engine and major components encapsulated in classes/objects

### 2. Event Delegation
Touch and mouse events handled at container level for performance

### 3. Lazy Loading
Audio samples loaded on-demand when assigned to tracks

### 4. Factory Pattern
Track creation in audio engine uses factory method

### 5. Observer Pattern
Debug logging system observes console methods

## Technology Stack

### Core Technologies:
- **Audio**: Tone.js v14.7.77
- **UI**: Vanilla JavaScript, HTML5, CSS3
- **Storage**: localStorage API
- **Graphics**: Canvas API for visualizations
- **API**: ElevenLabs for sound generation

### Browser APIs Used:
- Web Audio API (via Tone.js)
- Touch Events API
- File API (import/export)
- localStorage API
- Canvas 2D Context

## Performance Considerations

### Optimizations:
1. Sample reuse via Tone.js Sampler
2. Debounced UI updates
3. RequestAnimationFrame for animations
4. Event delegation for touch handling
5. Lazy effect chain creation

### Memory Management:
- Blob URLs cleaned up on sound deletion
- Touch indicators removed after animation
- Scheduled notes tracked to prevent duplicates

## Security & Data Flow

### API Key Management:
- ElevenLabs API key stored in localStorage
- No backend proxy (direct API calls)
- CORS handled by ElevenLabs

### Data Persistence:
- All data stored client-side
- No user authentication
- Projects exportable as JSON files

## Development Workflow Evidence

### Version Control:
- Backup files with timestamps show iterative development
- Old_files directory contains abandoned approaches
- Multiple attempts at audio engine implementation

### Code Evolution:
1. Started with Web Audio API directly (audio-engine.js)
2. Migrated to Tone.js for better abstraction
3. Refactored UI components multiple times
4. Added project management as later feature

## Module Interactions

```
User Input (Touch/Click)
    ↓
Event Handlers (script.js)
    ↓
State Updates
    ↓
Audio Engine Commands (tone-audio-engine.js)
    ↓
Tone.js Processing
    ↓
Audio Output
```

## Future Architecture Considerations

The current architecture supports:
- Adding more tracks (change numTracks)
- New effect types (extend effect chain)
- Different sound sources (modify loadSample)
- Backend integration (add API layer)
- Real-time collaboration (add WebSocket layer)