# GameDeals Discord Bot + Activity Live

Bot **100% Discord**, sem site: menu permanente com botões, pesquisas individuais, lista de desejos e avisos automáticos no canal separado `#promocoes-de-jogos`.

## O que já funciona (v0.3)

- Cria `#central-de-jogos` e `#promocoes-de-jogos` automaticamente (com **Gerenciar Canais**), edita/reutiliza o menu antigo quando reinicia e fixa o painel quando possível.
- Menus e formulários: ofertas, pesquisar na Steam, detalhes com banner, acompanhar/deixar de acompanhar, preço-alvo em R$, histórico local, jogos grátis, pacotes, status e administração. A pesquisa do painel mostra até dez resultados num seletor, com cinco cartões ilustrados nas primeiras posições, e ficha individual com banner grande.
- A lista de promoções e pacotes apresenta até cinco **cartões com miniaturas**, descontos e links individuais em cada página. A ficha do jogo traz banner, loja, preço original, desconto, acompanhar, alerta, histórico e botão de compra.
- **Comparar lojas:** mostra apenas preços de produtos com títulos e tipos exatamente correspondentes no catálogo local. Quando não há preço confiável da Epic ou de outra loja, informa a indisponibilidade em vez de inventar valores.
- **Painel de administração:** desconto mínimo, preço máximo em reais, ligar/desligar anúncios, atualização manual com intervalo mínimo de cinco minutos e publicação de ofertas para teste.
- **Listas de desejos:** o monitor também verifica até 12 jogos Steam acompanhados por ciclo (configurável por `WISHLIST_CHECK_LIMIT`); a verificação é gradativa para reduzir a carga.
- Comando **opcional** `/buscar` com autocomplete nativo: digite as primeiras letras e veja sugestões de jogos enquanto escreve. Não é necessário usar comandos para operar o painel.
- Verifica **promoções em destaque na Steam** (Brasil) e **jogos temporariamente grátis na Epic Games Store**; envia alertas somente quando identifica novas ofertas ou alterações de preço.
- Preços reais sem conversão fictícia. Exibe a moeda recebida da fonte; verifica se o preço-alvo usa BRL. Consulta as fontes a cada 30 minutos por padrão.
- Backups locais consistentes do SQLite ao iniciar e a cada 24 horas, mantendo as sete cópias diárias mais recentes. Isso **não substitui backup fora da hospedagem**.
- SQLite local: ofertas, mudanças de preço, preferências dos servidores, lista de desejos, registros de notificações e mensagem principal.
- Notificações privadas por DM para jogos acompanhados com limite de preço (dependem de a DM estar habilitada para o usuário).
- A primeira coleta de **cada fonte** serve para povoar o catálogo **sem anunciar em massa ofertas antigas**. Administradores podem clicar em **Publicar 3 ofertas** para testar o canal.

**Limitação de interface do Discord:** menus de seleção e campos de formulários não recebem eventos a cada tecla, portanto não existe autocomplete dinâmico dentro do dropdown de uma mensagem. O autocomplete verdadeiro é suportado por opções de comandos como `/buscar`. No painel, a pessoa usa o botão Pesquisar e recebe o seletor de resultados após confirmar o texto.

**Limitações honestas:** a coleta inicial da Steam lista somente ofertas **em destaque**, e não o catálogo completo. A busca da Steam consulta títulos por nome; o endpoint de preços detalhados aceita jogos individuais. Na Epic, o bot acompanha **resgates gratuitos**, não o catálogo geral pago. Ainda não há Nuuvem, GOG, Fanatical, Green Man Gaming, comparação completa entre lojas nem garantia de menor preço histórico absoluto. Esses recursos dependem de integrações confiáveis e do direito de reutilizar os dados. Os endpoints públicos usados pelas lojas não têm garantia de estabilidade. As miniaturas ficam nos cartões porque o Discord não suporta imagens dentro dos itens de um seletor de texto; o banner grande é mostrado na ficha após escolher o jogo.

