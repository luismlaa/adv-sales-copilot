import { dealerClient } from "@/connectors/supabase-server";
import type { Etapa, Semaforo, Temperatura } from "@/schemas/lead";

export const dynamic = "force-dynamic";

/**
 * Tablero del dealer.
 *
 * Server Component: consulta con la sesion del usuario, asi que **RLS filtra
 * por tenant en el motor**. Este archivo no lleva ni un `.eq("tenant_id", …)`
 * a proposito — si lo necesitara, seria senal de que la politica no esta
 * haciendo su trabajo.
 */

const COLUMNAS: readonly { readonly etapa: Etapa; readonly titulo: string }[] = [
  { etapa: "nuevo", titulo: "Nuevo" },
  { etapa: "calificado", titulo: "Calificado" },
  { etapa: "expediente_completo", titulo: "Expediente completo" },
  { etapa: "test_drive", titulo: "Test drive" },
  { etapa: "negociacion", titulo: "Negociación" },
];

interface FichaVista {
  readonly presupuesto_max?: number;
  readonly forma_pago?: string;
  readonly uso?: string;
  readonly marca_interes?: string;
  readonly modelo_interes?: string;
}

interface LeadVista {
  readonly id: string;
  readonly nombre: string | null;
  readonly etapa: Etapa;
  readonly temperatura: Temperatura;
  readonly ficha: FichaVista;
  readonly qualification_results: readonly { readonly resultado: Semaforo }[];
  readonly lead_documents: readonly { readonly tipo: string; readonly estado: string }[];
}

const ETIQUETA_SEMAFORO: Readonly<Record<Semaforo, string>> = {
  califica: "califica",
  revisar: "revisar",
  no_califica: "no califica",
};

export default async function KanbanPage() {
  const db = await dealerClient();

  const { data, error } = await db
    .from("leads")
    .select(
      "id, nombre, etapa, temperatura, ficha, qualification_results(resultado), lead_documents(tipo, estado)",
    )
    .neq("etapa", "perdido")
    .order("actualizado_en", { ascending: false })
    .limit(300);

  if (error !== null) {
    return (
      <main>
        <h1>Tablero</h1>
        <p className="subtitulo">No se pudo cargar el tablero: {error.message}</p>
      </main>
    );
  }

  const leads = (data ?? []) as unknown as LeadVista[];

  return (
    <main>
      <h1>Tablero de prospectos</h1>
      <p className="subtitulo">
        Ordenado por lo último que se movió. Las tarjetas calientes tienen el expediente completo.
      </p>

      <div className="tablero">
        {COLUMNAS.map((columna) => {
          const enColumna = leads.filter((l) => l.etapa === columna.etapa);
          return (
            <section className="columna" key={columna.etapa}>
              <h2>
                {columna.titulo} ({enColumna.length})
              </h2>
              {enColumna.map((lead) => (
                <TarjetaLead key={lead.id} lead={lead} />
              ))}
            </section>
          );
        })}
      </div>

      <p className="aviso-legal">
        El semáforo es un pre-filtro contra las reglas de financiamiento de este dealer. No es una
        decisión de crédito: esa la toma el banco.
      </p>
    </main>
  );
}

function TarjetaLead({ lead }: { lead: LeadVista }) {
  const semaforo = lead.qualification_results[0]?.resultado;
  const presupuesto =
    lead.ficha.presupuesto_max === undefined
      ? "sin definir"
      : lead.ficha.presupuesto_max.toLocaleString("es-DO");

  return (
    <article className="tarjeta">
      <h3>{lead.nombre ?? "Sin nombre"}</h3>

      <span className={`etiqueta temp-${lead.temperatura}`}>{lead.temperatura}</span>{" "}
      {semaforo !== undefined && (
        <span className={`etiqueta sem-${semaforo}`}>{ETIQUETA_SEMAFORO[semaforo]}</span>
      )}

      <dl>
        <div>
          Interés: {lead.ficha.marca_interes ?? "—"} {lead.ficha.modelo_interes ?? ""}
        </div>
        <div>Presupuesto: {presupuesto}</div>
        <div>Pago: {lead.ficha.forma_pago ?? "—"}</div>
      </dl>

      {lead.lead_documents.length > 0 && (
        <ul className="checklist">
          {lead.lead_documents.map((doc) => (
            <li key={doc.tipo}>
              <span aria-hidden="true">{doc.estado === "recibido" ? "✓" : "○"}</span>
              <span>
                {doc.tipo.replace(/_/g, " ")}
                <span className="visually-hidden">
                  {doc.estado === "recibido" ? " recibido" : " pendiente"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
