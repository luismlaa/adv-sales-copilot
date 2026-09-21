import { z } from "zod";

/**
 * Contrato de las reglas de pre-calificacion de un dealer.
 * Espejo tipado de config/schema/tenant-rules.schema.json — si uno cambia,
 * el otro cambia con el en el mismo commit.
 */

export const documentoRequeridoSchema = z.enum([
  "cedula_frontal",
  "cedula_dorsal",
  "carta_trabajo",
  "estado_cuenta",
  "licencia",
]);

export type DocumentoRequerido = z.infer<typeof documentoRequeridoSchema>;

export const tenantRulesSchema = z
  .object({
    version: z.number().int().min(1),
    moneda: z.enum(["DOP", "USD"]),
    ingreso_minimo_mensual: z.number().min(0),
    inicial_minima_pct: z.number().min(0).max(100),
    antiguedad_laboral_minima_meses: z.number().int().min(0),
    edad_minima: z.number().int().min(18).default(18),
    edad_maxima: z.number().int().max(100).optional(),
    relacion_cuota_ingreso_maxima_pct: z.number().min(0).max(100).optional(),
    marcas_financiables: z.array(z.string().min(1)).min(1),
    anio_minimo_vehiculo: z.number().int().min(1950).optional(),
    acepta_intercambio: z.boolean().default(true),
    documentos_requeridos: z.array(documentoRequeridoSchema).min(1),
    retencion_documentos_dias: z.number().int().min(1).max(365).default(90),
    mensaje_no_califica: z.string().optional(),
  })
  .strict();

export type TenantRules = z.infer<typeof tenantRulesSchema>;

/**
 * Valida un ruleset crudo (de la tabla prequalification_rulesets o de un JSON
 * de config) y devuelve el objeto tipado.
 *
 * @throws ZodError si la configuracion del dealer no cumple el contrato. Un
 * ruleset invalido no debe evaluarse nunca: preferimos no calificar a
 * calificar con reglas rotas.
 */
export function parseTenantRules(raw: unknown): TenantRules {
  return tenantRulesSchema.parse(raw);
}