## Identificadores do projeto

- Discord Application ID: `1569671744803967127`
- Servidor inicial de testes: `1476140209556029462`
- [Convidar GameDeals ao Discord](https://discord.com/oauth2/authorize?client_id=1569671744803967127&permissions=93200&scope=bot%20applications.commands) — o convite pede permissões de canais, mensagens, links e fixação. **Não concede administrador**.
- Repositório: `brenodasilva0099-png/gamedeals-discord-bot`. Está público no momento da primeira publicação; não incluir nenhuma credencial.

## Preparação

1. No [Discord Developer Portal](https://discord.com/developers/applications), crie um aplicativo e adicione um bot. Copie o **token** sem divulgá-lo.
2. Convide o bot usando **OAuth2 > URL Generator**, com `bot` e as permissões **Ver Canais**, **Enviar Mensagens**, **Inserir Links**, **Ler Histórico de Mensagens**, **Gerenciar Canais** e, se quiser fixar a mensagem, **Gerenciar Mensagens**. Não é necessário dar `Administrator` nem habilitar `Message Content Intent`.
3. Na Square Cloud Hobby, importe o repositório GitHub para uma aplicação **Node.js** (runtime recomendado Node 24). Configure em **Variáveis de ambiente** `DISCORD_TOKEN` com o token do bot. **Nunca salve o token num arquivo versionado ou numa mensagem pública.**
4. O arquivo `squarecloud.app` já aponta para `index.js` e define `MEMORY=768`. O `package.json` instala `discord.js` e inicia com `node index.js`.
5. Depois do deploy, abra os logs da Square Cloud. Se o bot tiver as permissões necessárias, criará os canais e publicará o painel automaticamente.

> O repositório pode ser público, mas **o token, arquivos `.env`, banco `data/gamedeals.db` e backups não podem ser commitados**. O `.gitignore` protege os caminhos comuns.

### Executar no PC (opcional)

Precisa de Node.js 22.16+ (preferencialmente 24).

```bash
npm install
# Configure DISCORD_TOKEN como variável de ambiente no seu terminal
npm start
npm test
```

### Banco de dados e backups

O SQLite é salvo em `data/gamedeals.db`. O bot faz backups locais consistentes pelo SQLite, mantendo até sete datas na pasta `data/backups/`. **Não copie apenas o `.db` enquanto o modo WAL estiver gravando**; para segurança contra perda da hospedagem, exporte os backups para outro serviço. A persistência do sistema de arquivos da hospedagem não equivale a backup. A atualização de código não deve substituir a pasta `data/`.

### Observações operacionais

- Cada servidor tem seu próprio canal de promoções e desconto mínimo. O painel mostra as funções para todos, mas o menu Administração só altera dados para pessoas com `Gerenciar Servidor`.
- Uma mensagem no canal principal é reaproveitada pelo seu ID, ou identificada pelas últimas mensagens do bot para evitar duplicação.
- A frequência configurável (`POLL_MINUTES`, mínimo 15) não significa preço em tempo real. As fontes podem estar atrasadas, indisponíveis ou limitadas.
- O histórico registra apenas preços observados **depois** do início do bot.
- Para crescer ou escanear catálogos inteiros, será necessário acrescentar fontes aprovadas, filas, rate limiting aprimorado, migrações e backups automáticos externos.

## Privacidade

Armazenamos identificadores técnicos de servidores e membros apenas para preferências e alertas. Não armazenamos e-mails, mensagens enviadas pelos membros ou credenciais da conta Steam/Epic. Ao remover o bot de um servidor, os dados locais desse servidor não são excluídos automaticamente nesta versão.

## Visualização de ofertas (v0.3.1)

- Ofertas, pacotes e jogos grátis mostram **2 jogos por página**, com **imagem grande** em vez de miniaturas.
- Os botões **Anterior/Próxima** editam o mesmo painel privado; não geram várias mensagens.
- A pesquisa exibe 2 banners grandes e mantém até 10 opções no seletor.
- Os banners são vinculados aos produtos e dependem das imagens fornecidas por Steam/Epic.

## Catalogo por loja (v0.4.1)

- `Outras lojas` abre um seletor com os revendedores autorizados ativos retornados pelo CheapShark.
- Escolhendo Green Man Gaming, GOG, Fanatical ou outra loja ativa, o bot consulta **so as ofertas daquela loja**, com 2 banners por pagina, preco USD, desconto, link e paginacao.
- O primeiro clique busca no CheapShark por `storeID`, `onSale=1` e `pageNumber`; cada lote remoto possui 20 ofertas. Os cliques paginam duas por vez e reutilizam o cache (15 minutos), para reduzir requisicoes.
- As lojas surgem somente quando estiverem ativas na fonte. Catalogos podem ter lacunas e nao sao garantia de disponibilidade para clientes brasileiros.
- Nuuvem aparece marcada como **integracao pendente**: sua API exige chave de parceiro aprovado. Instant Gaming nao esta integrada por falta de fonte autorizada verificada.


## 📺 GameDeals Live v0.5 (nova Discord Activity)

Adaptado do conceito **Void Arena Activity Live**: um painel dentro do Discord assiste à transmissão enquanto a captura ocorre no navegador do PC. **Não é o Go Live nativo do bot** nem um compartilhamento automático de tela. Não é necessário instalar aplicativo local ou criar site público para pesquisa de preços, mas a Activity requer um endereço HTTPS para funcionar.

### Nesta primeira versão

- **📺 Transmitir tela** no painel: abre a Activity oficial associada ao aplicativo GameDeals quando configurada.
- Captura manual em **Chrome/Edge de desktop**: o usuário clica Iniciar e escolhe a tela/janela; permissão explícita do sistema.
- WebSocket Relay entre navegador e Activity: funciona sem depender de `RTCPeerConnection` dentro do Discord (limitação do proxy).
- Codificação WebCodecs **VP8**, fallback **H.264**, máximo **720p / 30 FPS** (opção 480p/15 FPS).
- Até **4 espectadores por sessão**, no máximo **5 sessões**; transmissão limitada por buffers, descarte de quadros congestionados, keyframes e conexão HTTPS/WSS.
- Transmissão cessa com **Parar**, ao fechar o navegador ou perder a conexão. Não há gravação de frames em disco ou bancos de dados.
- Player com **tela cheia**, status de conexão e reconexão automática, estatísticas básicas.
- Cada sessão da Activity usa o `instanceId` do SDK Discord e autenticação do servidor pela API de instâncias; tokens temporários de transmissão gerados com CSPRNG.

**Limitações importantes:** o áudio do sistema ainda não é transmitido. Compatibilidade real com Discord e latência da Square Cloud precisam de testes no ambiente final. O link de captura deve ser tratado como senha: qualquer pessoa com ele pode iniciar a transmissão se a sala estiver livre. Nesta versão, membros na mesma Activity podem obter o link; não use com desconhecidos. Não há autenticação OAuth individual nem gravação. O relay consome tráfego proporcional à quantidade de espectadores. Não é adequado para dezenas de espectadores em Hobby de 1 GB.

### Publicar na Square Cloud (mesma aplicação, plano Hobby)

1. **Faça backup do banco `data/gamedeals.db`** antes de alterar a modalidade da aplicação existente. No painel da Square Cloud, é preciso habilitar **Publicação Web** para o mesmo app Node.js e obter um domínio `*.squareweb.app`. Um bot hospedado somente como processo em segundo plano não recebe URL pública. Se sua aplicação atual não permitir mudar para web, será necessário recriá-la como app web ou separar bot e relay. Não presuma que uma configuração do arquivo muda automaticamente a modalidade já criada.
2. Reserve aproximadamente **1024 MB** de RAM para bot + relay, respeitando o total do Hobby. O consumo depende de quantos usuários assistem e deve ser medido nos logs. Na Square Cloud, o servidor usa `PORT` e aceita conexões em `0.0.0.0`.
3. Defina as variáveis de ambiente no painel: `DISCORD_TOKEN` (existente), `ENABLE_LIVE=1`, `DISCORD_APPLICATION_ID=1569671744803967127` e `ACTIVITY_PUBLIC_URL=https://SEU-SUBDOMINIO.squareweb.app` (substitua pelo domínio REAL retornado pela Square Cloud). Nunca versionar o token. **Não habilite** `LIVE_ALLOW_UNVERIFIED` em produção.
4. O build do cliente da Activity usa `@discord/embedded-app-sdk` e `esbuild` via script `npm run build:live` (`postinstall` em instalação limpa); o `index.js` também tenta compilar se o bundle estiver ausente. Instale as dependências atualizadas em um deploy limpo (sem `node_modules` antigo).
5. No [Discord Developer Portal](https://discord.com/developers/applications/1569671744803967127/activities), habilite **Activities** para o aplicativo GameDeals. Em **URL Mappings**, use `PREFIX /` → `TARGET SEU-SUBDOMINIO.squareweb.app` **sem `https://`**. Confira a documentação do portal: o mapeamento do prefixo `/` permite a página e `/live/ws` via proxy.
6. Reimplante o bot e abra `https://SEU-SUBDOMINIO.squareweb.app/health`: deve retornar `{"ok":true,"service":"GameDeals","live":true}`. No Discord, clique no novo botão **Transmitir tela**.
7. Dentro da Activity, clique em **Copiar link para transmitir**, abra esse link no Chrome/Edge (fora do iframe do Discord), selecione tela/janela e clique em **Iniciar**.

**Segurança/privacidade:** o endpoint `/api/live/room` só aceita IDs de instâncias reais quando `LIVE_ALLOW_UNVERIFIED` não está ligado. Há rate limit básico por sala e buffers, mas não há verificação de identidade dos participantes individualmente. Não utilize este protótipo com dados confidenciais. O servidor não grava conteúdo, mas usuários que assistem podem gravar por conta própria.

Referências oficiais: [Discord Embedded App SDK](https://discord.com/developers/docs/activities/overview), [Discord Activity Instance API](https://discord.com/developers/docs/activities/development-guides/multiplayer-experience), [Square Cloud WebSocket](https://squarecloud.app/en/learning/apis/how-to-host-a-websocket-server).

## Entrada no App Launcher (v0.5.1)

Com `ENABLE_LIVE=1`, o bot verifica ao iniciar os comandos **globais** da aplicação. Se não houver comando de tipo `PRIMARY_ENTRY_POINT` (4), registra `iniciar` com handler `DISCORD_LAUNCH_ACTIVITY` (2). Se existir um entry point com outro handler, ajusta o handler para abertura automática. O comando `/buscar` e os menus antigos não são apagados. Em caso de falha, os logs informam a resposta do Discord.

No cliente Discord, **desmarque a substituição manual de URL da Activity** (se estiver apontando para `localhost:3000`). Em produção use Activities > URL Mappings: prefix `/`, target `gamedeals.squareweb.app` (sem `https://`). A propagação do comando global pode levar algum tempo.

## Square Cloud: permitir instalação do esbuild (v0.5.2)

Se a hospedagem mostrar `npm warn install-scripts esbuild@0.28.2 (postinstall: node install.js)`, o `package.json` já permite explicitamente apenas o `esbuild` em `allowScripts`, sem liberar indiscriminadamente scripts de outras dependências. Após novo deploy, verifique se `GameDeals Activity compilada com Embedded App SDK.` aparece nos logs e se o app responde em `/health`. A aprovação cobre também versões do esbuild dentro do intervalo `^0.28.2` se forem resolvidas pela hospedagem.
