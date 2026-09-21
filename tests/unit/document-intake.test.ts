import { describe, it, expect } from "vitest";
import { atribuirDocumento, marcadorDeAdjunto } from "@/domain/document-intake";

/**
 * Como los documentos no se leen por vision, la atribucion es una heuristica
 * conversacional: el adjunto llena la casilla pedida mas antigua. Estas pruebas
 * fijan esa regla y, sobre todo, fijan que el marcador que entra al modelo
 * NUNCA lleve contenido del documento.
 */
describe("atribuirDocumento", () => {
  it("atribuye al documento pedido mas antiguo que sigue pendiente", () => {
    const atribucion = atribuirDocumento([
      { tipo: "carta_trabajo", creadoEn: new Date("2026-09-20T12:00:00Z") },
      { tipo: "cedula_frontal", creadoEn: new Date("2026-09-20T10:00:00Z") },
      { tipo: "cedula_dorsal", creadoEn: new Date("2026-09-20T11:00:00Z") },
    ]);

    expect(atribucion).toEqual({ tipo: "cedula_frontal", certeza: "por_orden_de_pedido" });
  });

  it("no depende del orden en que la base devuelva las filas", () => {
    const pedidos = [
      { tipo: "cedula_dorsal" as const, creadoEn: new Date("2026-09-20T11:00:00Z") },
      { tipo: "cedula_frontal" as const, creadoEn: new Date("2026-09-20T10:00:00Z") },
    ];
    expect(atribuirDocumento(pedidos).tipo).toBe("cedula_frontal");
    expect(atribuirDocumento([...pedidos].reverse()).tipo).toBe("cedula_frontal");
  });

  it("queda sin clasificar cuando no habia nada pendiente", () => {
    expect(atribuirDocumento([])).toEqual({ tipo: "otro", certeza: "sin_clasificar" });
  });
});

describe("marcadorDeAdjunto", () => {
  it("le dice al copiloto que confirme lo que registro, para poder corregirlo", () => {
    const marcador = marcadorDeAdjunto({
      tipo: "carta_trabajo",
      certeza: "por_orden_de_pedido",
    });

    expect(marcador).toContain("la carta de trabajo");
    expect(marcador).toMatch(/confírmaselo/i);
  });

  it("pide aclarar cuando el adjunto no calza en ninguna casilla", () => {
    const marcador = marcadorDeAdjunto({ tipo: "otro", certeza: "sin_clasificar" });
    expect(marcador).toMatch(/de cuál se trata/i);
  });

  it("nunca contiene contenido del documento: solo describe que llego", () => {
    // El contrato de privacidad del producto: ningun dato de identidad entra
    // al contexto del modelo mientras no se lea por vision.
    for (const marcador of [
      marcadorDeAdjunto({ tipo: "cedula_frontal", certeza: "por_orden_de_pedido" }),
      marcadorDeAdjunto({ tipo: "otro", certeza: "sin_clasificar" }),
    ]) {
      expect(marcador.startsWith("[")).toBe(true);
      expect(marcador.endsWith("]")).toBe(true);
      expect(marcador).not.toMatch(/\d{3}-\d{7}-\d/); // formato de cedula dominicana
      expect(marcador).not.toMatch(/base64|http/i);
    }
  });
});
