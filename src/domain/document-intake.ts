import type { DocumentoRequerido } from "@/schemas/tenant-rules";

/**
 * Atribucion de un adjunto a una casilla del expediente.
 *
 * Como los documentos **no se leen por vision** (solo se almacenan), el sistema
 * no puede saber si la foto que llego es la cedula o la carta de trabajo. La
 * regla que queda es conversacional: el copiloto pide los documentos en orden,
 * asi que el adjunto que llega corresponde al documento pedido mas antiguo que
 * sigue pendiente.
 *
 * Es una heuristica, no una certeza — y por eso el copiloto confirma en voz
 * alta lo que registro, para que el prospecto pueda corregirlo, y el vendedor
 * lo ve en el panel antes de mandar el expediente al banco.
 */

export interface DocumentoPendiente {
  readonly tipo: DocumentoRequerido;
  /** Cuando se pidio. Orden de llegada = orden en que se piden. */
  readonly creadoEn: Date;
}

export type Atribucion =
  | { readonly tipo: DocumentoRequerido; readonly certeza: "por_orden_de_pedido" }
  | { readonly tipo: "otro"; readonly certeza: "sin_clasificar" };

/**
 * Decide a que casilla del expediente entra un adjunto.
 *
 * @param pendientes documentos ya solicitados y todavia sin recibir
 * @returns la casilla a llenar, o `otro` cuando no habia nada pendiente — en
 * ese caso el adjunto queda sin clasificar y lo asigna el vendedor.
 */
export function atribuirDocumento(pendientes: readonly DocumentoPendiente[]): Atribucion {
  if (pendientes.length === 0) {
    return { tipo: "otro", certeza: "sin_clasificar" };
  }

  const masAntiguo = [...pendientes].sort(
    (a, b) => a.creadoEn.getTime() - b.creadoEn.getTime(),
  )[0];

  // `pendientes` no esta vacio, asi que el indice 0 existe.
  return { tipo: masAntiguo!.tipo, certeza: "por_orden_de_pedido" };
}

const NOMBRE_LEGIBLE: Readonly<Record<DocumentoRequerido | "otro", string>> = {
  cedula_frontal: "la cédula por delante",
  cedula_dorsal: "la cédula por detrás",
  carta_trabajo: "la carta de trabajo",
  estado_cuenta: "el estado de cuenta",
  licencia: "la licencia",
  otro: "el documento",
};

/**
 * Marcador que entra al modelo en lugar del adjunto.
 *
 * Nunca lleva el contenido del documento: solo dice que llego y donde se
 * guardo, para que el copiloto confirme y siga. Ningun dato de identidad entra
 * al contexto del modelo.
 */
export function marcadorDeAdjunto(atribucion: Atribucion): string {
  if (atribucion.certeza === "sin_clasificar") {
    return (
      "[El cliente envió un archivo que se guardó en el expediente, pero no había ningún " +
      "documento pendiente. Agradécele y pregúntale de cuál se trata.]"
    );
  }
  return (
    `[El cliente envió un archivo. Se registró como ${NOMBRE_LEGIBLE[atribucion.tipo]}. ` +
    "Confírmaselo en una línea para que pueda corregirte si era otro, y sigue con lo que falte.]"
  );
}
