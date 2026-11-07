export function setupARTracker(scene, modelContainer, getViewportInfo, targetQrValue) {
    if (typeof window.createScreenRayLUTs === 'undefined') {
        window.createScreenRayLUTs = function(screenWidth, screenHeight, focalLength) {
            const lutU = new Float32Array(screenWidth);
            const lutV = new Float32Array(screenHeight);
            const cx = screenWidth * 0.5;
            const cy = screenHeight * 0.5;
            for (let x = 0; x < screenWidth; x++) lutU[x] = (x - cx) / focalLength;
            for (let y = 0; y < screenHeight; y++) lutV[y] = -(y - cy) / focalLength;
            return { lutU, lutV };
        };
    }

    if (typeof window.lutFastInvSqrt === 'undefined') {
        window.lutFastInvSqrt = function(sqrMag) {
            return sqrMag > 1e-8 ? 1.0 / Math.sqrt(sqrMag) : 1.0;
        };
    }

    const _slerpWeightsOut = new Float32Array(2);
    function getFastSlerpWeights(absDot) {
        if (typeof LUT_SLERP_WEIGHTS !== 'undefined' && typeof LUT_SLERP_STEPS !== 'undefined') {
            const clamped = absDot > 1 ? 1 : (absDot < 0 ? 0 : absDot);
            const idx = ((clamped * LUT_SLERP_STEPS) | 0) << 1;
            _slerpWeightsOut[0] = LUT_SLERP_WEIGHTS[idx];
            _slerpWeightsOut[1] = LUT_SLERP_WEIGHTS[idx + 1];
        } else {
            _slerpWeightsOut[0] = 0.75;
            _slerpWeightsOut[1] = 0.25;
        }
        return _slerpWeightsOut;
    }

    const scanCanvas = document.createElement('canvas');
    const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
    const SCAN_WIDTH = 540; 
    let SCAN_HEIGHT = 960; 

    let frameCounter = 0;
    let lastDispatchTime = 0;
    const DISPATCH_INTERVAL = 1000 / 30; 

    const workerCode = `
        importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
        self.onmessage = function(e) {
            try {
                const { id, width, height, buffer } = e.data;
                const data = new Uint8ClampedArray(buffer);
                const qr = jsQR(data, width, height, { inversionAttempts: "dontInvert" });

                if (qr && qr.location) {
                    self.postMessage({ id, success: true, location: qr.location, data: qr.data });
                } else {
                    self.postMessage({ id, success: false });
                }
            } catch (error) {
                self.postMessage({ id: e.data.id, success: false });
            }
        };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));

    const MAX_WORKERS = navigator.hardwareConcurrency || 4; 
    const workers = [], idleWorkers = [];
    let latestProcessedId = 0;

    for (let i = 0; i < MAX_WORKERS; i++) {
        const w = new Worker(workerUrl);
        workers.push(w); 
        idleWorkers.push(w);
        w.onmessage = function(e) {
            const { id, success, location, data } = e.data;
            idleWorkers.push(w); 

            if (id < latestProcessedId) return;
            latestProcessedId = id;

            if (success) handleWorkerResult(location, data);
            else handleWorkerMiss();
        };
    }

    let isTracked = false;
    const QR_HALF_SIZE = 0.06;

    const GRID_RESOLUTION = 0.001; 
    const HALF_GRID_SIZE = 2.5;    

    const PERSISTENCE_MS = 250; 
    let lastSeenTime = 0;       
    let hasEverBeenTracked = false; 

    const targetPos = new THREE.Vector3();
    const targetQuat = new THREE.Quaternion();
    const calculatedPos = new THREE.Vector3();
    const calculatedQuat = new THREE.Quaternion();

    const lastRenderedPos = new THREE.Vector3();
    const lastRenderedQuat = new THREE.Quaternion();

    const invMatrix = new THREE.Matrix4();
    const relativePos = new THREE.Vector3();
    const relativeQuat = new THREE.Quaternion();

    const rx = new THREE.Vector3();
    const rz = new THREE.Vector3();
    const ry = new THREE.Vector3();
    const tempVec = new THREE.Vector3();
    const scaleOne = new THREE.Vector3(1, 1, 1);
    const dummyScale = new THREE.Vector3();
    const mat4Temp = new THREE.Matrix4();
    const _lutEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const RAD_TO_LUT_IDX = (180.0 / Math.PI) * 200.0; 

    const STATIC_M = new Array(8);
    for(let i = 0; i < 8; i++) STATIC_M[i] = new Float32Array(9);
    const STATIC_X = new Float32Array(8);
    const STATIC_B = new Float32Array(8);
    const STATIC_A = new Array(8);
    for(let i = 0; i < 8; i++) STATIC_A[i] = new Float32Array(8);

    let screenRayLUTs = null;
    const cornersBuffer = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];

    const qrFloorAnchor = new THREE.Group();
    qrFloorAnchor.visible = false;
    scene.add(qrFloorAnchor);

    const s = QR_HALF_SIZE;
    const squareGroup = new THREE.Group();
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-s,0,-s, s,0,-s, s,0,-s, s,0,s, s,0,s, -s,0,s, -s,0,s, -s,0,-s]), 3));
    squareGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 })));

    const dotGeo = new THREE.SphereGeometry(0.003, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const cornerDots = [ [-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s] ];
    cornerDots.forEach(pos => {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(pos[0], pos[1], pos[2]);
        squareGroup.add(dot);
    });

    qrFloorAnchor.add(squareGroup);
    qrFloorAnchor.add(modelContainer);

    function solve8x8() {
        const n = 8;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) STATIC_M[i][j] = STATIC_A[i][j];
            STATIC_M[i][n] = STATIC_B[i];
        }

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            let maxVal = Math.abs(STATIC_M[i][i]);
            for (let k = i + 1; k < n; k++) {
                const val = Math.abs(STATIC_M[k][i]);
                if (val > maxVal) { maxVal = val; maxRow = k; }
            }
            if (maxVal < 1e-7) return false;

            if (maxRow !== i) {
                const temp = STATIC_M[i];
                STATIC_M[i] = STATIC_M[maxRow];
                STATIC_M[maxRow] = temp;
            }

            const pivotInv = 1.0 / STATIC_M[i][i];
            for (let k = i + 1; k < n; k++) {
                const factor = STATIC_M[k][i] * pivotInv;
                for (let j = i; j <= n; j++) {
                    STATIC_M[k][j] -= factor * STATIC_M[i][j];
                }
            }
        }

        for (let i = n - 1; i >= 0; i--) {
            let sum = STATIC_M[i][n];
            for (let j = i + 1; j < n; j++) {
                sum -= STATIC_M[i][j] * STATIC_X[j];
            }
            STATIC_X[i] = sum / STATIC_M[i][i];
        }
        return true;
    }

    const ptsObjX = [-s, s, s, -s];
    const ptsObjZ = [-s, -s, s, s];

    function snapToGrid(vec3) {
        vec3.x = Math.round(vec3.x / GRID_RESOLUTION) * GRID_RESOLUTION;
        vec3.y = Math.round(vec3.y / GRID_RESOLUTION) * GRID_RESOLUTION;
        vec3.z = Math.round(vec3.z / GRID_RESOLUTION) * GRID_RESOLUTION;
    }

    function snapQuaternionLUT(quat) {
        if (typeof LUT_QUAT_3D !== 'undefined' && typeof LUT_3D_SIZE !== 'undefined') {
            _lutEuler.setFromQuaternion(quat, 'YXZ');
            let idxX = Math.round(_lutEuler.x * RAD_TO_LUT_IDX) % LUT_3D_SIZE;
            let idxY = Math.round(_lutEuler.y * RAD_TO_LUT_IDX) % LUT_3D_SIZE;
            let idxZ = Math.round(_lutEuler.z * RAD_TO_LUT_IDX) % LUT_3D_SIZE;

            if (idxX < 0) idxX += LUT_3D_SIZE;
            if (idxY < 0) idxY += LUT_3D_SIZE;
            if (idxZ < 0) idxZ += LUT_3D_SIZE;

            const iX = idxX << 1, iY = idxY << 1, iZ = idxZ << 1;
            const sx = LUT_QUAT_3D[iX], cx = LUT_QUAT_3D[iX + 1];
            const sy = LUT_QUAT_3D[iY], cy = LUT_QUAT_3D[iY + 1];
            const sz = LUT_QUAT_3D[iZ], cz = LUT_QUAT_3D[iZ + 1];

            quat.x = sx * cy * cz + cx * sy * sz;
            quat.y = cx * sy * cz - sx * cy * sz;
            quat.z = cx * cy * sz - sx * sy * cz;
            quat.w = cx * cy * cz + sx * sy * sz;
        } else {
            quat.x = Math.round(quat.x * 10000) / 10000;
            quat.y = Math.round(quat.y * 10000) / 10000;
            quat.z = Math.round(quat.z * 10000) / 10000;
            quat.w = Math.round(quat.w * 10000) / 10000;
            const sqrMag = quat.x * quat.x + quat.y * quat.y + quat.z * quat.z + quat.w * quat.w;
            const invLen = window.lutFastInvSqrt(sqrMag);
            quat.x *= invLen; quat.y *= invLen; quat.z *= invLen; quat.w *= invLen;
        }
    }

    function processCorners(rawCorners) {
        const sw = window.innerWidth, sh = window.innerHeight;
        const f = window.focalLengthScreen || ((sh / 2) / Math.tan((60 * Math.PI) / 360));

        if (!screenRayLUTs || screenRayLUTs.width !== sw || screenRayLUTs.height !== sh || screenRayLUTs.f !== f) {
            const rays = window.createScreenRayLUTs(sw, sh, f);
            screenRayLUTs = { width: sw, height: sh, f: f, lutU: rays.lutU, lutV: rays.lutV };
        }

        for (let i = 0; i < 4; i++) {
            const X = ptsObjX[i], Z = ptsObjZ[i];
            const px = Math.max(0, Math.min(sw - 1, rawCorners[i].x | 0));
            const py = Math.max(0, Math.min(sh - 1, rawCorners[i].y | 0));
            const u = screenRayLUTs.lutU[px];
            const v = screenRayLUTs.lutV[py];

            const r2i = 2 * i;
            STATIC_A[r2i][0] = X; STATIC_A[r2i][1] = Z; STATIC_A[r2i][2] = 1; 
            STATIC_A[r2i][3] = 0; STATIC_A[r2i][4] = 0; STATIC_A[r2i][5] = 0; 
            STATIC_A[r2i][6] = -u * X; STATIC_A[r2i][7] = -u * Z;
            STATIC_B[r2i] = u;

            const r2i1 = 2 * i + 1;
            STATIC_A[r2i1][0] = 0; STATIC_A[r2i1][1] = 0; STATIC_A[r2i1][2] = 0; 
            STATIC_A[r2i1][3] = X; STATIC_A[r2i1][4] = Z; STATIC_A[r2i1][5] = 1; 
            STATIC_A[r2i1][6] = -v * X; STATIC_A[r2i1][7] = -v * Z;
            STATIC_B[r2i1] = v;
        }

        if (!solve8x8()) { handleWorkerMiss(); return; }

        const h1x = STATIC_X[0], h1y = STATIC_X[3], h1z = -STATIC_X[6];
        const h2x = STATIC_X[1], h2y = STATIC_X[4], h2z = -STATIC_X[7];
        const h3x = STATIC_X[2], h3y = STATIC_X[5], h3z = -1.0;

        const invNorm1 = window.lutFastInvSqrt(h1x * h1x + h1y * h1y + h1z * h1z);
        const invNorm2 = window.lutFastInvSqrt(h2x * h2x + h2y * h2y + h2z * h2z);
        const norm1 = 1.0 / invNorm1;
        const norm2 = 1.0 / invNorm2;
        if (norm1 < 1e-6 || norm2 < 1e-6) { handleWorkerMiss(); return; }

        const lambda = (norm1 + norm2) * 0.5;
        const invLambda = window.lutFastInvSqrt(lambda * lambda);

        rx.set(h1x * invNorm1, h1y * invNorm1, h1z * invNorm1);
        rz.set(h2x * invLambda, h2y * invLambda, h2z * invLambda);

        tempVec.copy(rx).multiplyScalar(rx.dot(rz));
        rz.sub(tempVec);
        rz.multiplyScalar(window.lutFastInvSqrt(rz.lengthSq()));

        ry.crossVectors(rz, rx);
        ry.multiplyScalar(window.lutFastInvSqrt(ry.lengthSq()));

        calculatedPos.set(h3x * invLambda, h3y * invLambda, h3z * invLambda);
        mat4Temp.makeBasis(rx, ry, rz);
        calculatedQuat.setFromRotationMatrix(mat4Temp);

        tempVec.copy(calculatedPos).negate();
        tempVec.multiplyScalar(window.lutFastInvSqrt(tempVec.lengthSq()));
        if (ry.dot(tempVec) < 0) { 
            ry.negate(); 
            rz.negate(); 
            mat4Temp.makeBasis(rx, ry, rz);
            calculatedQuat.setFromRotationMatrix(mat4Temp);
        }

        snapToGrid(calculatedPos);
        snapQuaternionLUT(calculatedQuat);

        if (Math.abs(calculatedPos.x) > HALF_GRID_SIZE || 
            Math.abs(calculatedPos.y) > HALF_GRID_SIZE || 
            Math.abs(calculatedPos.z) > HALF_GRID_SIZE) {
            handleWorkerMiss();
            return;
        }

        mat4Temp.compose(calculatedPos, calculatedQuat, scaleOne);
        invMatrix.copy(mat4Temp).invert();
        invMatrix.decompose(relativePos, relativeQuat, dummyScale);

        snapToGrid(relativePos);
        snapQuaternionLUT(relativeQuat);

        lastSeenTime = performance.now();

        if (!hasEverBeenTracked) {
            qrFloorAnchor.position.copy(calculatedPos);
            qrFloorAnchor.quaternion.copy(calculatedQuat);
            lastRenderedPos.copy(calculatedPos);
            lastRenderedQuat.copy(calculatedQuat);
            targetPos.copy(calculatedPos);
            targetQuat.copy(calculatedQuat);
            hasEverBeenTracked = true;
        } else {
            if (!isTracked) {
                qrFloorAnchor.position.copy(lastRenderedPos);
                qrFloorAnchor.quaternion.copy(lastRenderedQuat);
            }

            const dist = targetPos.distanceTo(calculatedPos);
            if (dist >= 0.0025 || !isTracked) {
                targetPos.copy(calculatedPos);
                targetQuat.copy(calculatedQuat);
            }
        }

        qrFloorAnchor.visible = true; 
        isTracked = true;
    }

    function handleWorkerResult(location, qrData) {
        if (targetQrValue !== "" && qrData !== targetQrValue) {
            handleWorkerMiss();
            return;
        }
        const { renderW, renderH, offsetX, offsetY } = getViewportInfo();

        cornersBuffer[0].x = offsetX + (location.topLeftCorner.x / SCAN_WIDTH) * renderW;
        cornersBuffer[0].y = offsetY + (location.topLeftCorner.y / SCAN_HEIGHT) * renderH;
        cornersBuffer[1].x = offsetX + (location.topRightCorner.x / SCAN_WIDTH) * renderW;
        cornersBuffer[1].y = offsetY + (location.topRightCorner.y / SCAN_HEIGHT) * renderH;
        cornersBuffer[2].x = offsetX + (location.bottomRightCorner.x / SCAN_WIDTH) * renderW;
        cornersBuffer[2].y = offsetY + (location.bottomRightCorner.y / SCAN_HEIGHT) * renderH;
        cornersBuffer[3].x = offsetX + (location.bottomLeftCorner.x / SCAN_WIDTH) * renderW;
        cornersBuffer[3].y = offsetY + (location.bottomLeftCorner.y / SCAN_HEIGHT) * renderH;

        processCorners(cornersBuffer);
    }

    function handleWorkerMiss() { }

    return {
        dispatchFrame: (videoEl) => {
            const now = performance.now();
            if (now - lastDispatchTime < DISPATCH_INTERVAL) return;

            if (!videoEl || videoEl.readyState < videoEl.HAVE_ENOUGH_DATA) return;
            if (idleWorkers.length === 0) return; 

            lastDispatchTime = now;

            const sw = window.innerWidth;
            const vw = videoEl.videoWidth || sw, vh = videoEl.videoHeight || window.innerHeight;

            SCAN_HEIGHT = Math.round((SCAN_WIDTH / vw) * vh);
            if (scanCanvas.width !== SCAN_WIDTH || scanCanvas.height !== SCAN_HEIGHT) { 
                scanCanvas.width = SCAN_WIDTH; 
                scanCanvas.height = SCAN_HEIGHT; 
            }

            scanCtx.drawImage(videoEl, 0, 0, SCAN_WIDTH, SCAN_HEIGHT);
            const imageData = scanCtx.getImageData(0, 0, SCAN_WIDTH, SCAN_HEIGHT);
            
            const worker = idleWorkers.pop();
            frameCounter++;

            worker.postMessage({ 
                id: frameCounter, 
                width: SCAN_WIDTH, 
                height: SCAN_HEIGHT, 
                buffer: imageData.data.buffer 
            }, [imageData.data.buffer]);
        },
        updateRenderPose: () => {
            if (isTracked && hasEverBeenTracked) {
                const now = performance.now();
                if (now - lastSeenTime > PERSISTENCE_MS) {
                    qrFloorAnchor.visible = false;
                    isTracked = false;
                } else {
                    qrFloorAnchor.position.lerp(targetPos, 0.25);

                    let dot = qrFloorAnchor.quaternion.dot(targetQuat);
                    let sign = 1.0;
                    if (dot < 0.0) {
                        dot = -dot;
                        sign = -1.0;
                    }

                    const weights = getFastSlerpWeights(dot);
                    const w0 = weights[0];
                    const w1 = weights[1] * sign;

                    qrFloorAnchor.quaternion.x = qrFloorAnchor.quaternion.x * w0 + targetQuat.x * w1;
                    qrFloorAnchor.quaternion.y = qrFloorAnchor.quaternion.y * w0 + targetQuat.y * w1;
                    qrFloorAnchor.quaternion.z = qrFloorAnchor.quaternion.z * w0 + targetQuat.z * w1;
                    qrFloorAnchor.quaternion.w = qrFloorAnchor.quaternion.w * w0 + targetQuat.w * w1;
                    
                    const q = qrFloorAnchor.quaternion;
                    const invLen = window.lutFastInvSqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
                    q.x *= invLen; q.y *= invLen; q.z *= invLen; q.w *= invLen;

                    lastRenderedPos.copy(qrFloorAnchor.position);
                    lastRenderedQuat.copy(qrFloorAnchor.quaternion);

                    qrFloorAnchor.visible = true;
                }
            }
        }
    };
}
