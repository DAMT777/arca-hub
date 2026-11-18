# ARCA · Casos de prueba de punta a punta

Los 25 casos recorren el camino principal, los caminos alternativos y las excepciones de C10, C3 y G3 con el sistema completo en marcha: arca-servicios con su base `arca_negocio` y arca-bpm-engine con su base `arca_camunda`.

El script [`pruebas/casos.mjs`](../pruebas/casos.mjs) hace en cada caso lo mismo que una persona en las vistas:
- inicia el proceso por la API del portal;
- completa las tareas por la API del panel, con el usuario de cada rol;
- dispara los temporizadores con la API REST de Camunda.

Para cada caso compara el resultado esperado con el obtenido. Revisa dos cosas:
- **en el motor**, el estado o evento final y las variables;
- **en arca-servicios**, el registro guardado: estado, expediente, decisión, prima o vigencia.

## Cómo repetirlo

Con los dos componentes en marcha (ver el [README del hub](../README.md#cómo-levantar-todo)), desde la carpeta del hub:

```bash
node pruebas/casos.mjs
```

Para obtener también la tabla en Markdown:

```bash
node pruebas/casos.mjs --markdown
```

El script termina con código 0 solo si todos los casos cumplen. Usa las firmas y pólizas de ejemplo de `data.sql`, y cada ejecución crea instancias y registros nuevos, así que se puede repetir sin limpiar las bases.

## Datos de partida

| Firma | Pre-Score | Póliza |
|---|---|---|
| Smith & Lee LLP | 60 | `POL-2026-0042`, vigente del 1-mar-2026 al 1-mar-2027 |
| Garcia Legal Group | 74 | `POL-2026-0107`, vigente del 1-jun-2026 al 1-jun-2027 |
| Rivera & Cole LLP | 48, con restricción disciplinaria | `POL-2025-0310`, vencida |

## Resultados de la última ejecución

Ejecutado el 18 de noviembre de 2026 contra arca-servicios y arca-bpm-engine en local, con PostgreSQL 16 en Docker. **25 de 25 casos con el resultado esperado.**

| Caso | Proceso | Tipo | Descripción | Resultado esperado | Resultado obtenido | ¿Cumple? |
|---|---|---|---|---|---|---|
| C10-01 | C10 | Principal | Monto de 300.000 USD: concepto jurídico, preverificación con reserva y expediente | Siniestro registrado · RESERVA · SIN- · SINIESTRO_REGISTRADO | Siniestro registrado · RESERVA · SIN- · SINIESTRO_REGISTRADO | Sí |
| C10-02 | C10 | Alternativo | Monto bajo sin exclusión dudosa: no pide concepto y la preverificación niega cobertura | Aviso cerrado sin cobertura · concepto false · CERRADO_SIN_COBERTURA | Aviso cerrado sin cobertura · concepto false · CERRADO_SIN_COBERTURA | Sí |
| C10-03 | C10 | Alternativo | Exclusión dudosa con monto bajo: concepto jurídico y cobertura confirmada | Siniestro registrado · CUBIERTO | Siniestro registrado · CUBIERTO | Sí |
| C10-04 | C10 | Alternativo | 24 h sin preverificar: se informa a la firma y la tarea sigue abierta | Determinar la preverificación de cobertura · informado true | Determinar la preverificación de cobertura · informado true | Sí |
| C10-05 | C10 | Excepción | Hecho anterior al inicio de vigencia: se cierra sin cobertura | Aviso cerrado sin cobertura · CERRADO_SIN_COBERTURA | Aviso cerrado sin cobertura · CERRADO_SIN_COBERTURA | Sí |
| C10-06 | C10 | Excepción | Póliza que no existe en el registro | Aviso cerrado sin cobertura · La póliza no existe en el registro de ARCA | Aviso cerrado sin cobertura · La póliza no existe en el registro de ARCA | Sí |
| C10-07 | C10 | Excepción | Póliza de otra firma | Aviso cerrado sin cobertura · La póliza pertenece a otra firma | Aviso cerrado sin cobertura · La póliza pertenece a otra firma | Sí |
| C10-08 | C10 | Excepción | Fecha del hecho futura: el portal rechaza el aviso | 400 | 400 | Sí |
| C3-01 | C3 | Principal | Garcia (Pre-Score 74) con 8 «sí»: FORTRESS, aceptación automática y cotización | FORTRESS · ACCEPT · 1785 · ACEPTADA | FORTRESS · ACCEPT · 1785 · ACEPTADA | Sí |
| C3-02 | C3 | Alternativo | Smith (Pre-Score 60) con 4 «sí»: GUARDED, el Suscriptor acepta | GUARDED · 53 · 5544 · ACEPTADA | GUARDED · 53 · 5544 · ACEPTADA | Sí |
| C3-03 | C3 | Alternativo | Smith con 1 «sí»: EXPOSED, Actuario y Director declinan con plan de mejora | EXPOSED · DECLINE · plan true · DECLINADA | EXPOSED · DECLINE · plan true · DECLINADA | Sí |
| C3-04 | C3 | Alternativo | Smith con 0 «sí»: CRITICAL, se declina sin revisión | CRITICAL · DECLINE · DECLINADA | CRITICAL · DECLINE · DECLINADA | Sí |
| C3-05 | C3 | Alternativo | Rivera con restricción disciplinaria y 8 «sí»: puntaje alto pero revisión humana forzada | Revisar el caso y decidir · restricción true | Revisar el caso y decidir · restricción true | Sí |
| C3-06 | C3 | Alternativo | Garcia con 8 «sí» y reclamo pagado: revisión humana forzada | Revisar el caso y decidir | Revisar el caso y decidir | Sí |
| C3-07 | C3 | Excepción | La firma no responde en 24 h: evaluación abandonada | Evaluación abandonada | Evaluación abandonada | Sí |
| C3-08 | C3 | Excepción | Respuestas sin la declaración de veracidad | 400 | 400 | Sí |
| C3-09 | C3 | Alternativo | Firma recién registrada en el portal: Pre-Score sin historial (60) y registro guardado | 201 · Pre-Score 60 | 201 · Pre-Score 60 | Sí |
| C3-10 | C3 | Excepción | Registro de una firma repetida y de un email inválido | 409 · 400 | 409 · 400 | Sí |
| G3-01 | G3 | Principal | Validación, comité y carrier aprueban: la versión queda vigente y reemplaza a la anterior | Versión publicada · VIGENTE · anterior true | Versión publicada · VIGENTE · anterior true | Sí |
| G3-02 | G3 | Alternativo | La primera validación falla (AUC 0,64) y vuelve a calibración | Versión publicada | Versión publicada | Sí |
| G3-03 | G3 | Alternativo | El comité pide ajustes y luego aprueba | Versión publicada | Versión publicada | Sí |
| G3-04 | G3 | Excepción | El comité rechaza la versión | Propuesta rechazada | Propuesta rechazada | Sí |
| G3-05 | G3 | Excepción | El carrier rechaza la versión | Versión no aprobada por el carrier | Versión no aprobada por el carrier | Sí |
| G3-06 | G3 | Excepción | Las pruebas de humo de S2 fallan y el despliegue se revierte | Despliegue revertido · DESPLIEGUE_REVERTIDO | Despliegue revertido · DESPLIEGUE_REVERTIDO | Sí |
| G3-07 | G3 | Excepción | El carrier no responde en 15 días | Sin respuesta del carrier | Sin respuesta del carrier | Sí |

En los resultados, `SIN-` es el prefijo del número de expediente que asigna arca-servicios (por ejemplo `SIN-2026-00001`). `anterior true` indica que la versión publicada reemplazó a otra que estaba vigente.

## Otras pruebas

- **arca-bpm-engine**, `./mvnw test`: 4 pruebas con H2 y un doble de arca-servicios.
  - Despliegue de 7 procesos y 3 decisiones.
  - C10 decide con la vigencia que responde el registro de pólizas, vigente o no.
  - Si arca-servicios no responde, el aviso no se inicia y el error lleva un mensaje claro.
- **arca-servicios**, `./mvnw test`: 6 pruebas con H2 en modo PostgreSQL.
  - Datos de ejemplo cargados.
  - Vigencia según la fecha y la firma.
  - Expediente único.
  - Cálculos del Score Engine guardados.
  - Reemplazo de la versión vigente.
  - Rechazo de entradas inválidas y duplicadas.
