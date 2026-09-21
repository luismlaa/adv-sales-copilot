import Papa from "papaparse";
import ExcelJS from "exceljs";
import { z } from "zod";

/**
 * Importacion de inventario por CSV/Excel.
 *
 * Esta pieza existe desde el dia uno por una razon medida: si el dealer tiene
 * que teclear su base a mano, abandona en la segunda semana. Es el punto de
 * falla conocido de esta categoria de producto.
 *
 * Tres decisiones de diseno que salen de eso:
 *  1. Los encabezados se normalizan con sinonimos — el dealer sube SU archivo,
 *     no una plantilla nuestra.
 *  2. Una fila mala no tumba la importacion: se reporta con numero de linea y
 *     el resto entra.
 *  3. `stock_id` es la clave natural, asi que re-subir el mismo archivo
 *     actualiza en vez de duplicar (idempotencia).
 */

const filaVehiculoSchema = z.object({
  stock_id: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  anio: z.coerce.number().int().min(1950).max(2100),
  version: z.string().optional(),
  precio: z.coerce.number().min(0),
  moneda: z.enum(["DOP", "USD"]).default("DOP"),
  kilometraje: z.coerce.number().int().min(0).optional(),
  transmision: z.enum(["automatica", "manual"]).optional(),
  combustible: z.enum(["gasolina", "gasoil", "hibrido", "electrico", "glp"]).optional(),
  disponible: z.coerce.boolean().default(true),
});

export type FilaVehiculo = z.infer<typeof filaVehiculoSchema>;

export interface ErrorFila {
  readonly linea: number;
  readonly campo: string;
  readonly problema: string;
}

export interface ResultadoImportacion {
  readonly filas: readonly FilaVehiculo[];
  readonly errores: readonly ErrorFila[];
}

/**
 * Sinonimos de encabezado.
 *
 * Los dealers exportan de sistemas distintos y en espanol con y sin tildes.
 * Cada entrada aqui es una llamada de soporte que no ocurre.
 */
const SINONIMOS: Readonly<Record<string, string>> = {
  stock: "stock_id",
  "stock id": "stock_id",
  codigo: "stock_id",
  "codigo interno": "stock_id",
  id: "stock_id",
  referencia: "stock_id",
  marca: "marca",
  fabricante: "marca",
  modelo: "modelo",
  ano: "anio",
  anio: "anio",
  year: "anio",
  version: "version",
  trim: "version",
  precio: "precio",
  "precio venta": "precio",
  valor: "precio",
  moneda: "moneda",
  km: "kilometraje",
  kms: "kilometraje",
  kilometraje: "kilometraje",
  millaje: "kilometraje",
  transmision: "transmision",
  caja: "transmision",
  combustible: "combustible",
  motor: "combustible",
  disponible: "disponible",
  activo: "disponible",
  estatus: "disponible",
};

/** Quita tildes, colapsa espacios y pasa a minuscula. */
function normalizar(encabezado: string): string {
  return encabezado
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
}

function mapearEncabezado(encabezado: string): string {
  const limpio = normalizar(encabezado);
  return SINONIMOS[limpio] ?? limpio.replace(/ /g, "_");
}

/** Normaliza valores textuales que los dealers escriben de mil formas. */
function normalizarValores(fila: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...fila };

  const transmision = salida["transmision"];
  if (typeof transmision === "string") {
    const t = normalizar(transmision);
    salida["transmision"] = t.startsWith("a") ? "automatica" : t.startsWith("m") ? "manual" : undefined;
  }

  const disponible = salida["disponible"];
  if (typeof disponible === "string") {
    const d = normalizar(disponible);
    salida["disponible"] = !["no", "0", "false", "vendido", "inactivo"].includes(d);
  }

  const precio = salida["precio"];
  if (typeof precio === "string") {
    // "RD$ 1,250,000.00" -> 1250000
    salida["precio"] = precio.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  }

  for (const clave of Object.keys(salida)) {
    if (salida[clave] === "" || salida[clave] === null) delete salida[clave];
  }
  return salida;
}

function validarFilas(crudas: readonly Record<string, unknown>[]): ResultadoImportacion {
  const filas: FilaVehiculo[] = [];
  const errores: ErrorFila[] = [];

  crudas.forEach((cruda, i) => {
    // +2: la linea 1 son los encabezados y el humano cuenta desde 1.
    const linea = i + 2;
    const parsed = filaVehiculoSchema.safeParse(normalizarValores(cruda));
    if (parsed.success) {
      filas.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) {
      errores.push({
        linea,
        campo: issue.path.join(".") || "(fila)",
        problema: issue.message,
      });
    }
  });

  return { filas, errores };
}

/** Importa un CSV. Detecta el delimitador solo (coma o punto y coma). */
export function importarCsv(contenido: string): ResultadoImportacion {
  const parsed = Papa.parse<Record<string, unknown>>(contenido, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: mapearEncabezado,
  });
  return validarFilas(parsed.data);
}

/** Importa la primera hoja de un .xlsx. */
export async function importarExcel(buffer: ArrayBuffer): Promise<ResultadoImportacion> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const hoja = wb.worksheets[0];
  if (hoja === undefined) {
    return { filas: [], errores: [{ linea: 0, campo: "(archivo)", problema: "El libro no tiene hojas" }] };
  }

  const encabezados: string[] = [];
  const filaEncabezado = hoja.getRow(1);
  filaEncabezado.eachCell({ includeEmpty: true }, (celda, col) => {
    encabezados[col - 1] = mapearEncabezado(String(celda.value ?? ""));
  });

  const crudas: Record<string, unknown>[] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    if (numero === 1) return;
    const registro: Record<string, unknown> = {};
    fila.eachCell({ includeEmpty: true }, (celda, col) => {
      const clave = encabezados[col - 1];
      if (clave === undefined || clave === "") return;
      const valor = celda.value;
      registro[clave] =
        valor !== null && typeof valor === "object" && "result" in valor
          ? (valor as { result: unknown }).result
          : valor;
    });
    crudas.push(registro);
  });

  return validarFilas(crudas);
}
