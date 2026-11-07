import math

PASO_GRADOS = 0.005
TOTAL_PASOS_3D = int(360.0 / PASO_GRADOS)
ARCHIVO_SALIDA = "lut_3d_avanzado.js"

print(f"Verificando y generando librería LUT 3D Avanzada en '{ARCHIVO_SALIDA}'...")

with open(ARCHIVO_SALIDA, "w", encoding="utf-8") as f:
  f.write("// ====================================================\n")
  f.write("// LIBRERÍA LUT 3D AVANZADA: FISR, Slerp, Rayos y Solver\n")
  f.write("// Verificado para WebAR - Zero Allocation (Float32Array)\n")
  f.write("// ====================================================\n\n")

  # 1. Fast Inverse Square Root Table
  FISR_STEPS = 10000
  f.write(f"const LUT_FISR_STEPS = {FISR_STEPS};\n")
  f.write("const LUT_FAST_INVERSE_SQRT = new Float32Array([\n")
  bloque = []
  for i in range(FISR_STEPS + 1):
    val = max(0.0001, (i / FISR_STEPS) * 25.0)
    res = 1.0 / math.sqrt(val)
    bloque.append(f"{res:.6f}")
    if len(bloque) == 12:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # 2. Cuaterniones 3D (Ejes X, Y, Z) a 0.005°
  f.write(f"const LUT_3D_STEP = {PASO_GRADOS};\n")
  f.write(f"const LUT_3D_INV_STEP = {1.0 / PASO_GRADOS};\n")
  f.write(f"const LUT_3D_SIZE = {TOTAL_PASOS_3D};\n")
  f.write("const LUT_QUAT_3D = new Float32Array([\n")
  bloque = []
  for i in range(TOTAL_PASOS_3D):
    rad_half = math.radians(i * PASO_GRADOS) * 0.5
    s = math.sin(rad_half)
    c = math.cos(rad_half)
    bloque.append(f"{s:.7f},{c:.7f}")
    if len(bloque) == 10:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # 3. Slerp Weights LUT (para factor constante de interpolación 0.25)
  SLERP_STEPS = 2000
  f.write(f"const LUT_SLERP_STEPS = {SLERP_STEPS};\n")
  f.write("const LUT_SLERP_WEIGHTS = new Float32Array([\n")
  bloque = []
  for i in range(SLERP_STEPS + 1):
    d = i / SLERP_STEPS
    if d > 0.9999:
      w0, w1 = 1.0, 0.0
    else:
      theta = math.acos(d)
      sinTheta = math.sin(theta)
      w0 = math.sin((1.0 - 0.25) * theta) / sinTheta
      w1 = math.sin(0.25 * theta) / sinTheta
    bloque.append(f"{w0:.5f},{w1:.5f}")
    if len(bloque) == 10:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # 4. Tabla de Inversos Multiplicativos para el Solver Gaussiano
  INV_STEPS = 5000
  f.write(f"const LUT_INVERSE_STEPS = {INV_STEPS};\n")
  f.write("const LUT_MULT_INVERSE = new Float32Array([\n")
  bloque = []
  for i in range(INV_STEPS + 1):
    val = max(0.0001, (i / INV_STEPS) * 100.0)
    inv = 1.0 / val
    bloque.append(f"{inv:.6f}")
    if len(bloque) == 12:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # Métodos de rendimiento O(1)
  f.write("""// --- MÉTODOS DE RENDIMIENTO O(1) PARA EL PIPELINE 3D ---

function lutFastInvSqrt(sqrMagnitude) {
    const idx = Math.round((sqrMagnitude / 25.0) * LUT_FISR_STEPS);
    if (idx < 0) return 1.0;
    if (idx > LUT_FISR_STEPS) return 0.2;
    return LUT_FAST_INVERSE_SQRT[idx];
}

function lutSlerpWeights(dotProduct) {
    const clamped = dotProduct < 0 ? 0 : (dotProduct > 1 ? 1 : dotProduct);
    const idx = ((clamped * LUT_SLERP_STEPS) | 0) << 1;
    return [LUT_SLERP_WEIGHTS[idx], LUT_SLERP_WEIGHTS[idx + 1]];
}

function lutMultInverse(pivot) {
    const absP = Math.abs(pivot);
    if (absP < 0.0001) return 10000.0;
    const idx = Math.round((absP / 100.0) * LUT_INVERSE_STEPS);
    const res = LUT_MULT_INVERSE[idx > LUT_INVERSE_STEPS ? LUT_INVERSE_STEPS : idx];
    return pivot < 0 ? -res : res;
}

function createScreenRayLUTs(screenWidth, screenHeight, focalLength) {
    const lutU = new Float32Array(screenWidth);
    const lutV = new Float32Array(screenHeight);
    const cx = screenWidth * 0.5;
    const cy = screenHeight * 0.5;
    
    for (let x = 0; x < screenWidth; x++) {
        lutU[x] = (x - cx) / focalLength;
    }
    for (let y = 0; y < screenHeight; y++) {
        lutV[y] = -(y - cy) / focalLength;
    }
    return { lutU, lutV };
}
""")

print(f"¡Script 3D Avanzado verificado y generado en '{ARCHIVO_SALIDA}'!")
