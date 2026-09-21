import { describe, it, expect } from "vitest";
import { expiraEn, ventanaAbierta, modoDeSalida } from "@/domain/conversation-window";

/**
 * La ventana de 24h decide si un mensaje es gratis o facturable. Es la regla
 * economica del producto: respondemos, no iniciamos.
 */
describe("ventana de 24 horas", () => {
  const entrante = new Date("2026-09-20T10:00:00Z");

  it("expira exactamente 24 horas despues del mensaje del cliente", () => {
    expect(expiraEn(entrante).toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });

  it("esta abierta antes del corte y cerrada despues", () => {
    const limite = expiraEn(entrante);
    expect(ventanaAbierta(limite, new Date("2026-09-21T09:59:00Z"))).toBe(true);
    expect(ventanaAbierta(limite, new Date("2026-09-21T10:00:01Z"))).toBe(false);
  });

  it("una conversacion sin ventana esta cerrada", () => {
    expect(ventanaAbierta(null, entrante)).toBe(false);
  });

  it("dentro de la ventana toda salida es servicio y no se factura", () => {
    const dentro = new Date("2026-09-20T18:00:00Z");
    for (const intencion of ["respuesta", "recordatorio", "reactivacion"] as const) {
      const modo = modoDeSalida(expiraEn(entrante), dentro, intencion);
      expect(modo).toEqual({ tipo: "servicio", facturable: false });
    }
  });

  it("fuera de la ventana un recordatorio es plantilla utility y se factura", () => {
    const fuera = new Date("2026-09-22T10:00:00Z");
    expect(modoDeSalida(expiraEn(entrante), fuera, "recordatorio")).toEqual({
      tipo: "plantilla",
      facturable: true,
      categoria: "utility",
    });
  });

  it("fuera de la ventana una reactivacion es plantilla marketing", () => {
    const fuera = new Date("2026-09-22T10:00:00Z");
    expect(modoDeSalida(expiraEn(entrante), fuera, "reactivacion")).toEqual({
      tipo: "plantilla",
      facturable: true,
      categoria: "marketing",
    });
  });

  it("una respuesta que llega tarde degrada a utility, nunca sale como servicio", () => {
    const fuera = new Date("2026-09-22T10:00:00Z");
    const modo = modoDeSalida(expiraEn(entrante), fuera, "respuesta");
    expect(modo.facturable).toBe(true);
  });
});
