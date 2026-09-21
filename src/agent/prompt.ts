import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverEnv } from "@/config/env";
import type { TenantRules } from "@/schemas/tenant-rules";

/**
 * Carga y composicion del system prompt.
 *
 * El prompt se parte en dos bloques a proposito, y ese corte es lo que hace
 * que la cache valga:
 *
 *   bloque 1 — cuerpo estable, identico para TODOS los dealers  -> cacheado
 *   bloque 2 — datos del dealer (nombre, horario, documentos)    -> no cacheado
 *
 * La cache de Anthropic es un match de prefijo: cualquier byte que cambie
 * invalida todo lo que viene despues. Si el nombre del dealer estuviera
 * arriba, cada tenant pagaria su propia escritura de cache y no habria
 * reutilizacion entre conversaciones de dealers distintos.
 */

const PROMPTS_DIR = join(process.cwd(), "prompts");

const cacheArchivos = new Map<string, string>();

function leerPrompt(archivo: string): string {
  const version = serverEnv().PROMPT_VERSION;
  const clave = `${version}/${archivo}`;
  const yaLeido = cacheArchivos.get(clave);
  if (yaLeido !== undefined) return yaLeido;

  const contenido = readFileSync(join(PROMPTS_DIR, version, archivo), "utf8").trim();
  cacheArchivos.set(clave, contenido);
  return contenido;
}

export interface DatosDealer {
  readonly nombre: string;
  readonly horario: string;
  readonly direccion: string;
}

/** Cuerpo estable del prompt. Este es el bloque que se cachea. */
export function cuerpoEstable(): string {
  return leerPrompt("qualifier.system.md");
}

/** Bloque por dealer. Va despues del punto de cache; cambia por tenant. */
export function bloqueDealer(dealer: DatosDealer, reglas: TenantRules): string {
  const plantilla = leerPrompt("dealer-block.md");
  const valores: Record<string, string> = {
    DEALER_NOMBRE: dealer.nombre,
    DEALER_HORARIO: dealer.horario,
    DEALER_DIRECCION: dealer.direccion,
    DEALER_MONEDA: reglas.moneda,
    DEALER_DOCUMENTOS: reglas.documentos_requeridos.join(", "),
  };

  const render = plantilla.replace(/\{\{(\w+)\}\}/g, (_original, clave: string) => {
    const valor = valores[clave];
    if (valor === undefined) {
      throw new Error(`Placeholder sin valor en el prompt del dealer: {{${clave}}}`);
    }
    return valor;
  });

  // Un placeholder sin sustituir que llegue al modelo es un bug visible para
  // el cliente final. Preferimos fallar antes de enviar.
  if (render.includes("{{")) {
    throw new Error("Quedaron placeholders sin renderizar en el bloque del dealer");
  }
  return render;
}
