import { describe, it, expect } from "vitest";
import { TOOLS } from "@/agent/tools/definitions.js";

/**
 * Invariantes de las definiciones de herramientas.
 *
 * Regla del brief: la fiabilidad de la extraccion se construye con el esquema,
 * no con la capacidad del modelo. Estas pruebas evitan que una herramienta
 * nueva entre sin `strict`, o que alguien reordene el arreglo y tumbe la
 * cache de todas las conversaciones vivas.
 */
describe("contratos de herramientas", () => {
  it("toda herramienta declara strict: true", () => {
    for (const tool of TOOLS) {
      expect(tool.strict, `${tool.name} sin strict`).toBe(true);
    }
  });

  it("todo esquema cierra additionalProperties", () => {
    for (const tool of TOOLS) {
      expect(
        tool.input_schema.additionalProperties,
        `${tool.name} admite propiedades extra`,
      ).toBe(false);
    }
  });

  it("todo esquema exige explicitamente cada propiedad que declara", () => {
    // Con structured outputs, un campo opcional se modela como `["tipo","null"]`
    // y va en `required`. Dejarlo fuera de `required` reintroduce la
    // ambiguedad que strict venia a eliminar.
    for (const tool of TOOLS) {
      const propiedades = Object.keys(tool.input_schema.properties ?? {});
      const requeridos = (tool.input_schema["required"] ?? []) as string[];
      expect(new Set(requeridos), `${tool.name}`).toEqual(new Set(propiedades));
    }
  });

  it("toda herramienta tiene descripcion util para el modelo", () => {
    for (const tool of TOOLS) {
      expect((tool.description ?? "").length, `${tool.name}`).toBeGreaterThan(40);
    }
  });

  it("el orden de las herramientas es estable (la cache depende de el)", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "guardar_ficha",
      "buscar_vehiculos",
      "evaluar_precalificacion",
      "pedir_documentos",
      "escalar_a_vendedor",
    ]);
  });

  it("evaluar_precalificacion le recuerda al modelo que no decide credito", () => {
    const descripcion = TOOLS.find((t) => t.name === "evaluar_precalificacion")?.description ?? "";
    expect(descripcion.toLowerCase()).toContain("tu no decides");
    expect(descripcion.toLowerCase()).toContain("banco");
  });
});
