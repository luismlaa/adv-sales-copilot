import { NextResponse } from "next/server";
import { dealerClient } from "../../../../connectors/supabase-server.js";
import { importarCsv, importarExcel } from "../../../../import/vehicles.js";
import { logAccion, logger } from "../../../../lib/logger.js";

export const runtime = "nodejs";

/**
 * Importacion de inventario por CSV/Excel.
 *
 * Usa el cliente **con sesion del dealer**, no la service role key: asi la RLS
 * de Postgres impide que un dealer escriba en el inventario de otro aunque la
 * aplicacion tuviera un bug de tenancy. El aislamiento lo hace el motor.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const archivo = form.get("archivo");

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }

  const db = await dealerClient();

  const { data: sesion } = await db.auth.getUser();
  if (sesion.user === null) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: membresia } = await db
    .from("tenant_members")
    .select("tenant_id, rol")
    .eq("user_id", sesion.user.id)
    .in("rol", ["owner", "vendedor"])
    .maybeSingle();

  if (membresia === null || membresia === undefined) {
    return NextResponse.json({ error: "Sin permiso para importar" }, { status: 403 });
  }
  const tenantId: string = membresia.tenant_id;

  const esExcel = archivo.name.toLowerCase().endsWith(".xlsx");
  const resultado = esExcel
    ? await importarExcel(await archivo.arrayBuffer())
    : importarCsv(await archivo.text());

  const { data: lote, error: errLote } = await db
    .from("import_batches")
    .insert({
      tenant_id: tenantId,
      tipo: "vehiculos",
      archivo: archivo.name,
      filas_ok: resultado.filas.length,
      filas_error: resultado.errores.length,
      errores: resultado.errores,
      creado_por: sesion.user.id,
    })
    .select("id")
    .single();
  if (errLote !== null) {
    logger.error({ error: errLote }, "No se pudo registrar el lote de importacion");
    return NextResponse.json({ error: "No se pudo registrar la importacion" }, { status: 500 });
  }

  if (resultado.filas.length > 0) {
    // stock_id es la clave natural: re-subir el mismo archivo actualiza,
    // nunca duplica.
    const { error } = await db.from("vehicles").upsert(
      resultado.filas.map((f) => ({
        ...f,
        tenant_id: tenantId,
        import_id: lote.id,
        actualizado_en: new Date().toISOString(),
      })),
      { onConflict: "tenant_id,stock_id" },
    );
    if (error !== null) {
      logger.error({ error }, "Fallo el upsert de vehiculos");
      return NextResponse.json({ error: "No se pudo guardar el inventario" }, { status: 500 });
    }
  }

  logAccion({
    tenantId,
    actor: "dealer",
    accion: "inventario_importado",
    entidad: "import_batch",
    entidadId: lote.id,
    motivo: `El dealer subio ${archivo.name}`,
    metadata: { ok: resultado.filas.length, errores: resultado.errores.length },
  });

  return NextResponse.json({
    import_id: lote.id,
    importados: resultado.filas.length,
    errores: resultado.errores,
  });
}
