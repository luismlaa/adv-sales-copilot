import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, modelo, usoDe, MAX_TOKENS_TURNO, type UsoTokens } from "./client.js";
import { TOOLS } from "./tools/definitions.js";
import { cuerpoEstable, bloqueDealer, type DatosDealer } from "./prompt.js";
import type { TenantRules } from "../schemas/tenant-rules.js";
import type { ResultadoPrecalificacion } from "../schemas/lead.js";
import { logger } from "../lib/logger.js";

/**
 * Un turno de conversacion: entra lo que escribio la persona, sale lo que hay
 * que responderle.
 *
 * El bucle de herramientas vive aqui, no en el modelo: cada `tool_use` se
 * despacha a un puerto — una funcion que el llamador inyecta — y el resultado
 * vuelve como `tool_result`. Asi el turno se puede probar entero sin red y sin
 * base de datos.
 */

/** Puertos: lo que el turno necesita del mundo exterior. */
export interface PuertosCopiloto {
  guardarFicha(datos: Record<string, unknown>): Promise<{ ok: true }>;
  buscarVehiculos(filtro: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  evaluarPrecalificacion(motivo: string): Promise<ResultadoPrecalificacion>;
  pedirDocumentos(documentos: readonly string[]): Promise<{ ok: true }>;
  escalarAVendedor(motivo: string, resumen: string): Promise<{ ok: true }>;
}

export interface ContextoTurno {
  readonly dealer: DatosDealer;
  readonly reglas: TenantRules;
  readonly historial: readonly Anthropic.MessageParam[];
  readonly mensajeEntrante: string;
  /** Tope duro de iteraciones del bucle de herramientas dentro de UN turno. */
  readonly maxIteraciones?: number | undefined;
}

export interface ResultadoTurno {
  readonly respuesta: string;
  readonly mensajes: readonly Anthropic.MessageParam[];
  readonly herramientasUsadas: readonly string[];
  readonly escalado: boolean;
  readonly uso: UsoTokens;
}

/**
 * Herramientas con punto de cache en la ultima.
 *
 * Las definiciones se renderizan ANTES del system prompt y se reenvian en cada
 * turno: son el bloque mas repetido de toda la aplicacion. Un solo breakpoint
 * al final del arreglo cachea todas.
 */
function toolsCacheadas(): Anthropic.Tool[] {
  return TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : { ...t },
  );
}

/**
 * System prompt en dos bloques: el cuerpo estable (cacheado, identico para
 * todos los dealers) y el bloque del dealer (volatil, despues del breakpoint).
 */
function systemCacheado(
  dealer: DatosDealer,
  reglas: TenantRules,
): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: cuerpoEstable(), cache_control: { type: "ephemeral" } },
    { type: "text", text: bloqueDealer(dealer, reglas) },
  ];
}

function sumarUso(a: UsoTokens, b: UsoTokens): UsoTokens {
  return {
    entrada: a.entrada + b.entrada,
    salida: a.salida + b.salida,
    cacheEscrita: a.cacheEscrita + b.cacheEscrita,
    cacheLeida: a.cacheLeida + b.cacheLeida,
  };
}

