import type { TenantRules, DocumentoRequerido } from "@/schemas/tenant-rules";
import type {
  FichaProspecto,
  ReglaEvaluada,
  ResultadoPrecalificacion,
  Semaforo,
} from "@/schemas/lead";

/**
 * Motor determinista de pre-calificacion.
 *
 * Regla rectora del producto: **el modelo nunca decide si un prospecto
 * califica**. Este modulo — codigo puro, sin red, sin LLM, sin estado — es el
 * unico lugar donde se emite el semaforo. El copiloto solo lo invoca como
 * herramienta y transmite el resultado.
 *
 * Y el semaforo no es una decision de credito: el sistema pre-filtra contra
 * las reglas del dealer y arma el expediente. Quien decide es el banco.
 */

const AVISO =
  "Pre-filtro contra las reglas del dealer. No es una decision de credito; esa la toma el banco." as const;

/** Precio del vehiculo de interes, si ya se conoce. */
export interface ContextoVehiculo {
  readonly precio: number;
  readonly moneda: "DOP" | "USD";
  readonly marca: string;
  readonly anio: number;
}

export interface EntradaPrecalificacion {
  readonly ficha: FichaProspecto;
  readonly reglas: TenantRules;
  readonly vehiculo?: ContextoVehiculo | undefined;
  /** Documentos ya recibidos en el expediente. */
  readonly documentosRecibidos?: readonly DocumentoRequerido[] | undefined;
}

function regla(
  nombre: string,
  cumple: boolean,
  esperado: string,
  recibido: string,
): ReglaEvaluada {
  return { regla: nombre, cumple, esperado, recibido };
}

function money(valor: number, moneda: string): string {
  return `${valor.toLocaleString("es-DO", { maximumFractionDigits: 0 })} ${moneda}`;
}

/** Cuota mensual estimada, linea recta sin interes: es un pre-filtro, no una cotizacion. */
function cuotaEstimada(montoFinanciado: number, plazoMeses: number): number {
  return montoFinanciado / plazoMeses;
}

/**
 * Evalua la ficha del prospecto contra las reglas del dealer.
 *
 * Devuelve siempre los tres ejes: el semaforo, el detalle regla por regla
 * (para que el vendedor vea *por que*) y lo que falta para poder decidir.
 *
 * Semantica del semaforo:
 *  - `no_califica` — alguna regla dura se incumple con datos completos.
 *  - `revisar`     — faltan datos, o una regla blanda (relacion cuota/ingreso)
 *                    quedo fuera de rango. Lo mira una persona.
 *  - `califica`    — toda regla dura se cumple y no falta ningun dato.
 */
