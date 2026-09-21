import { z } from "zod";
import { documentoRequeridoSchema } from "./tenant-rules";

/**
 * Ficha del prospecto: lo que el copiloto extrae de la conversacion.
 *
 * Todo campo es opcional porque la ficha se llena por turnos — el copiloto
 * pregunta lo justo y guarda lo que ya tiene. La completitud la juzga
 * `camposFaltantes`, no el esquema.
 */

export const usoVehiculoSchema = z.enum([
  "trabajo",
  "familiar",
  "personal",
  "comercial",
  "otro",
]);

export const formaPagoSchema = z.enum(["contado", "financiamiento", "indeciso"]);

export const fichaProspectoSchema = z
  .object({
    nombre: z.string().min(2).optional(),
    edad: z.number().int().min(18).max(100).optional(),
    uso: usoVehiculoSchema.optional(),
    forma_pago: formaPagoSchema.optional(),
    presupuesto_max: z.number().min(0).optional(),
    moneda_presupuesto: z.enum(["DOP", "USD"]).optional(),
    inicial_disponible: z.number().min(0).optional(),
    ingreso_mensual: z.number().min(0).optional(),
    antiguedad_laboral_meses: z.number().int().min(0).optional(),
    tiene_intercambio: z.boolean().optional(),
    intercambio_descripcion: z.string().optional(),
    marca_interes: z.string().optional(),
    modelo_interes: z.string().optional(),
    anio_interes: z.number().int().min(1950).max(2100).optional(),
    plazo_meses: z.number().int().min(6).max(96).optional(),
    notas: z.string().max(1000).optional(),
  })
  .strict();

export type FichaProspecto = z.infer<typeof fichaProspectoSchema>;

export const temperaturaSchema = z.enum(["frio", "tibio", "caliente"]);
export type Temperatura = z.infer<typeof temperaturaSchema>;

export const etapaSchema = z.enum([
  "nuevo",
  "calificado",
  "expediente_completo",
  "test_drive",
  "negociacion",
  "perdido",
]);
export type Etapa = z.infer<typeof etapaSchema>;

export const semaforoSchema = z.enum(["califica", "revisar", "no_califica"]);
export type Semaforo = z.infer<typeof semaforoSchema>;

/** Veredicto de una sola regla, con el por que explicito. */
export const reglaEvaluadaSchema = z.object({
  regla: z.string(),
  cumple: z.boolean(),
  esperado: z.string(),
  recibido: z.string(),
});
export type ReglaEvaluada = z.infer<typeof reglaEvaluadaSchema>;

export const resultadoPrecalificacionSchema = z.object({
  resultado: semaforoSchema,
  detalle: z.array(reglaEvaluadaSchema),
  /** Datos de la ficha que faltan para poder emitir un veredicto firme. */
  faltantes: z.array(z.string()),
  /** Documentos que el expediente todavia no tiene. */
  documentos_pendientes: z.array(documentoRequeridoSchema),
  /**
   * Recordatorio legal, no decorativo: el sistema pre-filtra y arma el
   * expediente. La decision crediticia es del banco.
   */
  aviso: z.literal(
    "Pre-filtro contra las reglas del dealer. No es una decision de credito; esa la toma el banco.",
  ),
});
export type ResultadoPrecalificacion = z.infer<typeof resultadoPrecalificacionSchema>;
