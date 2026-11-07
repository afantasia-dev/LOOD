export function initAudioSystem(audioUrl) {
    const bgMusic = new Audio(audioUrl);
    bgMusic.loop = true; 
    let isPlaying = false;

    const audioBtn = document.getElementById('audio-btn');
    if (!audioBtn) return;

    audioBtn.addEventListener('click', () => {
        if (isPlaying) {
            bgMusic.pause();
            audioBtn.innerText = '🎵';
            audioBtn.classList.replace('bg-red-500', 'bg-purple-600');
        } else {
            bgMusic.play().catch(e => console.error("[WebAR] Error de audio:", e));
            audioBtn.innerText = '⏸';
            audioBtn.classList.replace('bg-purple-600', 'bg-red-500');
        }
        isPlaying = !isPlaying;
    });
}
