'use strict';

// Comandos de entrada de Activity são globais (PRIMARY_ENTRY_POINT=4).
// O handler 2 permite que o próprio Discord inicie a Activity.
// Não sobrescrevemos a lista de comandos: o /buscar continua intacto.
const TYPE = 4;
const DISCORD_LAUNCH_ACTIVITY = 2;
const ROUTE = id => '/applications/' + id + '/commands';
const COMMAND_NAME = 'iniciar';
const DESCRIPTION = 'Abrir GameDeals Live para transmitir ou assistir à tela';

async function ensureEntryPoint(rest, applicationId) {
  if (!rest?.get || !rest?.post || !rest?.patch) throw new TypeError('Cliente REST do Discord inválido');
  if (!/^\d{17,20}$/.test(String(applicationId))) throw new TypeError('Application ID inválido');
  const endpoint = ROUTE(applicationId);
  const commands = await rest.get(endpoint);
  if (!Array.isArray(commands)) throw new Error('Resposta inválida na consulta aos comandos globais');
  const entry = commands.find(x => Number(x.type) === TYPE);
  if (entry) {
    if (Number(entry.handler) === DISCORD_LAUNCH_ACTIVITY) return {action:'existente',command:entry};
    const updated = await rest.patch(endpoint + '/' + entry.id, {body:{
      name:entry.name,
      description:entry.description || DESCRIPTION,
      type:TYPE,
      handler:DISCORD_LAUNCH_ACTIVITY
    }});
    return {action:'atualizado',command:updated};
  }
  const created = await rest.post(endpoint, {body:{
    name:COMMAND_NAME,
    description:DESCRIPTION,
    type:TYPE,
    handler:DISCORD_LAUNCH_ACTIVITY,
    integration_types:[0],
    contexts:[0]
  }});
  return {action:'registrado',command:created};
}

module.exports = {ensureEntryPoint,TYPE,DISCORD_LAUNCH_ACTIVITY};
