'use strict';
// Aplicacao WEB independente: NAO inicia o bot Discord nem abre o banco SQLite.
const { startLiveServer } = require('./live/server');
const port = Number(process.env.PORT) || 80;
if (!process.env.DISCORD_TOKEN) console.warn('ATENCAO: defina DISCORD_TOKEN nas variaveis privadas para verificar a Activity.');
startLiveServer({ port, logger: console });