async function ejecutarHerramienta(
  bloque: Anthropic.ToolUseBlock,
  puertos: PuertosCopiloto,
): Promise<{ contenido: string; esError: boolean; escalo: boolean }> {
  // `strict: true` garantiza que input valida contra el esquema; aun asi
  // tratamos el resultado como dato, no como verdad: el modelo elige QUE
  // herramienta llamar, nunca que decide la herramienta.
  const input = bloque.input as Record<string, unknown>;

  try {
    switch (bloque.name) {
      case "guardar_ficha": {
        await puertos.guardarFicha(input);
        return { contenido: JSON.stringify({ ok: true }), esError: false, escalo: false };
      }
      case "buscar_vehiculos": {
        const vehiculos = await puertos.buscarVehiculos(input);
        return {
          contenido: JSON.stringify({ vehiculos, total: vehiculos.length }),
          esError: false,
          escalo: false,
        };
      }
      case "evaluar_precalificacion": {
        const resultado = await puertos.evaluarPrecalificacion(String(input["motivo"] ?? ""));
        return { contenido: JSON.stringify(resultado), esError: false, escalo: false };
      }
      case "pedir_documentos": {
        const docs = (input["documentos"] ?? []) as string[];
        await puertos.pedirDocumentos(docs);
        return { contenido: JSON.stringify({ ok: true }), esError: false, escalo: false };
      }
      case "escalar_a_vendedor": {
        await puertos.escalarAVendedor(
          String(input["motivo"] ?? ""),
          String(input["resumen"] ?? ""),
        );
        return { contenido: JSON.stringify({ ok: true }), esError: false, escalo: true };
      }
      default:
        return {
          contenido: `Herramienta desconocida: ${bloque.name}`,
          esError: true,
          escalo: false,
        };
    }
  } catch (error) {
    logger.error({ herramienta: bloque.name, error }, "Fallo la ejecucion de una herramienta");
    return {
      contenido: "La herramienta fallo. Dile a la persona que un vendedor le escribe en breve.",
      esError: true,
      escalo: false,
    };
  }
}

function textoDe(mensaje: Anthropic.Message): string {
  return mensaje.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Ejecuta un turno completo, incluyendo el ida y vuelta de herramientas.
 *
 * @returns la respuesta al prospecto y el historial actualizado, listo para
 * persistir y para el turno siguiente.
 */
export async function correrTurno(
  ctx: ContextoTurno,
  puertos: PuertosCopiloto,
): Promise<ResultadoTurno> {
  const maxIteraciones = ctx.maxIteraciones ?? 6;
  const client = anthropic();

  const mensajes: Anthropic.MessageParam[] = [
    ...ctx.historial,
    { role: "user", content: ctx.mensajeEntrante },
  ];

  const herramientasUsadas: string[] = [];
  let escalado = false;
  let uso: UsoTokens = { entrada: 0, salida: 0, cacheEscrita: 0, cacheLeida: 0 };

  for (let iteracion = 0; iteracion < maxIteraciones; iteracion += 1) {
    const respuesta = await client.messages.create({
      model: modelo(),
      max_tokens: MAX_TOKENS_TURNO,
      system: systemCacheado(ctx.dealer, ctx.reglas),
      tools: toolsCacheadas(),
      messages: mensajes,
    });

    uso = sumarUso(uso, usoDe(respuesta.usage));
    mensajes.push({ role: "assistant", content: respuesta.content });

    if (respuesta.stop_reason !== "tool_use") {
      return {
        respuesta: textoDe(respuesta),
        mensajes,
        herramientasUsadas,
        escalado,
        uso,
      };
    }

    const llamadas = respuesta.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Las llamadas paralelas se ejecutan juntas y TODOS los resultados vuelven
    // en un solo mensaje de usuario. Partirlos entre mensajes ensena al modelo
    // a dejar de paralelizar.
    const resultados = await Promise.all(
      llamadas.map(async (llamada) => {
        herramientasUsadas.push(llamada.name);
        const r = await ejecutarHerramienta(llamada, puertos);
        if (r.escalo) escalado = true;
        const bloque: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: llamada.id,
          content: r.contenido,
          is_error: r.esError,
        };
        return bloque;
      }),
    );

    mensajes.push({ role: "user", content: resultados });
  }

  // Se agoto el presupuesto de iteraciones: no seguimos gastando turnos de API.
  // Cierra una persona.
  await puertos.escalarAVendedor(
    "limite_de_turnos",
    "El copiloto agoto las iteraciones de herramientas en un turno.",
  );

  return {
    respuesta:
      "Dejame consultarlo con un compañero y te escribo en un momento.",
    mensajes,
    herramientasUsadas,
    escalado: true,
    uso,
  };
}
