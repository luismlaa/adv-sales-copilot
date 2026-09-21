# Historial de prompts

Un prompt nunca se edita en sitio: se crea `vN+1/` y se cambia `PROMPT_VERSION`.
Editar `v1` en silencio rompe la comparabilidad entre corridas y, peor, invalida
la caché de prompt de todas las conversaciones vivas.

> **Por qué no hay symlink `current/`:** el repo se trabaja en Windows, donde
> los symlinks exigen permisos especiales y se rompen al clonar. La versión
> activa la selecciona la variable de entorno `PROMPT_VERSION`, que lee
> `src/agent/prompt.ts`.

## v1 — 2026-09-20

Primera versión del prompt del calificador.

**Qué contiene:** rol, lista explícita de lo que PUEDE y NO PUEDE hacer, orden
de preguntas, tono (español dominicano, una pregunta por mensaje) y el manejo de
los tres resultados del semáforo.

**Por qué así:** dos reglas del brief están escritas en el prompt *y* además
forzadas en código, porque una sola capa no alcanza:

1. El modelo no decide si un prospecto califica — lo calcula
   `evaluar_precalificacion` contra las reglas del dealer (`src/domain/prequalification.ts`).
2. El sistema nunca emite una decisión de crédito. Eso es del banco, y va
   explícito tanto aquí como en el aviso que devuelve la herramienta.

**Placeholders:** `{{DEALER_NOMBRE}}`, `{{DEALER_HORARIO}}`, `{{DEALER_DIRECCION}}`.
Se rellenan por tenant en tiempo de ejecución. Van al **final** del prompt a
propósito: todo lo que varía por dealer va después del último punto de caché,
para que el cuerpo del prompt (lo caro) se reutilice entre tenants.