export function evaluarPrecalificacion(
  entrada: EntradaPrecalificacion,
): ResultadoPrecalificacion {
  const { ficha, reglas, vehiculo } = entrada;
  const detalle: ReglaEvaluada[] = [];
  const faltantes: string[] = [];

  // ── Ingreso mensual ──────────────────────────────────────────────────────
  if (ficha.ingreso_mensual === undefined) {
    faltantes.push("ingreso_mensual");
  } else {
    detalle.push(
      regla(
        "ingreso_minimo_mensual",
        ficha.ingreso_mensual >= reglas.ingreso_minimo_mensual,
        `>= ${money(reglas.ingreso_minimo_mensual, reglas.moneda)}`,
        money(ficha.ingreso_mensual, reglas.moneda),
      ),
    );
  }

  // ── Antiguedad laboral ───────────────────────────────────────────────────
  if (ficha.antiguedad_laboral_meses === undefined) {
    faltantes.push("antiguedad_laboral_meses");
  } else {
    detalle.push(
      regla(
        "antiguedad_laboral_minima_meses",
        ficha.antiguedad_laboral_meses >= reglas.antiguedad_laboral_minima_meses,
        `>= ${reglas.antiguedad_laboral_minima_meses} meses`,
        `${ficha.antiguedad_laboral_meses} meses`,
      ),
    );
  }

  // ── Edad ─────────────────────────────────────────────────────────────────
  if (ficha.edad === undefined) {
    faltantes.push("edad");
  } else {
    const dentroDeRango =
      ficha.edad >= reglas.edad_minima &&
      (reglas.edad_maxima === undefined || ficha.edad <= reglas.edad_maxima);
    const techo = reglas.edad_maxima === undefined ? "sin techo" : `${reglas.edad_maxima}`;
    detalle.push(
      regla("edad", dentroDeRango, `${reglas.edad_minima} a ${techo}`, `${ficha.edad}`),
    );
  }

  // ── Marca financiable ────────────────────────────────────────────────────
  const marca = vehiculo?.marca ?? ficha.marca_interes;
  const todaMarca = reglas.marcas_financiables.includes("*");
  if (marca === undefined) {
    faltantes.push("marca_interes");
  } else if (!todaMarca) {
    const financiable = reglas.marcas_financiables.some(
      (m) => m.toLowerCase() === marca.toLowerCase(),
    );
    detalle.push(
      regla(
        "marcas_financiables",
        financiable,
        reglas.marcas_financiables.join(", "),
        marca,
      ),
    );
  }

  // ── Anio minimo del vehiculo ─────────────────────────────────────────────
  const anio = vehiculo?.anio ?? ficha.anio_interes;
  if (reglas.anio_minimo_vehiculo !== undefined) {
    if (anio === undefined) {
      faltantes.push("anio_interes");
    } else {
      detalle.push(
        regla(
          "anio_minimo_vehiculo",
          anio >= reglas.anio_minimo_vehiculo,
          `>= ${reglas.anio_minimo_vehiculo}`,
          `${anio}`,
        ),
      );
    }
  }

  // ── Inicial minima ───────────────────────────────────────────────────────
  // Se mide contra el precio del vehiculo cuando lo hay; si no, contra el
  // presupuesto declarado. Sin ninguno de los dos, es un dato faltante.
  const precioReferencia = vehiculo?.precio ?? ficha.presupuesto_max;
  if (ficha.inicial_disponible === undefined) {
    faltantes.push("inicial_disponible");
  } else if (precioReferencia === undefined) {
    faltantes.push("presupuesto_max");
  } else if (precioReferencia > 0) {
    const pct = (ficha.inicial_disponible / precioReferencia) * 100;
    detalle.push(
      regla(
        "inicial_minima_pct",
        pct >= reglas.inicial_minima_pct,
        `>= ${reglas.inicial_minima_pct}%`,
        `${pct.toFixed(1)}%`,
      ),
    );
  }

  // ── Intercambio ──────────────────────────────────────────────────────────
  if (ficha.tiene_intercambio === true && !reglas.acepta_intercambio) {
    detalle.push(
      regla("acepta_intercambio", false, "el dealer no recibe intercambio", "trae intercambio"),
    );
  }

  // ── Relacion cuota / ingreso (regla blanda: degrada a revisar) ───────────
  let excedeCuota = false;
  if (
    reglas.relacion_cuota_ingreso_maxima_pct !== undefined &&
    precioReferencia !== undefined &&
    ficha.inicial_disponible !== undefined &&
    ficha.ingreso_mensual !== undefined &&
    ficha.ingreso_mensual > 0
  ) {
    const plazo = ficha.plazo_meses ?? 60;
    const financiado = Math.max(precioReferencia - ficha.inicial_disponible, 0);
    const pct = (cuotaEstimada(financiado, plazo) / ficha.ingreso_mensual) * 100;
    const cumple = pct <= reglas.relacion_cuota_ingreso_maxima_pct;
    excedeCuota = !cumple;
    detalle.push(
      regla(
        "relacion_cuota_ingreso_maxima_pct",
        cumple,
        `<= ${reglas.relacion_cuota_ingreso_maxima_pct}% del ingreso (plazo ${plazo}m)`,
        `${pct.toFixed(1)}%`,
      ),
    );
  }

  // ── Documentos del expediente ────────────────────────────────────────────
  const recibidos = new Set(entrada.documentosRecibidos ?? []);
  const documentosPendientes = reglas.documentos_requeridos.filter((d) => !recibidos.has(d));

  // ── Semaforo ─────────────────────────────────────────────────────────────
  // Las reglas duras son todas menos la relacion cuota/ingreso: esa solo baja
  // a revisar, porque el plazo y la tasa reales los pone el banco.
  const incumpleDura = detalle.some(
    (d) => !d.cumple && d.regla !== "relacion_cuota_ingreso_maxima_pct",
  );

  let resultado: Semaforo;
  if (incumpleDura) {
    resultado = "no_califica";
  } else if (faltantes.length > 0 || excedeCuota) {
    resultado = "revisar";
  } else {
    resultado = "califica";
  }

  return {
    resultado,
    detalle,
    faltantes,
    documentos_pendientes: documentosPendientes,
    aviso: AVISO,
  };
}

/**
 * Temperatura del lead a partir del veredicto y de lo completo del expediente.
 * Es lo que ordena el Kanban: el vendedor abre primero lo caliente.
 */
export function temperaturaDe(
  resultado: ResultadoPrecalificacion,
): "frio" | "tibio" | "caliente" {
  if (resultado.resultado === "no_califica") return "frio";
  if (resultado.resultado === "califica" && resultado.documentos_pendientes.length === 0) {
    return "caliente";
  }
  return "tibio";
}
