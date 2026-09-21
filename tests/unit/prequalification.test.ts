import { describe, it, expect } from "vitest";
import { evaluarPrecalificacion, temperaturaDe } from "@/domain/prequalification";
import { parseTenantRules } from "@/schemas/tenant-rules";
import reglasDemo from "../../config/tenants/demo-dealer.json" with { type: "json" };

const reglas = parseTenantRules(reglasDemo);

/**
 * El motor de pre-calificacion es la pieza que el modelo NO decide. Estas
 * pruebas son el contrato: si alguna cae, un dealer esta calificando gente con
 * criterios distintos a los que configuro.
 */
describe("evaluarPrecalificacion", () => {
  const fichaCompleta = {
    edad: 34,
    ingreso_mensual: 80000,
    antiguedad_laboral_meses: 36,
    inicial_disponible: 300000,
    presupuesto_max: 1000000,
    marca_interes: "Toyota",
    anio_interes: 2021,
    plazo_meses: 60,
  } as const;

  it("califica cuando toda regla dura se cumple y no falta ningun dato", () => {
    const r = evaluarPrecalificacion({
      ficha: fichaCompleta,
      reglas,
      documentosRecibidos: ["cedula_frontal", "cedula_dorsal", "carta_trabajo"],
    });

    expect(r.resultado).toBe("califica");
    expect(r.faltantes).toEqual([]);
    expect(r.documentos_pendientes).toEqual([]);
    expect(r.detalle.every((d) => d.cumple)).toBe(true);
  });

  it("no califica si el ingreso queda por debajo del minimo del dealer", () => {
    const r = evaluarPrecalificacion({
      ficha: { ...fichaCompleta, ingreso_mensual: 20000 },
      reglas,
    });

    expect(r.resultado).toBe("no_califica");
    const regla = r.detalle.find((d) => d.regla === "ingreso_minimo_mensual");
    expect(regla?.cumple).toBe(false);
    // El detalle dice POR QUE, no solo que fallo.
    expect(regla?.esperado).toContain("45,000");
  });

  it("no califica si la inicial no llega al porcentaje minimo", () => {
    const r = evaluarPrecalificacion({
      ficha: { ...fichaCompleta, inicial_disponible: 50_000 },
      reglas,
    });

    expect(r.resultado).toBe("no_califica");
    expect(r.detalle.find((d) => d.regla === "inicial_minima_pct")?.recibido).toBe("5.0%");
  });

  it("no califica si la marca no esta en la lista financiable del dealer", () => {
    const r = evaluarPrecalificacion({
      ficha: { ...fichaCompleta, marca_interes: "Ferrari" },
      reglas,
    });

    expect(r.resultado).toBe("no_califica");
    expect(r.detalle.find((d) => d.regla === "marcas_financiables")?.cumple).toBe(false);
  });

  it("financia cualquier marca cuando la lista es ['*']", () => {
    const r = evaluarPrecalificacion({
      ficha: { ...fichaCompleta, marca_interes: "Ferrari" },
      reglas: { ...reglas, marcas_financiables: ["*"] },
    });

    expect(r.detalle.find((d) => d.regla === "marcas_financiables")).toBeUndefined();
    expect(r.resultado).toBe("califica");
  });

  it("manda a revisar (no rechaza) cuando faltan datos de la ficha", () => {
    const r = evaluarPrecalificacion({
      ficha: { marca_interes: "Honda" },
      reglas,
    });

    expect(r.resultado).toBe("revisar");
    expect(r.faltantes).toContain("ingreso_mensual");
    expect(r.faltantes).toContain("inicial_disponible");
  });

  it("degrada a revisar — no a no_califica — cuando la cuota excede el techo de ingreso", () => {
    // Regla blanda: el plazo y la tasa reales los pone el banco, asi que esto
    // lo mira una persona en vez de cerrarle la puerta al prospecto.
    const r = evaluarPrecalificacion({
      ficha: { ...fichaCompleta, plazo_meses: 12, ingreso_mensual: 46000 },
      reglas,
      documentosRecibidos: ["cedula_frontal", "cedula_dorsal", "carta_trabajo"],
    });

    expect(r.resultado).toBe("revisar");
    expect(r.detalle.find((d) => d.regla === "relacion_cuota_ingreso_maxima_pct")?.cumple).toBe(
      false,
    );
  });

  it("lista los documentos que faltan en el expediente", () => {
    const r = evaluarPrecalificacion({
      ficha: fichaCompleta,
      reglas,
      documentosRecibidos: ["cedula_frontal"],
    });

    expect(r.documentos_pendientes).toEqual(["cedula_dorsal", "carta_trabajo"]);
  });

  it("siempre devuelve el aviso de que no es una decision de credito", () => {
    const r = evaluarPrecalificacion({ ficha: {}, reglas });
    expect(r.aviso).toContain("No es una decision de credito");
  });
});

describe("temperaturaDe", () => {
  it("caliente solo con semaforo en verde y expediente completo", () => {
    expect(
      temperaturaDe({
        resultado: "califica",
        detalle: [],
        faltantes: [],
        documentos_pendientes: [],
        aviso:
          "Pre-filtro contra las reglas del dealer. No es una decision de credito; esa la toma el banco.",
      }),
    ).toBe("caliente");
  });

  it("tibio si califica pero el expediente esta incompleto", () => {
    expect(
      temperaturaDe({
        resultado: "califica",
        detalle: [],
        faltantes: [],
        documentos_pendientes: ["carta_trabajo"],
        aviso:
          "Pre-filtro contra las reglas del dealer. No es una decision de credito; esa la toma el banco.",
      }),
    ).toBe("tibio");
  });

  it("frio cuando no califica", () => {
    expect(
      temperaturaDe({
        resultado: "no_califica",
        detalle: [],
        faltantes: [],
        documentos_pendientes: [],
        aviso:
          "Pre-filtro contra las reglas del dealer. No es una decision de credito; esa la toma el banco.",
      }),
    ).toBe("frio");
  });
});
