import pino from "pino";

/**
 * Bitacora estructurada con contexto de negocio.
 *
 * Un log util dice *quien*, *sobre que entidad* y *por que* — no solo el
 * codigo HTTP. Cuando un lead se marca `no_califica`, el log debe permitir
 * reconstruir con que datos y contra que ruleset se decidio.
 */

const nivel = process.env["LOG_LEVEL"] ?? "info";

export const logger = pino({
  level: nivel,
  // El telefono del prospecto y los punteros a documentos de identidad no van
  // a los logs: son datos de terceros en base compartida.
  redact: {
    paths: [
      "telefono",
      "*.telefono",
      "*.*.telefono",
      "storage_path",
      "*.storage_path",
      "ANTHROPIC_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
    ],
    censor: "[redactado]",
  },
});

export interface ContextoNegocio {
  readonly tenantId: string;
  readonly actor: "copiloto" | "sistema" | "dealer";
  readonly accion: string;
  readonly entidad: string;
  readonly entidadId?: string | undefined;
  /** Por que se tomo la accion. Obligatorio: es lo que hace auditable el log. */
  readonly motivo: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

/** Registra una accion de negocio. Todo efecto sobre un lead pasa por aqui. */
export function logAccion(ctx: ContextoNegocio): void {
  logger.info(
    {
      tenant_id: ctx.tenantId,
      actor: ctx.actor,
      entidad: ctx.entidad,
      entidad_id: ctx.entidadId,
      motivo: ctx.motivo,
      ...ctx.metadata,
    },
    ctx.accion,
  );
}
