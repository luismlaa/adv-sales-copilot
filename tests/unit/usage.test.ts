import { describe, it, expect } from "vitest";
import {
  repartirConsumo,
  periodoDe,
  contadorDePlantilla,
  claveIdempotencia,
} from "@/domain/usage";

/**
 * Estos contadores son la factura. Un error aqui no es un bug de analitica:
 * es cobrarle de menos o de mas a un cliente.
 */
describe("repartirConsumo", () => {
  const sinPaquetes = { base: 100, paquetes: [] };

  it("mes sin actividad no consume nada", () => {
    expect(repartirConsumo(0, sinPaquetes)).toEqual({ deBase: 0, dePaquetes: 0, excedente: 0 });
  });

  it("consume primero lo incluido en la base", () => {
    expect(repartirConsumo(60, sinPaquetes)).toEqual({ deBase: 60, dePaquetes: 0, excedente: 0 });
  });

  it("pasa a los paquetes solo cuando la base se agota", () => {
    const cupo = {
      base: 100,
      paquetes: [
        { unidades: 50, consumidas: 0 },
        { unidades: 50, consumidas: 0 },
      ],
    };
    expect(repartirConsumo(130, cupo)).toEqual({ deBase: 100, dePaquetes: 30, excedente: 0 });
  });

  it("consume los paquetes en orden de compra", () => {
    // El primer paquete ya esta medio usado: se termina antes de tocar el segundo.
    const cupo = {
      base: 10,
      paquetes: [
        { unidades: 50, consumidas: 45 },
        { unidades: 50, consumidas: 0 },
      ],
    };
    expect(repartirConsumo(30, cupo)).toEqual({ deBase: 10, dePaquetes: 20, excedente: 0 });
  });

  it("lo que excede base y paquetes queda como excedente facturable", () => {
    const cupo = { base: 10, paquetes: [{ unidades: 10, consumidas: 0 }] };
    expect(repartirConsumo(35, cupo)).toEqual({ deBase: 10, dePaquetes: 10, excedente: 15 });
  });

  it("rechaza un consumo negativo en vez de inventar un credito", () => {
    expect(() => repartirConsumo(-1, sinPaquetes)).toThrow();
  });
});

describe("periodoDe", () => {
  it("usa la zona del dealer, no UTC", () => {
    // 2026-10-01 01:30 UTC es todavia el 30 de septiembre en Santo Domingo
    // (UTC-4). Facturarlo en octubre le movería el mes al dealer.
    const instante = new Date("2026-10-01T01:30:00Z");
    expect(periodoDe(instante, "America/Santo_Domingo")).toBe("2026-09-01");
    expect(periodoDe(instante, "UTC")).toBe("2026-10-01");
  });

  it("normaliza siempre al primer dia del mes", () => {
    expect(periodoDe(new Date("2026-09-17T15:00:00Z"), "America/Santo_Domingo")).toBe("2026-09-01");
  });
});

describe("contadorDePlantilla", () => {
  it("utility cuenta como recordatorio y marketing como reactivacion", () => {
    expect(contadorDePlantilla("utility")).toBe("recordatorios");
    expect(contadorDePlantilla("marketing")).toBe("reactivaciones");
  });
});

describe("claveIdempotencia", () => {
  it("es estable para la misma referencia", () => {
    const a = claveIdempotencia("conversaciones_atendidas", "conv-1");
    const b = claveIdempotencia("conversaciones_atendidas", "conv-1");
    expect(a).toBe(b);
  });

  it("distingue contadores sobre la misma referencia", () => {
    expect(claveIdempotencia("recordatorios", "msg-1")).not.toBe(
      claveIdempotencia("reactivaciones", "msg-1"),
    );
  });

  it("rechaza una referencia vacia: sin clave no hay idempotencia", () => {
    expect(() => claveIdempotencia("recordatorios", "  ")).toThrow();
  });
});
