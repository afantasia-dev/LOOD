# LOOD
3D AR viewer for WEB

│
├── index.html                  # HTML principal (Estructura base, canvas y contenedores)
│
├── /css/
│   └── main.css                # Estilos visuales, reset y posición de canvas/botones
│
├── /js/
│   ├── main.js                 # Coordinador principal (Ciclo de vida, StartCamera y RenderLoop)
│   ├── ar-tracker.js           # Lógica del Pipeline, Worker Pool y resolución de Homografía (solve8x8)
│   ├── audio-manager.js        # Control de reproducción de audio HTML5
│   └── model-loader.js         # Cargador optimizado de GLTF/Draco y AnimationMixer
│
├── /luts/
│   ├── lut_2d_math.js          # Tabla LUT de trigonometría y operaciones 2D
│   └── lut_3d_avanzado.js      # Tabla LUT 3D (FISR, Slerp, Rayos y Solver)
│
└── /assets/
    └── models/
        └── mariposa.glb        # Modelos 3D locales 
