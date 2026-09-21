import type { SupabaseClient } from "@supabase/supabase-js";
import type { PuertosCopiloto } from "@/agent/run-turn";
import type { TenantRules } from "@/schemas/tenant-rules";
import { fichaProspectoSchema, type FichaProspecto } from "@/schemas/lead";
import { evaluarPrecalificacion, temperaturaDe } from "@/domain/prequalification";
import { asegurarTenant } from "@/connectors/supabase";
import { logAccion } from "@/lib/logger";

/**
 * Implementacion de los puertos del copiloto contra Supabase.
 *
 * Aqui esta la frontera de confianza: el modelo elige *que* herramienta
 * llamar; lo que la herramienta *hace* lo decide este codigo. En particular,
 * `evaluarPrecalificacion` no le pasa nada al modelo — lee la ficha guardada,
 * la evalua con el motor determinista y devuelve el veredicto ya cerrado.
 */

export interface ContextoLead {
  readonly tenantId: string;
  readonly leadId: string;
  readonly reglas: TenantRules;
  readonly rulesetId: string;
}

export function crearPuertos(db: SupabaseClient, ctx: ContextoLead): PuertosCopiloto {
  const tenantId = asegurarTenant(ctx.tenantId);

  async function leerFicha(): Promise<FichaProspecto> {
    const { data, error } = await db
      .from("leads")
      .select("ficha")
      .eq("tenant_id", tenantId)
      .eq("id", ctx.leadId)
      .single();
    if (error !== null) throw new Error(`No se pudo leer la ficha: ${error.message}`);
    return fichaProspectoSchema.parse(data.ficha ?? {});
  }

  return {
    async guardarFicha(datos) {
      // El modelo manda `null` en los campos que no aplican a este turno
      // (el esquema strict los exige todos). Nulos no pisan lo ya sabido.
      const limpios = Object.fromEntries(
        Object.entries(datos).filter(([, v]) => v !== null && v !== undefined),
      );
      const actual = await leerFicha();
      const fusionada = fichaProspectoSchema.parse({ ...actual, ...limpios });

      const { error } = await db
        .from("leads")
        .update({ ficha: fusionada, actualizado_en: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", ctx.leadId);
      if (error !== null) throw new Error(`No se pudo guardar la ficha: ${error.message}`);

      logAccion({
        tenantId,
        actor: "copiloto",
        accion: "ficha_actualizada",
        entidad: "lead",
        entidadId: ctx.leadId,
        motivo: "El prospecto aporto datos nuevos en la conversacion",
        metadata: { campos: Object.keys(limpios) },
      });
      return { ok: true };
    },

    async buscarVehiculos(filtro) {
      const limite = Math.min(Number(filtro["limite"] ?? 3), 5);
      let query = db
        .from("vehicles")
        .select("stock_id, marca, modelo, anio, version, precio, moneda, kilometraje, transmision")
        .eq("tenant_id", tenantId)
        .eq("disponible", true)
        .limit(limite);

      const marca = filtro["marca"];
      if (typeof marca === "string" && marca !== "") query = query.ilike("marca", `%${marca}%`);

      const modelo = filtro["modelo"];
      if (typeof modelo === "string" && modelo !== "") query = query.ilike("modelo", `%${modelo}%`);

      const precioMax = filtro["precio_max"];
      if (typeof precioMax === "number") query = query.lte("precio", precioMax);

      const anioMin = filtro["anio_min"];
      if (typeof anioMin === "number") query = query.gte("anio", anioMin);

      const { data, error } = await query.order("precio", { ascending: true });
      if (error !== null) throw new Error(`Busqueda de inventario fallo: ${error.message}`);
      return data ?? [];
    },

    async evaluarPrecalificacion(motivo) {
      const ficha = await leerFicha();

      const { data: docs } = await db
        .from("lead_documents")
        .select("tipo")
        .eq("tenant_id", tenantId)
        .eq("lead_id", ctx.leadId)
        .eq("estado", "recibido");

      const recibidos = (docs ?? []).map((d) => d.tipo as never);

      // El veredicto sale del motor determinista, no del modelo.
      const resultado = evaluarPrecalificacion({
        ficha,
        reglas: ctx.reglas,
        documentosRecibidos: recibidos,
      });

      await db.from("qualification_results").insert({
        tenant_id: tenantId,
        lead_id: ctx.leadId,
        ruleset_id: ctx.rulesetId,
        resultado: resultado.resultado,
        detalle: resultado.detalle,
        faltantes: resultado.faltantes,
      });

      const temperatura = temperaturaDe(resultado);
      await db
        .from("leads")
        .update({
          temperatura,
          etapa: resultado.resultado === "califica" ? "calificado" : undefined,
          actualizado_en: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", ctx.leadId);

      logAccion({
        tenantId,
        actor: "copiloto",
        accion: "precalificacion_evaluada",
        entidad: "lead",
        entidadId: ctx.leadId,
        motivo,
        metadata: {
          resultado: resultado.resultado,
          reglas_incumplidas: resultado.detalle.filter((d) => !d.cumple).map((d) => d.regla),
          faltantes: resultado.faltantes,
          ruleset_id: ctx.rulesetId,
        },
      });

      return resultado;
    },

    async pedirDocumentos(documentos) {
      const retenerHasta = new Date();
      retenerHasta.setDate(retenerHasta.getDate() + ctx.reglas.retencion_documentos_dias);

      const filas = documentos.map((tipo) => ({
        tenant_id: tenantId,
        lead_id: ctx.leadId,
        tipo,
        estado: "pendiente" as const,
        retener_hasta: retenerHasta.toISOString().slice(0, 10),
      }));

      const { error } = await db
        .from("lead_documents")
        .upsert(filas, { onConflict: "tenant_id,lead_id,tipo", ignoreDuplicates: true });
      if (error !== null) throw new Error(`No se pudieron marcar documentos: ${error.message}`);

      logAccion({
        tenantId,
        actor: "copiloto",
        accion: "documentos_solicitados",
        entidad: "lead",
        entidadId: ctx.leadId,
        motivo: "El expediente necesita estos documentos para pasar al vendedor",
        metadata: { documentos },
      });
      return { ok: true };
    },

    async escalarAVendedor(motivo, resumen) {
      const { error } = await db
        .from("conversations")
        .update({ estado: "escalada" })
        .eq("tenant_id", tenantId)
        .eq("lead_id", ctx.leadId)
        .eq("estado", "abierta");
      if (error !== null) throw new Error(`No se pudo escalar: ${error.message}`);

      logAccion({
        tenantId,
        actor: "copiloto",
        accion: "escalado_a_vendedor",
        entidad: "lead",
        entidadId: ctx.leadId,
        motivo: `${motivo}: ${resumen}`,
      });
      return { ok: true };
    },
  };
}
