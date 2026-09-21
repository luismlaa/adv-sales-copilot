import { describe, it, expect } from "vitest";
import { importarCsv } from "@/import/vehicles";

/**
 * El dealer sube SU archivo, no una plantilla nuestra. Si la importacion
 * exige un formato exacto, el dealer teclea a mano y abandona: es el punto de
 * falla conocido de esta categoria de producto.
 */
describe("importarCsv", () => {
  it("importa un CSV con encabezados canonicos", () => {
    const csv = [
      "stock_id,marca,modelo,anio,precio,moneda",
      "A-100,Toyota,Corolla,2021,1250000,DOP",
    ].join("\n");

    const { filas, errores } = importarCsv(csv);

    expect(errores).toEqual([]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      stock_id: "A-100",
      marca: "Toyota",
      anio: 2021,
      precio: 1250000,
      disponible: true,
    });
  });

  it("reconoce encabezados en espanol con tildes y sinonimos del dealer", () => {
    const csv = ["Código,Fabricante,Modelo,Año,Precio Venta", "B-7,Honda,CR-V,2022,1800000"].join(
      "\n",
    );

    const { filas, errores } = importarCsv(csv);

    expect(errores).toEqual([]);
    expect(filas[0]).toMatchObject({ stock_id: "B-7", marca: "Honda", anio: 2022 });
  });

  it("limpia el formato de moneda que traen los exports", () => {
    const csv = ["stock_id,marca,modelo,anio,precio", 'C-1,Kia,Sportage,2020,"RD$ 1,450,000.00"'].join(
      "\n",
    );

    expect(importarCsv(csv).filas[0]?.precio).toBe(1450000);
  });

  it("normaliza transmision y disponibilidad escritas a mano", () => {
    const csv = [
      "stock_id,marca,modelo,anio,precio,caja,estatus",
      "D-1,Nissan,Sentra,2019,900000,Automático,Vendido",
    ].join("\n");

    const fila = importarCsv(csv).filas[0];
    expect(fila?.transmision).toBe("automatica");
    expect(fila?.disponible).toBe(false);
  });

  it("una fila mala no tumba el resto y se reporta con su numero de linea", () => {
    const csv = [
      "stock_id,marca,modelo,anio,precio",
      "E-1,Toyota,Yaris,2021,800000",
      ",Toyota,Yaris,2021,800000",
      "E-3,Mazda,CX-5,1800,900000",
    ].join("\n");

    const { filas, errores } = importarCsv(csv);

    expect(filas).toHaveLength(1);
    expect(errores.map((e) => e.linea)).toEqual([3, 4]);
    expect(errores[1]?.campo).toBe("anio");
  });
});
