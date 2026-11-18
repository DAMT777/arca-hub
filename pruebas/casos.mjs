// ARCA · Casos de prueba de punta a punta.
// Recorre el camino principal, los alternativos y las excepciones de C10, C3 y G3 usando la misma API que el portal
// y el panel, dispara los temporizadores por la API REST de Camunda y comprueba los registros en arca-servicios.
//
// Requisitos: arca-servicios en marcha (8091) y arca-bpm-engine en marcha (8090). Node.js 18 o superior.
// Uso, desde la carpeta del hub:
//   node pruebas/casos.mjs                 imprime el resultado de cada caso
//   node pruebas/casos.mjs --markdown      además imprime la tabla en Markdown para docs/casos-de-prueba.md
const MOTOR = process.env.ARCA_MOTOR_URL ?? "http://localhost:8090";
const SERVICIOS = process.env.ARCA_SERVICIOS_URL ?? "http://localhost:8091";
const USUARIO = {
  "jefes-siniestros": "jefe.siniestros", "asesoria-juridica": "asesor.juridico", suscriptores: "suscriptor",
  actuarios: "actuario", "direccion-suscripcion": "director.suscripcion", "ingenieria-datos": "ingeniero.datos",
  "comite-modelo": "comite.modelo",
};

async function http(base, ruta, metodo = "GET", body) {
  const r = await fetch(base + ruta, {
    method: metodo, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { status: r.status, d };
}
async function api(ruta, body, metodo) {
  const r = await http(MOTOR, ruta, metodo ?? (body === undefined ? "GET" : "POST"), body);
  if (r.status >= 400) throw new Error(`${ruta} → ${r.status} ${r.d?.error ?? ""}`);
  return r.d;
}
const servicio = async (ruta) => (await http(SERVICIOS, ruta)).d;

async function tarea(grupo, clave, nombre, variables) {
  const t = (await api(`/api/panel/tareas?grupo=${grupo}`)).find((x) => x.clave === clave && x.nombre.includes(nombre));
  if (!t) throw new Error(`No hay tarea «${nombre}» de ${clave} para ${grupo}`);
  await api(`/api/panel/tareas/${t.id}/completar`, { usuario: USUARIO[grupo], variables });
}
async function solicitud(firma, clave) {
  return (await api(`/api/portal/solicitudes?firma=${encodeURIComponent(firma)}`)).find((x) => x.clave === clave);
}
const versionG3 = async (clave) => (await api("/api/g3/versiones")).find((v) => v.clave === clave);
async function vencerTemporizador(processInstanceId) {
  const jobs = (await http(MOTOR, `/engine-rest/job?processInstanceId=${processInstanceId}&timers=true`)).d;
  if (!jobs?.length) throw new Error("No hay temporizador pendiente");
  await http(MOTOR, `/engine-rest/job/${jobs[0].id}/execute`, "POST", {});
}

const casos = [];
async function caso(id, proceso, tipo, descripcion, esperado, prueba) {
  let obtenido;
  try { obtenido = String(await prueba()); } catch (e) { obtenido = "ERROR: " + e.message; }
  casos.push({ id, proceso, tipo, descripcion, esperado, obtenido, ok: obtenido === esperado });
  console.log(`${obtenido === esperado ? "OK   " : "FALLA"} ${id} ${descripcion}\n      esperado: ${esperado}\n      obtenido: ${obtenido}`);
}

const SMITH = "Smith & Lee LLP";
const GARCIA = "Garcia Legal Group";
const RIVERA = "Rivera & Cole LLP";
const aviso = (firma, numeroPoliza, fechaHecho) =>
  api("/api/c10/avisos", { firma, numeroPoliza, fechaHecho, descripcionHecho: "Escrito con jurisprudencia inexistente generada con IA" });
const avisoServicio = (clave) => servicio(`/api/avisos/${clave}`);

// ================= C10 Registrar el aviso de siniestro
await caso("C10-01", "C10", "Principal", "Monto de 300.000 USD: concepto jurídico, preverificación con reserva y expediente",
  "Siniestro registrado · RESERVA · SIN- · SINIESTRO_REGISTRADO", async () => {
    const { clave } = await aviso(SMITH, "POL-2026-0042", "2026-10-01");
    await tarea("jefes-siniestros", clave, "Revisar el aviso", { montoReclamado: 300000, exclusionDudosa: false });
    await tarea("asesoria-juridica", clave, "concepto jurídico", { conceptoJuridico: "Exclusión discutible", coberturaRecomendada: "RESERVA" });
    await tarea("jefes-siniestros", clave, "preverificación", { resultadoPreverificacion: "RESERVA", fundamentoPreverificacion: "Reserva de derechos" });
    const s = await solicitud(SMITH, clave);
    const a = await avisoServicio(clave);
    return `${s.estado} · ${a.resultado} · ${String(a.numeroExpediente).slice(0, 4)} · ${a.estado}`;
  });
await caso("C10-02", "C10", "Alternativo", "Monto bajo sin exclusión dudosa: no pide concepto y la preverificación niega cobertura",
  "Aviso cerrado sin cobertura · concepto false · CERRADO_SIN_COBERTURA", async () => {
    const { clave } = await aviso(SMITH, "POL-2026-0042", "2026-10-01");
    await tarea("jefes-siniestros", clave, "Revisar el aviso", { montoReclamado: 20000, exclusionDudosa: false });
    await tarea("jefes-siniestros", clave, "preverificación", { resultadoPreverificacion: "SIN_COBERTURA", fundamentoPreverificacion: "Acto doloso" });
    const s = await solicitud(SMITH, clave);
    return `${s.estado} · concepto ${s.variables.requiereConceptoJuridico} · ${(await avisoServicio(clave)).estado}`;
  });
await caso("C10-03", "C10", "Alternativo", "Exclusión dudosa con monto bajo: concepto jurídico y cobertura confirmada",
  "Siniestro registrado · CUBIERTO", async () => {
    const { clave } = await aviso(SMITH, "POL-2026-0042", "2026-10-01");
    await tarea("jefes-siniestros", clave, "Revisar el aviso", { montoReclamado: 5000, exclusionDudosa: true });
    await tarea("asesoria-juridica", clave, "concepto jurídico", { conceptoJuridico: "Cubierto", coberturaRecomendada: "CUBIERTO" });
    await tarea("jefes-siniestros", clave, "preverificación", { resultadoPreverificacion: "CUBIERTO", fundamentoPreverificacion: "Cubierto" });
    return `${(await solicitud(SMITH, clave)).estado} · ${(await avisoServicio(clave)).resultado}`;
  });
await caso("C10-04", "C10", "Alternativo", "24 h sin preverificar: se informa a la firma y la tarea sigue abierta",
  "Determinar la preverificación de cobertura · informado true", async () => {
    const { id, clave } = await aviso(SMITH, "POL-2026-0042", "2026-10-01");
    await tarea("jefes-siniestros", clave, "Revisar el aviso", { montoReclamado: 1000, exclusionDudosa: false });
    await vencerTemporizador(id);
    const s = await solicitud(SMITH, clave);
    return `${s.estado} · informado ${Boolean(s.variables.ultimoAvisoEstado)}`;
  });
await caso("C10-05", "C10", "Excepción", "Hecho anterior al inicio de vigencia: se cierra sin cobertura",
  "Aviso cerrado sin cobertura · CERRADO_SIN_COBERTURA", async () => {
    const { clave } = await aviso(SMITH, "POL-2026-0042", "2026-01-15");
    return `${(await solicitud(SMITH, clave)).estado} · ${(await avisoServicio(clave)).estado}`;
  });
await caso("C10-06", "C10", "Excepción", "Póliza que no existe en el registro", "Aviso cerrado sin cobertura · La póliza no existe en el registro de ARCA",
  async () => {
    const { clave } = await aviso(SMITH, "POL-9999-0001", "2026-10-01");
    return `${(await solicitud(SMITH, clave)).estado} · ${(await avisoServicio(clave)).fundamento}`;
  });
await caso("C10-07", "C10", "Excepción", "Póliza de otra firma", "Aviso cerrado sin cobertura · La póliza pertenece a otra firma",
  async () => {
    const { clave } = await aviso(SMITH, "POL-2026-0107", "2026-10-01");
    return `${(await solicitud(SMITH, clave)).estado} · ${(await avisoServicio(clave)).fundamento}`;
  });
await caso("C10-08", "C10", "Excepción", "Fecha del hecho futura: el portal rechaza el aviso", "400", async () =>
  (await http(MOTOR, "/api/c10/avisos", "POST", { firma: SMITH, numeroPoliza: "POL-2026-0042", fechaHecho: "2099-01-01", descripcionHecho: "x" })).status);

// ================= C3 Suscribir la solicitud
async function evaluacion(firma, dominio, abogados, sies, extra = {}) {
  const { id, clave } = await api("/api/c3/evaluaciones", { firma, dominio, abogados });
  await api(`/api/c3/evaluaciones/${id}/respuestas`, {
    respuestas: Array.from({ length: 8 }, (_, i) => i < sies), reclamoPagado: false, incidenteIA: false, tieneEOVigente: true,
    declaracionVeracidad: true, ...extra,
  });
  return clave;
}
const evalServicio = (clave) => servicio(`/api/evaluaciones/${clave}`);

await caso("C3-01", "C3", "Principal", "Garcia (Pre-Score 74) con 8 «sí»: FORTRESS, aceptación automática y cotización",
  "FORTRESS · ACCEPT · 1785 · ACEPTADA", async () => {
    const clave = await evaluacion(GARCIA, "garcialegal.com", 5, 8);
    const v = (await solicitud(GARCIA, clave)).variables;
    return `${v.tier} · ${v.decision} · ${v.primaAnual} · ${(await evalServicio(clave)).estado}`;
  });
await caso("C3-02", "C3", "Alternativo", "Smith (Pre-Score 60) con 4 «sí»: GUARDED, el Suscriptor acepta", "GUARDED · 53 · 5544 · ACEPTADA", async () => {
  const clave = await evaluacion(SMITH, "smithlee.com", 12, 4);
  await tarea("suscriptores", clave, "Revisar el caso", { decision: "ACCEPT", justificacionDecision: "Gobernanza aceptable" });
  const v = (await solicitud(SMITH, clave)).variables;
  return `${v.tier} · ${v.puntaje} · ${v.primaAnual} · ${(await evalServicio(clave)).estado}`;
});
await caso("C3-03", "C3", "Alternativo", "Smith con 1 «sí»: EXPOSED, Actuario y Director declinan con plan de mejora",
  "EXPOSED · DECLINE · plan true · DECLINADA", async () => {
    const clave = await evaluacion(SMITH, "smithlee.com", 12, 1);
    await tarea("actuarios", clave, "Analizar el caso", { recomendacionActuario: "Declinar" });
    await tarea("direccion-suscripcion", clave, "Resolver el caso", { decision: "DECLINE", justificacionDecision: "Riesgo alto" });
    const v = (await solicitud(SMITH, clave)).variables;
    const e = await evalServicio(clave);
    return `${v.tier} · ${v.decision} · plan ${Boolean(e.fechaReevaluacion)} · ${e.estado}`;
  });
await caso("C3-04", "C3", "Alternativo", "Smith con 0 «sí»: CRITICAL, se declina sin revisión", "CRITICAL · DECLINE · DECLINADA", async () => {
  const clave = await evaluacion(SMITH, "smithlee.com", 12, 0);
  const v = (await solicitud(SMITH, clave)).variables;
  return `${v.tier} · ${v.decision} · ${(await evalServicio(clave)).estado}`;
});
await caso("C3-05", "C3", "Alternativo", "Rivera con restricción disciplinaria y 8 «sí»: puntaje alto pero revisión humana forzada",
  "Revisar el caso y decidir · restricción true", async () => {
    const clave = await evaluacion(RIVERA, "riveracole.com", 25, 8);
    const s = await solicitud(RIVERA, clave);
    await tarea("suscriptores", clave, "Revisar el caso", { decision: "DECLINE", justificacionDecision: "Antecedente disciplinario" });
    return `${s.estado} · restricción ${s.variables.restriccionCapa1}`;
  });
await caso("C3-06", "C3", "Alternativo", "Garcia con 8 «sí» y reclamo pagado: revisión humana forzada", "Revisar el caso y decidir", async () => {
  const clave = await evaluacion(GARCIA, "garcialegal.com", 5, 8, { reclamoPagado: true });
  const s = await solicitud(GARCIA, clave);
  await tarea("suscriptores", clave, "Revisar el caso", { decision: "ACCEPT", justificacionDecision: "Reclamo menor" });
  return s.estado;
});
await caso("C3-07", "C3", "Excepción", "La firma no responde en 24 h: evaluación abandonada", "Evaluación abandonada", async () => {
  const { id, clave } = await api("/api/c3/evaluaciones", { firma: SMITH, dominio: "smithlee.com", abogados: 12 });
  await vencerTemporizador(id);
  return (await solicitud(SMITH, clave)).estado;
});
await caso("C3-08", "C3", "Excepción", "Respuestas sin la declaración de veracidad", "400", async () => {
  const { id } = await api("/api/c3/evaluaciones", { firma: SMITH, dominio: "smithlee.com", abogados: 12 });
  return (await http(MOTOR, `/api/c3/evaluaciones/${id}/respuestas`, "POST", { respuestas: Array(8).fill(true), declaracionVeracidad: false })).status;
});
await caso("C3-09", "C3", "Alternativo", "Firma recién registrada en el portal: Pre-Score sin historial (60) y registro guardado",
  "201 · Pre-Score 60", async () => {
    const n = Date.now().toString(36);
    const reg = await http(MOTOR, "/api/portal/firmas", "POST", { nombre: `Firma Prueba ${n}`, dominio: `prueba${n}.com`, email: `riesgos@prueba${n}.com`, abogados: 3 });
    const clave = await evaluacion(reg.d.nombre, reg.d.dominio, 3, 4);
    return `${reg.status} · Pre-Score ${(await solicitud(reg.d.nombre, clave)).variables.puntajeCapa1}`;
  });
await caso("C3-10", "C3", "Excepción", "Registro de una firma repetida y de un email inválido", "409 · 400", async () => {
  const repetida = await http(MOTOR, "/api/portal/firmas", "POST", { nombre: SMITH, dominio: "otra.com", email: "x@otra.com", abogados: 2 });
  const invalida = await http(MOTOR, "/api/portal/firmas", "POST", { nombre: "Nueva", dominio: "nueva.com", email: "sin-arroba", abogados: 2 });
  return `${repetida.status} · ${invalida.status}`;
});

// ================= G3 Publicar una versión del modelo de score
async function g3(opciones, comite, carrier) {
  const { clave } = await api("/api/g3/versiones", { motivo: "Deriva detectada", ...opciones });
  for (let vuelta = 0; ; vuelta++) {
    await tarea("actuarios", clave, "Consolidar", { fuenteEvidencia: "DERIVA", resumenEvidencia: "AUC en descenso", cambioPropuesto: "Recalibrar" });
    await tarea("ingenieria-datos", clave, "calibrar", { versionCandidata: `v-${clave}`, datosCalibracion: "2025-2026", cambiosSenalesPesos: "Pesos" });
    if (opciones.simularValidacion === "falla" && vuelta === 0) {
      await tarea("ingenieria-datos", clave, "calibrar", { versionCandidata: `v-${clave}`, datosCalibracion: "2025-2026", cambiosSenalesPesos: "Pesos" });
    }
    await tarea("actuarios", clave, "Documentar", { referenciaMemoria: "MC-1", notaCambios: "Recalibración" });
    await tarea("comite-modelo", clave, "aprobar", { decisionComite: comite[vuelta] });
    if (comite[vuelta] !== "AJUSTES") break;
  }
  if (carrier !== undefined) {
    const p = (await api("/api/g3/carrier/pendientes")).find((x) => x.clave === clave);
    await api(`/api/g3/carrier/${p.id}/respuesta`, { aprobada: carrier });
  }
  return clave;
}
const versionServicio = (clave) => servicio(`/api/versiones/${clave}`);

await caso("G3-01", "G3", "Principal", "Validación, comité y carrier aprueban: la versión queda vigente y reemplaza a la anterior",
  "Versión publicada · VIGENTE · anterior true", async () => {
    const clave = await g3({}, ["APROBADA"], true);
    const v = await versionG3(clave);
    return `${v.estado} · ${(await versionServicio(clave)).estado} · anterior ${Boolean(v.variables.versionAnterior)}`;
  });
await caso("G3-02", "G3", "Alternativo", "La primera validación falla (AUC 0,64) y vuelve a calibración", "Versión publicada", async () =>
  (await versionG3(await g3({ simularValidacion: "falla" }, ["APROBADA"], true))).estado);
await caso("G3-03", "G3", "Alternativo", "El comité pide ajustes y luego aprueba", "Versión publicada", async () =>
  (await versionG3(await g3({}, ["AJUSTES", "APROBADA"], true))).estado);
await caso("G3-04", "G3", "Excepción", "El comité rechaza la versión", "Propuesta rechazada", async () =>
  (await versionG3(await g3({}, ["RECHAZADA"]))).estado);
await caso("G3-05", "G3", "Excepción", "El carrier rechaza la versión", "Versión no aprobada por el carrier", async () =>
  (await versionG3(await g3({}, ["APROBADA"], false))).estado);
await caso("G3-06", "G3", "Excepción", "Las pruebas de humo de S2 fallan y el despliegue se revierte", "Despliegue revertido · DESPLIEGUE_REVERTIDO", async () => {
  const clave = await g3({ simularDespliegue: "falla" }, ["APROBADA"], true);
  return `${(await versionG3(clave)).estado} · ${(await versionServicio(clave)).estado}`;
});
await caso("G3-07", "G3", "Excepción", "El carrier no responde en 15 días", "Sin respuesta del carrier", async () => {
  const clave = await g3({}, ["APROBADA"]);
  await vencerTemporizador((await versionG3(clave)).id);
  return (await versionG3(clave)).estado;
});

const ok = casos.filter((c) => c.ok).length;
console.log(`\n${ok} de ${casos.length} casos con el resultado esperado`);
if (process.argv.includes("--markdown")) {
  console.log("\n| Caso | Proceso | Tipo | Descripción | Resultado esperado | Resultado obtenido | ¿Cumple? |\n|---|---|---|---|---|---|---|");
  for (const c of casos) console.log(`| ${c.id} | ${c.proceso} | ${c.tipo} | ${c.descripcion} | ${c.esperado} | ${c.obtenido} | ${c.ok ? "Sí" : "No"} |`);
}
process.exit(ok === casos.length ? 0 : 1);
