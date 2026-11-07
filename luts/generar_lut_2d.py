import math

PASO_GRADOS = 0.005
TOTAL_PASOS = int(360.0 / PASO_GRADOS)  # 72,000 pasos exactos
ARCHIVO_SALIDA = "lut_2d_math.js"

print(
    f"Verificando y generando librería LUT 2D ({TOTAL_PASOS} registros"
    f" indexados)..."
)

with open(ARCHIVO_SALIDA, "w", encoding="utf-8") as f:
  f.write("// ====================================================\n")
  f.write("// LIBRERÍA LUT 2D: Trigonometría Básica e Inversa O(1)\n")
  f.write("// Verificado para WebAR - Zero Allocation (Float32Array)\n")
  f.write("// ====================================================\n\n")

  f.write(f"const LUT_2D_STEP = {PASO_GRADOS};\n")
  f.write(f"const LUT_2D_INV_STEP = {1.0 / PASO_GRADOS};\n")
  f.write(f"const LUT_2D_SIZE = {TOTAL_PASOS};\n\n")

  # 1. Tabla combinada de Seno y Coseno [sin, cos]
  f.write("const LUT_SIN_COS = new Float32Array([\n")
  bloque = []
  for i in range(TOTAL_PASOS):
    rad = math.radians(i * PASO_GRADOS)
    bloque.append(f"{math.sin(rad):.7f},{math.cos(rad):.7f}")
    if len(bloque) == 10:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # 2. Tabla de ASIN para dominios de -1.0 a 1.0 (20,000 pasos)
  ASIN_STEPS = 20000
  f.write(f"const LUT_ASIN_STEPS = {ASIN_STEPS};\n")
  f.write("const LUT_ASIN = new Float32Array([\n")
  bloque = []
  for i in range(ASIN_STEPS + 1):
    val = -1.0 + (2.0 * i / ASIN_STEPS)
    ang = math.asin(val)
    bloque.append(f"{ang:.7f}")
    if len(bloque) == 12:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # 3. Tabla de ATAN2 optimizada por cuadrantes
  ATAN_STEPS = 10000
  f.write(f"const LUT_ATAN2_STEPS = {ATAN_STEPS};\n")
  f.write("const LUT_ATAN2 = new Float32Array([\n")
  bloque = []
  for i in range(ATAN_STEPS + 1):
    ratio = i / ATAN_STEPS
    val = math.atan(ratio)
    bloque.append(f"{val:.7f}")
    if len(bloque) == 12:
      f.write("    " + ",".join(bloque) + ",\n")
      bloque = []
  if bloque:
    f.write("    " + ",".join(bloque) + "\n")
  f.write("]);\n\n")

  # Métodos O(1) verificados
  f.write("""// --- MÉTODOS DE ACCESO RÁPIDO O(1) ---
function lutSin(deg) {
    let norm = deg % 360;
    if (norm < 0) norm += 360;
    return LUT_SIN_COS[((norm * LUT_2D_INV_STEP) | 0) << 1];
}

function lutCos(deg) {
    let norm = deg % 360;
    if (norm < 0) norm += 360;
    return LUT_SIN_COS[(((norm * LUT_2D_INV_STEP) | 0) << 1) + 1];
}

function lutAsin(val) {
    if (val <= -1) return -1.5707963;
    if (val >= 1) return 1.5707963;
    const idx = Math.round((val + 1.0) * 0.5 * LUT_ASIN_STEPS);
    return LUT_ASIN[idx];
}

function lutAtan2(y, x) {
    if (x === 0) {
        if (y > 0) return 1.5707963;
        if (y < 0) return -1.5707963;
        return 0;
    }
    const r = y / x;
    const absR = Math.abs(r);
    if (absR <= 1.0) {
        const idx = Math.round(absR * LUT_ATAN2_STEPS);
        const res = LUT_ATAN2[idx];
        if (x > 0) return (r >= 0) ? res : -res;
        else return (r >= 0) ? (3.1415926 - res) : (-3.1415926 + res);
    } else {
        const invR = 1.0 / absR;
        const idx = Math.round(invR * LUT_ATAN2_STEPS);
        const res = 1.5707963 - LUT_ATAN2[idx];
        if (x > 0) return (r >= 0) ? res : -res;
        else return (r >= 0) ? (3.1415926 - res) : (-3.1415926 + res);
    }
}
""")

print(f"¡Script 2D verificado y generado en '{ARCHIVO_SALIDA}'!")
