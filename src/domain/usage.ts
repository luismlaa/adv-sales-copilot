import { z } from "zod";

/**
 * Medicion de consumo. **Esto es la factura, no analitica.**
 *
 * Tres contadores por tenant y por mes:
 *  - conversaciones_atendidas — conversacion de calificacion completada
 *  - recordatorios            — plantilla *utility* saliente que iniciamos
 *  - reactivaciones           — plantilla *marketing* saliente que iniciamos
 *
 * Regla de consumo: primero lo incluido en la base del plan, luego los
 * paquetes comprados en orden de compra. Mes sin actividad = solo la base.
 */

export const contadorSchema = z.enum([
  "conversaciones_atendidas",
  "recordatorios",
  "reactivaciones",
]);
export type Contador = z.infer<typeof contadorSchema>;

/** Categoria de plantilla de Meta -> contador facturable que le corresponde. */
export function contadorDePlantilla(categoria: "utility" | "marketing"): Contador {
  return categoria === "utility" ? "recordatorios" : "reactivaciones";
}

/**
 * Periodo de facturacion (primer dia del mes) en la zona horaria del dealer.
 * Se calcula en la zona del tenant, no en UTC: un mensaje del 31 a las 9 pm
 * en Santo Domingo pertenece a ese mes, no al siguiente.
 */
export function periodoDe(fecha: Date, zonaHoraria: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = fmt.formatToParts(fecha);
  const anio = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  if (anio === undefined || mes === undefined) {
    throw new Error(`Zona horaria invalida para facturacion: ${zonaHoraria}`);
  }
  return `${anio}-${mes}-01`;
}

export interface CupoDisponible {
  readonly base: number;
  readonly paquetes: readonly { readonly unidades: number; readonly consumidas: number }[];
}

export interface DesgloseConsumo {
  /** Unidades cubiertas por la base incluida en el plan. */
  readonly deBase: number;
  /** Unidades cubiertas por paquetes comprados, en orden de compra. */
  readonly dePaquetes: number;
  /** Unidades que exceden base y paquetes: se facturan aparte. */
  readonly excedente: number;
}

/**
 * Reparte el consumo del mes entre base, paquetes y excedente.
 *
 * Funcion pura sobre el estado que se le pasa: no lee ni escribe base de
 * datos, para que la regla de cobro sea testeable sin infraestructura.
 *
 * @param consumoDelMes total del contador en el periodo
 * @param cupo base del plan + paquetes ya ordenados por fecha de compra
 */
export function repartirConsumo(
  consumoDelMes: number,
  cupo: CupoDisponible,
): DesgloseConsumo {
  if (consumoDelMes < 0) {
    throw new Error("El consumo del mes no puede ser negativo");
  }

  const deBase = Math.min(consumoDelMes, cupo.base);
  let pendiente = consumoDelMes - deBase;
  let dePaquetes = 0;

  for (const paquete of cupo.paquetes) {
    if (pendiente === 0) break;
    const restante = Math.max(paquete.unidades - paquete.consumidas, 0);
    const toma = Math.min(pendiente, restante);
    dePaquetes += toma;
    pendiente -= toma;
  }

  return { deBase, dePaquetes, excedente: pendiente };
}

/**
 * Clave de idempotencia de un evento facturable.
 *
 * Meta reintenta los webhooks y las plantillas se pueden reenviar: sin una
 * clave estable, un reintento factura dos veces. Para conversaciones la clave
 * es el id de conversacion (se contabiliza una sola vez, al completarse);
 * para plantillas salientes, el id de mensaje que devuelve Meta.
 */
export function claveIdempotencia(contador: Contador, referencia: string): string {
  if (referencia.trim() === "") {
    throw new Error(`Referencia vacia para el contador ${contador}`);
  }
  return `${contador}:${referencia}`;
}
