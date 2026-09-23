---
decision: D-1
titulo: Enmienda H7 — productos pre-build (catalogo multi-tenant) vs builds a medida
estado: pendiente-aprobacion
hardstop: H7
fecha: 2026-09-21
aplica_a:
  - advantio/CLAUDE.md
  - advantio/operacion/HARDSTOPS.md
---

# D-1 · Enmienda H7: pre-build ≠ build a medida

## Decisión de Luis (2026-09-21)

> "Una cosa son las builds personalizadas y otra los productos pre-build, no se rigen bajo las mismas normas."

Los documentos rectores de Advantio se escribieron para **una** línea de negocio: plataforma a medida,
desplegada en el VPS de cada cliente. De ahí sale que H-DATA exija "aislamiento por instancia
(un stack/VPS por cliente)". Un producto de catálogo como Sales Copilot es otra línea: un solo
despliegue sirve a muchos clientes, y el aislamiento lo hace el motor de base de datos, no la
infraestructura. Aplicarle la regla de instancia lo haría inviable como producto. No aplicarle
**ninguna** regla sería peor. La enmienda separa las dos líneas y le da a la pre-build su propia vara,
que no es más laxa: es distinta.

## Qué no cambia

- **H-SEC** aplica a las dos líneas: el build es autónomo, el go-live no.
- **H-PRICE** aplica a las dos líneas.
- **H7** sigue vigente: ante un dato contradictorio se pregunta.
- "Cero cruce de datos entre clientes" sigue siendo la regla. Cambia **cómo se demuestra**.

---

## Cambio 1 · `advantio/CLAUDE.md`, después de "Arquitectura en dos capas"

Agregar la sección:

```markdown
## Dos líneas de producto (enmienda D-1, 2026-09-21)

| | **Build a medida** | **Producto pre-build (catálogo)** |
|---|---|---|
| Qué es | Plataforma construida para la operación diagnosticada de un cliente | Producto único que sirve a muchos clientes del mismo segmento (ej. `adv-sales-copilot`) |
| Despliegue | Una instancia por cliente, en su VPS | Un despliegue multi-tenant; cada cliente es un `tenant` |
| Aislamiento | Por infraestructura (instancia) | Por motor: `tenant_id` + RLS forzada, verificado con prueba de no-cruce |
| Alta de cliente | Build + deploy one-off | Onboarding por configuración, sin build |
| Modelo comercial | Deploy one-off + retainer | Suscripción base + consumo medido |
| Hardstop de datos | **H-DATA** | **H-DATA-PB** |
| Dónde vive | `clientes/{slug}/` sobre `plataforma/` | Repo propio del producto |

Un producto pre-build **no** se personaliza por cliente en código: lo que varía entre clientes
es configuración validada contra esquema. Si un cliente necesita código propio, deja de ser
pre-build para ese cliente y pasa por el flujo a medida.
```

## Cambio 2 · `advantio/operacion/HARDSTOPS.md`, tabla de registro

Cambiar la fila **H-DATA** para acotarla a la línea a medida (primera columna de texto):

```markdown
| **H-DATA** | Configuración de datos del cliente final **en un build a medida** | …(sin cambios)… |
```

Y agregar debajo:

```markdown
| **H-DATA-PB** | Configuración de datos del cliente final **en un producto pre-build multi-tenant** (enmienda D-1) | (1) `tenant_id NOT NULL` + RLS **forzada** en toda tabla de negocio y en `storage.objects`; (2) salida en verde de la prueba de no-cruce entre tenants contra la base real, adjunta; (3) la llave que salta RLS solo en servidor; (4) cifrado en reposo y backups cifrados; (5) retención declarada **con borrado ejecutado**, no solo fechado | stack-architect / security-eng | Se habilita el manejo de datos reales de ese producto |
```

## Cambio 3 · `adv-sales-copilot/CLAUDE.md`

Cuando los cambios 1 y 2 estén aplicados en `advantio`: quitar el bloque "H7 abierto" y reemplazar
la fila H-DATA de la tabla de hardstops por H-DATA-PB.

---

## Consecuencia que conviene tener presente

Dejaste la seguridad para una **etapa 2**. Con esta enmienda, H-DATA-PB exige S-1 (RLS en Storage),
S-2 (prueba de no-cruce corrida) y S-3 (borrado por retención). Por lo tanto, la etapa 2 va
**antes del primer dealer con datos reales**, no después. La demo con datos ficticios sí puede
avanzar sin ella.
