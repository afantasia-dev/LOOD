export function loadRemoteModel(modelContainer, renderer, modelUrl) {
    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.3/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    let mixerOut = null;

    loader.load(
        modelUrl,
        function (gltf) {
            const model = gltf.scene;
            
            if (gltf.animations && gltf.animations.length > 0) {
                mixerOut = new THREE.AnimationMixer(model);
                gltf.animations.forEach((clip) => mixerOut.clipAction(clip).play());
            }
            
            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    if (child.geometry) child.geometry.computeVertexNormals();

                    if (child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => { 
                            if (m.map) {
                                m.map.encoding = THREE.sRGBEncoding;
                                m.map.generateMipmaps = true;
                                m.map.minFilter = THREE.LinearMipmapLinearFilter;
                                if (renderer.capabilities.getMaxAnisotropy) {
                                    m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
                                }
                            }
                            if (m.emissiveMap) m.emissiveMap.encoding = THREE.sRGBEncoding;
                            m.side = THREE.DoubleSide; 
                            m.needsUpdate = true;
                        });
                    }
                }
            });

            const QR_HALF_SIZE = 0.06;
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3()); 
            const center = box.getCenter(new THREE.Vector3());
            const qrAnchoFisico = QR_HALF_SIZE * 6;
            const maxDim = Math.max(size.x, size.z);
            
            if (maxDim > 0) {
                const scale = qrAnchoFisico / maxDim;
                model.scale.set(scale, scale, scale);
                model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
                modelContainer.add(model);
                console.log("[WebAR] Modelo 3D cargado con éxito desde:", modelUrl);
            }
        },
        undefined,
        function (error) {
            console.error("[WebAR] Error cargando modelo 3D:", error);
        }
    );

    return { getMixer: () => mixerOut };
}
