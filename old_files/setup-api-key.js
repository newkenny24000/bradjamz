// Store the API key in localStorage when the page loads
if (\!localStorage.getItem('elevenlabs_api_key')) {
    localStorage.setItem('elevenlabs_api_key', 'sk_087476f6f687b3f3ee46c10fb2c53bfbd9e4f38af0ad0a22');
    console.log('ElevenLabs API key saved');
}
