import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Prueba de humo: el proyecto esta cableado y sus invariantes estructurales
 * se sostienen. Corre sin red, sin base de datos y sin API key.
 */
describe("humo", () => {
  const raiz = process.cwd();

  it("el motor de pre-calificacion carga y evalua", async () => {
    const { evaluarPrecalificacion } = await import("@/domain/prequalification.js");
    const { parseTenantRules } = await import("@/schemas/tenant-rules.js");

    const reglas = parseTenantRules(
      JSON.parse(readFileSync(join(raiz, "config/tenants/demo-dealer.json"), "utf8")),
    );
    const resultado = evaluarPrecalificacion({ ficha: {}, reglas });

    expect(resultado.resultado).toBe("revisar");
    expect(resultado.aviso).toMatch(/decision de credito/);
  });

  it(".env.example documenta toda variable que el cargador exige", () => {
    const ejemplo = readFileSync(join(raiz, ".env.example"), "utf8");
    const cargador = readFileSync(join(raiz, "src/config/env.ts"), "utf8");

    const declaradas = [...cargador.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(declaradas.length).toBeGreaterThan(10);

    for (const variable of declaradas) {
      expect(ejemplo, `${variable} sin documentar en .env.example`).toContain(`${variable}=`);
    }
  });

  it("la migracion inicial pone tenant_id en toda tabla de negocio", () => {
    const sql = readFileSync(join(raiz, "supabase/migrations/0001_init.sql"), "utf8");

    // `tenants` se aisla por su propio id; el resto lleva tenant_id.
    const tablas = [...sql.matchAll(/create table (\w+) \(([\s\S]*?)\n\);/g)];
    expect(tablas.length).toBeGreaterThan(10);

    for (const [, nombre, cuerpo] of tablas) {
      if (nombre === "tenants") continue;
      if (nombre === "tenant_plan") {
        expect(cuerpo).toContain("tenant_id");
        continue;
      }
      expect(cuerpo, `${nombre} sin tenant_id`).toMatch(/tenant_id\s+uuid\s+not null/);
    }
  });

  it("la migracion fuerza RLS, no solo la habilita", () => {
    const sql = readFileSync(join(raiz, "supabase/migrations/0001_init.sql"), "utf8");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("auth_has_tenant");
  });

  it("los contadores de consumo existen desde la primera migracion", () => {
    const sql = readFileSync(join(raiz, "supabase/migrations/0001_init.sql"), "utf8");
    for (const contador of ["conversaciones_atendidas", "recordatorios", "reactivaciones"]) {
      expect(sql, `falta el contador ${contador}`).toContain(contador);
    }
    expect(sql).toContain("create table usage_events");
    expect(sql).toContain("create table usage_counters");
  });

  it("el prompt activo existe y no menciona aprobar credito", () => {
    const version = process.env["PROMPT_VERSION"] ?? "v1";
    const archivos = readdirSync(join(raiz, "prompts", version));
    expect(archivos).toContain("qualifier.system.md");
    expect(archivos).toContain("dealer-block.md");

    const prompt = readFileSync(join(raiz, "prompts", version, "qualifier.system.md"), "utf8");
    expect(prompt).toMatch(/nunca decidas si alguien califica/i);
    expect(prompt).toMatch(/decisión crediticia es del banco/i);
  });

  it("el cuerpo estable del prompt no lleva datos de dealer (rompe la cache)", () => {
    const version = process.env["PROMPT_VERSION"] ?? "v1";
    const prompt = readFileSync(join(raiz, "prompts", version, "qualifier.system.md"), "utf8");
    expect(prompt).not.toContain("{{");
  });
});
