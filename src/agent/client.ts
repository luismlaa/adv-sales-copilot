import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/config/env";

/**
 * Cliente de Anthropic.
 *
 * Modelo: `claude-haiku-4-5` por decision del brief — el trabajo es extraccion
 * y tool calling, no juicio.
 *
 * **Prohibida la cascada Haiku -> Sonnet.** Las caches son model-scoped: una
 * cascada pierde la reutilizacion de cache, que vale ~30% de la entrada. Si
 * Haiku no alcanza en algun flujo, la via es `claude-sonnet-5` a
 * `effort: low`, medido contra conversaciones reales antes de cambiar.
 */

let cliente: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cliente !== null) return cliente;
  cliente = new Anthropic({
    apiKey: serverEnv().ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 60_000,
  });
  return cliente;
}

export function modelo(): string {
  return serverEnv().COPILOT_MODEL;
}

/** Tokens de salida por turno: un mensaje de WhatsApp, no un ensayo. */
export const MAX_TOKENS_TURNO = 1024;

export interface UsoTokens {
  readonly entrada: number;
  readonly salida: number;
  readonly cacheEscrita: number;
  readonly cacheLeida: number;
}

export function usoDe(usage: Anthropic.Usage): UsoTokens {
  return {
    entrada: usage.input_tokens,
    salida: usage.output_tokens,
    cacheEscrita: usage.cache_creation_input_tokens ?? 0,
    cacheLeida: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Tasa de acierto de cache del turno.
 *
 * Si esto da 0 en turnos consecutivos de la misma conversacion, hay un
 * invalidador silencioso: un timestamp en el prompt, el orden de las
 * herramientas cambiado, o el bloque del dealer colado antes del punto de
 * cache. Vale la pena vigilarlo: es el ahorro mas grande disponible.
 */
export function tasaCache(uso: UsoTokens): number {
  const total = uso.entrada + uso.cacheLeida + uso.cacheEscrita;
  return total === 0 ? 0 : uso.cacheLeida / total;
}
