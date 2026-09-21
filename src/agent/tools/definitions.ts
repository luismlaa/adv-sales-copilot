import type Anthropic from "@anthropic-ai/sdk";

/**
 * Definiciones de herramientas del copiloto.
 *
 * **Toda herramienta lleva `strict: true`** y su esquema lleva
 * `additionalProperties: false` + `required` completo. La fiabilidad de la
 * extraccion se construye con el esquema, no con la capacidad del modelo:
 * con `strict`, la API garantiza que `tool_use.input` valida exactamente
 * contra el esquema, y el codigo no tiene que defenderse de campos inventados.
 *
 * El **orden de este arreglo es estable a proposito**. Las definiciones de
 * herramientas se envian en cada turno y se renderizan antes del system
 * prompt; reordenarlas invalida la cache de todas las conversaciones vivas.
 * Herramienta nueva -> al final. Nunca al medio.
 */

const guardarFicha: Anthropic.Tool = {
  name: "guardar_ficha",
  description:
    "Guarda o actualiza los datos del prospecto apenas los diga. Llamala en cuanto tengas UN dato nuevo; no esperes a tener la ficha completa. Solo manda los campos que la persona dijo en este turno.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      nombre: { type: ["string", "null"], description: "Nombre de la persona" },
      edad: { type: ["integer", "null"], minimum: 18, maximum: 100 },
      uso: {
        type: ["string", "null"],
        enum: ["trabajo", "familiar", "personal", "comercial", "otro", null],
        description: "Para que usara el vehiculo",
      },
      forma_pago: {
        type: ["string", "null"],
        enum: ["contado", "financiamiento", "indeciso", null],
      },
      presupuesto_max: { type: ["number", "null"], minimum: 0 },
      inicial_disponible: {
        type: ["number", "null"],
        minimum: 0,
        description: "Monto de inicial que puede dar, en la moneda del dealer",
      },
      ingreso_mensual: { type: ["number", "null"], minimum: 0 },
      antiguedad_laboral_meses: { type: ["integer", "null"], minimum: 0 },
      tiene_intercambio: { type: ["boolean", "null"] },
      intercambio_descripcion: {
        type: ["string", "null"],
        description: "Marca, modelo y anio del vehiculo que entrega",
      },
      marca_interes: { type: ["string", "null"] },
      modelo_interes: { type: ["string", "null"] },
      anio_interes: { type: ["integer", "null"], minimum: 1950, maximum: 2100 },
      plazo_meses: { type: ["integer", "null"], minimum: 6, maximum: 96 },
      notas: {
        type: ["string", "null"],
        maxLength: 1000,
        description: "Cualquier cosa util que el vendedor deba saber",
      },
    },
    required: [
      "nombre",
      "edad",
      "uso",
      "forma_pago",
      "presupuesto_max",
      "inicial_disponible",
      "ingreso_mensual",
      "antiguedad_laboral_meses",
      "tiene_intercambio",
      "intercambio_descripcion",
      "marca_interes",
      "modelo_interes",
      "anio_interes",
      "plazo_meses",
      "notas",
    ],
    additionalProperties: false,
  },
};

const buscarVehiculos: Anthropic.Tool = {
  name: "buscar_vehiculos",
  description:
    "Busca en el inventario real del dealer. Es la UNICA fuente de precios y disponibilidad: si un vehiculo no sale de aqui, no lo menciones.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      marca: { type: ["string", "null"] },
      modelo: { type: ["string", "null"] },
      precio_max: { type: ["number", "null"], minimum: 0 },
      anio_min: { type: ["integer", "null"], minimum: 1950 },
      limite: { type: "integer", minimum: 1, maximum: 5, description: "Cuantos devolver" },
    },
    required: ["marca", "modelo", "precio_max", "anio_min", "limite"],
    additionalProperties: false,
  },
};

const evaluarPrecalificacion: Anthropic.Tool = {
  name: "evaluar_precalificacion",
  description:
    "Evalua la ficha contra las reglas de financiamiento del dealer y devuelve el semaforo (califica / revisar / no_califica) con el detalle regla por regla. TU NO DECIDES si alguien califica: lo calcula esta herramienta. Llamala cuando la persona diga que quiere financiamiento y ya tengas ingreso, inicial y antiguedad laboral. No es una decision de credito: esa la toma el banco.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      motivo: {
        type: "string",
        maxLength: 200,
        description: "Por que la evaluas ahora (queda en la bitacora del lead)",
      },
    },
    required: ["motivo"],
    additionalProperties: false,
  },
};

const pedirDocumentos: Anthropic.Tool = {
  name: "pedir_documentos",
  description:
    "Marca como pedidos los documentos que faltan en el expediente. La persona los sube como foto por este mismo chat.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      documentos: {
        type: "array",
        minItems: 1,
        items: {
          type: "string",
          enum: ["cedula_frontal", "cedula_dorsal", "carta_trabajo", "estado_cuenta", "licencia"],
        },
      },
    },
    required: ["documentos"],
    additionalProperties: false,
  },
};

const escalarAVendedor: Anthropic.Tool = {
  name: "escalar_a_vendedor",
  description:
    "Pasa la conversacion a una persona del dealer. Usala si la persona lo pide, se molesta, negocia precio, o pregunta algo que no puedes responder con las otras herramientas.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      motivo: {
        type: "string",
        enum: [
          "lo_pidio",
          "molesto",
          "negociacion",
          "fuera_de_alcance",
          "dato_sensible",
          "limite_de_turnos",
        ],
      },
      resumen: {
        type: "string",
        maxLength: 500,
        description: "Resumen de una linea para que el vendedor entre en contexto",
      },
    },
    required: ["motivo", "resumen"],
    additionalProperties: false,
  },
};

/** Orden estable — ver la nota de cache arriba. */
export const TOOLS: readonly Anthropic.Tool[] = [
  guardarFicha,
  buscarVehiculos,
  evaluarPrecalificacion,
  pedirDocumentos,
  escalarAVendedor,
] as const;

export type NombreHerramienta = (typeof TOOLS)[number]["name"];
