/**
 * Ventana de servicio de 24 horas de WhatsApp.
 *
 * Meta no cobra las respuestas dentro de la ventana que abre un mensaje del
 * cliente; si cobra todo lo que iniciamos nosotros. De ahi el principio de
 * diseno del producto: **el flujo responde, no inicia, siempre que se pueda.**
 *
 * Este modulo es la unica autoridad sobre si una salida es gratis (mensaje de
 * servicio) o facturable (plantilla). Nadie manda un mensaje sin consultarlo.
 */

const VENTANA_MS = 24 * 60 * 60 * 1000;

export type ModoSalida =
  | { readonly tipo: "servicio"; readonly facturable: false }
  | {
      readonly tipo: "plantilla";
      readonly facturable: true;
      readonly categoria: "utility" | "marketing";
    };

/** Instante en que expira la ventana abierta por un mensaje entrante. */
export function expiraEn(ultimoEntrante: Date): Date {
  return new Date(ultimoEntrante.getTime() + VENTANA_MS);
}

/** True si a `ahora` todavia se puede responder gratis. */
export function ventanaAbierta(ventanaExpiraEn: Date | null, ahora: Date): boolean {
  return ventanaExpiraEn !== null && ventanaExpiraEn.getTime() > ahora.getTime();
}

/**
 * Decide como sale un mensaje.
 *
 * Dentro de la ventana, siempre mensaje de servicio: gratis y sin plantilla.
 * Fuera de ella hace falta una plantilla aprobada, y esa si se factura — como
 * recordatorio (utility) o como reactivacion (marketing).
 */
export function modoDeSalida(
  ventanaExpiraEn: Date | null,
  ahora: Date,
  intencion: "respuesta" | "recordatorio" | "reactivacion",
): ModoSalida {
  if (ventanaAbierta(ventanaExpiraEn, ahora)) {
    return { tipo: "servicio", facturable: false };
  }
  if (intencion === "respuesta") {
    // La ventana cerro mientras preparabamos la respuesta. Degradar a
    // recordatorio es la unica salida valida, y ya cuesta.
    return { tipo: "plantilla", facturable: true, categoria: "utility" };
  }
  return {
    tipo: "plantilla",
    facturable: true,
    categoria: intencion === "recordatorio" ? "utility" : "marketing",
  };
}
