import { initAudioSystem } from './audio-manager.js';
import { loadRemoteModel } from './model-loader.js';
import { setupARTracker } from './ar-tracker.js';

// ==========================================
// 🚀 CONFIGURACIÓN CENTRAL DEL PROYECTO
// ==========================================
const WebARConfig = {
    // URL del modelo GLB (cargado desde CDN de GitHub usando jsDelivr para máximo rendimiento)
    modelUrl: "https://cdn.jsdelivr.net/gh/afantasia-dev/TEC2026@main/mariposa.glb",
    
    // URL del Audio MP3
    audioUrl: "https://cdn.jsdelivr.net/gh/afantasia-dev/TEC2026@main/Kustatiicha.mp3",
    
    // El texto o URL exacto que contiene tu código QR físico (dejar "" para aceptar cualquiera)
    qrTargetValue: "www.afantasia.dev/mariposa"
};
// ==========================================

let scene = null, camera = null, renderer = null;
let modelContainer = null;
let trackerModule = null;
let modelLoaderModule = null;

const video = document.getElementById('camera-video');
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx = bgCanvas.getContext('2d', { alpha: false, desynchronized: true }); 
const arCanvas = document.getElementById('ar-canvas');

let renderW = window.innerWidth, renderH = window.innerHeight, offsetX = 0, offsetY = 0;
let lastRenderTime = 0;
const RENDER_INTERVAL = 1000 / 60; // Límite estricto a 60 FPS

const viewportInfo = { renderW: 0, renderH: 0, offsetX: 0, offsetY: 0 };
function getViewportInfo() {
    viewportInfo.renderW = renderW;
    viewportInfo.renderH = renderH;
    viewportInfo.offsetX = offsetX;
    viewportInfo.offsetY = offsetY;
    return viewportInfo;
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: false 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play().then(() => { 
                if (!scene) initEngine(); 
            }).catch(() => {
                window.addEventListener('click', () => { 
                    video.play(); 
                    if (!scene) initEngine(); 
                }, { once: true });
            });
        };
    } catch (err) { 
        window.addEventListener('click', () => startCamera(), { once: true }); 
    }
}

function initEngine() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
    camera.position.set(0, 0, 0);

    const glContext = arCanvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer = new THREE.WebGLRenderer({ 
        canvas: arCanvas, 
        context: glContext,
        alpha: true, 
        antialias: true, 
        powerPreference: 'high-performance' 
    });
    
    arCanvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn("[WebAR] Contexto WebGL perdido temporalmente.");
    }, false);

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(2.0, 5.0, 3.0);
    scene.add(dirLight);

    modelContainer = new THREE.Group();

    updateCoverMath();
    
    // Inyección de dependencias centralizadas
    initAudioSystem(WebARConfig.audioUrl);
    modelLoaderModule = loadRemoteModel(modelContainer, renderer, WebARConfig.modelUrl);
    trackerModule = setupARTracker(scene, modelContainer, getViewportInfo, WebARConfig.qrTargetValue);

    window.addEventListener('resize', onResize);
    requestAnimationFrame(renderLoop);
}

function updateCoverMath() {
    const sw = window.innerWidth, sh = window.innerHeight;
    const vw = video.videoWidth || sw, vh = video.videoHeight || sh;
    const screenRatio = sw / sh, videoRatio = vw / vh;
    
    let scale;
    if (screenRatio > videoRatio) { 
        renderW = sw; renderH = sw / videoRatio; offsetX = 0; offsetY = (sh - renderH) / 2; 
        scale = sw / vw;
    } else { 
        renderH = sh; renderW = sh * videoRatio; offsetX = (sw - renderW) / 2; offsetY = 0; 
        scale = sh / vh;
    }

    const VIDEO_VERTICAL_FOV = 60; 
    const f_video = (vh / 2) / Math.tan((VIDEO_VERTICAL_FOV * Math.PI) / 360);
    window.focalLengthScreen = f_video * scale;

    if (camera) {
        const newFov = 2 * Math.atan((sh / 2) / window.focalLengthScreen) * (180 / Math.PI);
        if (Math.abs(camera.fov - newFov) > 0.1) {
            camera.fov = newFov;
            camera.aspect = sw / sh;
            camera.updateProjectionMatrix();
        }
    }
}

function renderVideoToCanvas() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
        if (bgCanvas.width !== window.innerWidth || bgCanvas.height !== window.innerHeight) {
            bgCanvas.width = window.innerWidth; bgCanvas.height = window.innerHeight;
            updateCoverMath();
        }
        bgCtx.drawImage(video, offsetX, offsetY, renderW, renderH);
    }
}

function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight; 
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateCoverMath();
}

const clock = new THREE.Clock();

function renderLoop(currentTime) { 
    requestAnimationFrame(renderLoop); 
    
    const elapsed = currentTime - lastRenderTime;
    if (elapsed < RENDER_INTERVAL) return;
    
    lastRenderTime = currentTime - (elapsed % RENDER_INTERVAL);

    renderVideoToCanvas(); 

    if (trackerModule) {
        trackerModule.dispatchFrame(video);
        trackerModule.updateRenderPose();  
    }

    const delta = clock.getDelta();
    const mixerInstance = modelLoaderModule ? modelLoaderModule.getMixer() : null;
    if (mixerInstance) {
        mixerInstance.update(delta);
    }

    if (renderer && scene && camera) {
        renderer.render(scene, camera); 
    }
}

startCamera();
