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

## Deploy via GitHub Actions (alternativa ao webhook)

O workflow `.github/workflows/deploy.yml` utiliza a action oficial `squarecloudofc/github-action@v2`. Ele testa e compila a Activity em GitHub Actions e faz deploy no GameDeals-Bot existente, sem depender da integração automática via webhook.

### Ativação das credenciais

Em **GitHub > Repositório GameDeals > Settings > Secrets and variables > Actions**:

1. Na aba **Secrets**, crie `SQUARECLOUD_API_KEY` com a API key da sua conta Square Cloud. Não coloque a chave no código, em chats ou nos logs.
2. Na aba **Variables**, crie `SQUARECLOUD_APP_ID` com o ID da aplicação **GameDeals-Bot na Square Cloud**. **Não** use o Discord Application ID.
3. Em **Actions > Deploy GameDeals na Square Cloud > Run workflow**, selecione a branch `main` e execute. Os próximos pushes em `main` também farão deploy.

O primeiro workflow pode falhar na etapa de credenciais até que ambas sejam cadastradas. Não requer mudar a configuração GitHub App existente.

### Proteção de dados

O pacote `project.zip` contém apenas os arquivos da aplicação e a Activity compilada. Não inclui `data/`, `.env`, `node_modules/` nem outros arquivos privados. A Square Cloud documenta que `commit --file ... --restart` sobrescreve apenas os arquivos enviados e conserva os demais. **Antes do primeiro uso, confira se o SQLite e seus backups estão persistentes na Square Cloud.**

O workflow não define, altera nem copia `DISCORD_TOKEN`, `ENABLE_LIVE` ou `ACTIVITY_PUBLIC_URL`. Se o deploy automático original voltar a funcionar, evite deixar dois fluxos publicando o app simultaneamente.

Referências: https://squarecloud.app/en/resources/github-action e https://squarecloud.app/pt-br/learning/deploy/deploy-with-github-actions .

## GameDeals Live em hospedagem Web separada, com o bot original intacto

Se o bot estiver como worker e a Activity for hospedada em outra aplicação Web, defina **no GameDeals-Bot** `ENABLE_LIVE=1` e `LIVE_EXTERNAL=1`. Assim o botão **Transmitir tela** e o comando global de entrada continuam registrados, mas o worker não executa mais o relay HTTP/WebSocket que não possui domínio. Na nova aplicação Web, `live/server.js` precisa ser iniciado via um arquivo de entrada próprio (`startLiveServer()`), com publicação Web habilitada no primeiro envio.

No Hobby de 1 GB, 512 MB + 512 MB cabem na cota total, mas só reduza a memória alocada ao bot após verificar o pico real do processo, com folga suficiente. O arquivo `squarecloud.app` do bot ainda mostra memória de 1024 MB; a alocação vigente deve ser verificada/alterada diretamente no painel.

## Web GameDeals Live separada (Hobby 1 GB)

A aplicacao Web fica em `live-web/`, enquanto a interface/servidor usam a fonte `live/`.
O workflow `Preparar e publicar GameDeals-Live (Web)` compila o SDK, valida `/health` e a pagina, e gera o artefato `GameDeals-Live-Web-Publicar` com `GameDeals-Live-Web.zip` pronto para upload. Esse ZIP nao contem credenciais, banco de dados, dependencias do bot nem `node_modules`.

No **primeiro upload**, em Square Cloud escolha criar **nova aplicacao Web**, ative *Publicacao na Web*, use subdominio `gamedeals`, `MAIN=index.js`, RAM 512 MB. No aplicativo WEB, configure em variaveis privadas:
- `DISCORD_TOKEN` = token do bot GameDeals ja existente (nao salvar em repo).
- `DISCORD_APPLICATION_ID=1569671744803967127`
- `ACTIVITY_PUBLIC_URL=https://gamedeals.squareweb.app`

No GameDeals-Bot, mantenha `ENABLE_LIVE=1`. O worker **nao inicia HTTP/WebSocket por padrao**: `LIVE_INTERNAL=1` seria necessario para testes locais, nunca para o worker. Apos criar a Web, configure a variavel GitHub `SQUARECLOUD_LIVE_APP_ID` com o ID da NOVA aplicacao e conceda a chave `SQUARECLOUD_API_KEY` escopo para deployment/restart **tambem da Web**. A cada push relevante, o novo workflow publica somente a Web.

No Discord Developer Portal, Activities > URL Mappings: prefix `/` para `gamedeals.squareweb.app`, SSL ativo, sem override localhost. Confirme `https://gamedeals.squareweb.app/health` antes de abrir a Activity.

O GameDeals Live atual transmite **video, sem audio**.

## GameDeals Live: 1080p, 1440p, 60 FPS e som opcional

O fluxo de captura em `live/public/broadcast.html` separa **Escolher tela ou janela** de **Iniciar transmissão**. A permissão de captura só pode ser exibida pelo próprio navegador após interação do usuário, e a Activity embutida pode bloquear `getDisplayMedia` por política de permissões do Discord. Para esse caso, use **Abrir no navegador**.

Perfis: 480p/720p/1080p/1440p e 15/30/60 FPS. A saída preserva a proporção da fonte e não amplia uma fonte de resolução inferior. O WebCodecs testa suporte ao codec e encoder antes de iniciar; a captura usa `requestVideoFrameCallback` para processar quadros novos, e estatísticas indicam FPS **efetivamente codificados/enviados** e **decodificados/exibidos**, não só a meta selecionada. 1440p/60 não é garantia: depende de resolução da fonte, navegador, sistema, GPU, janela em segundo plano e conexão. Perfis altos aumentam banda e CPU; o servidor apenas encaminha os pacotes via WebSocket.

Áudio opcional: `Sem áudio` ou `Com áudio da tela/guia`. Se o navegador disponibilizar uma faixa de áudio em `getDisplayMedia({audio:true})`, o transmissor encaminha **PCM mono 16-bit** via WebSocket (não simula som). O espectador precisa clicar **Ativar áudio da transmissão** para desbloquear a reprodução. O navegador pode não disponibilizar som do sistema para a origem selecionada; nesse caso a transmissão permanece sem áudio e informa isso, sem prometer uma captura inexistente. Não é captura de microfone e não é um sistema de gravação.

## Diagnóstico de tela preta (GameDeals Live)

A versão atual só mostra **AO VIVO** na Activity depois de receber e decodificar o primeiro quadro. O transmissor aguarda `config-ack` do relay antes de exibir AO VIVO; a guia externa e a Activity mostram os últimos seis caracteres do `roomId` (identificação pública da sala, sem tokens). Eles devem coincidir. 

No transmissor, **espectadores conectados = 0** significa que não há uma Activity assistindo à mesma sessão; saia da Activity, encerre a guia de transmissão antiga, inicie novamente a Activity e use o botão **Abrir no navegador** para gerar link novo. **Quadros recebidos pelo servidor = 0** com FPS locais positivos indica problemas entre codificador/rede e relay. Se o relay recebe quadros mas a Activity não exibe vídeo, verifique erro do codec/decodificador no rodapé da Activity. A Activity envia `sync` periodicamente para se recuperar de mensagens de estado perdidas.

O protocolo usa mensagens `config-ack`, `config-error`, `relay-stats`, `sync` e `viewers`; não retorna tokens em diagnóstico e não grava frames.

## GameDeals Bot — evolução de v0.6 até v0.9

### v0.6 · Alertas confiáveis
- Corrigida a detecção de promoções temporariamente grátis da Epic Games. Jogos permanentemente gratuitos continuam fora dos anúncios de ofertas temporárias.
- Fila de notificações persistente no SQLite, com deduplicação por evento, retentativas automáticas com intervalo crescente, e descarte de promoções expiradas ou cujo preço mudou.
- A primeira coleta não dispara em massa ofertas anteriores.

### v0.7 · Busca e comparação
- Busca unificada no painel, com ordenação por relevância, maior desconto e menor preço, preservando o agrupamento por moeda.
- Filtros por Steam / lojas parceiras, moeda BRL / USD e somente promoções.
- Comparação por título normalizado e tipo de edição, ignorando promoções vencidas; nenhuma conversão fictícia entre USD e BRL.

### v0.8 · Acompanhamento multiloja
- Na ficha de cada jogo há Seguir em lojas e Alerta multiloja.
- Metas de preço individuais por título, edição e moeda; alertas enviados por DM quando as fontes consultadas encontram ofertas que atendem à meta.
- Meus desejos reúne acompanhamento individual e multiloja com remoção separada.
- Jogos Steam acompanhados entram no rodízio de verificações limitado por ciclo.

### v0.9 · Monitoramento e administração
- Administração: Relatório de catálogo, acompanhamentos, fila de alertas e saúde das fontes; botão Reenviar falhas.
- Persistência do último horário de coleta bem-sucedida, independente do último erro.
- Até três páginas de destaques de revendedores disponíveis no CheapShark, uma vez por hora, com cache e limite de requisições; sem anúncio em massa na primeira expansão.
- Limpeza periódica somente de registros de fila entregues ou descartados com mais de 90 dias, preservando o histórico de ofertas, alertas e o banco.
- Testes automatizados para migrações, promoções gratuitas, filtros, acompanhamento multiloja e fila de avisos.

### Limites que permanecem
A Steam é monitorada por ofertas em destaque e por produtos acompanhados; isso não cobre o catálogo integral. A Epic é acompanhada para resgates temporariamente grátis; produtos pagos não são monitorados de forma completa. Revendedores como GOG, Fanatical e Green Man Gaming aparecem quando retornados por uma fonte autorizada (CheapShark), com preços geralmente em USD e disponibilidade regional variável. Nuuvem e Instant Gaming dependem de acesso a uma fonte/API autorizada: por isso, permanecem pendentes, sem preços fabricados. O histórico de preços começa com a coleta do próprio GameDeals; não representa o menor preço absoluto da loja. Os backups são locais à Square Cloud, não constituem backup externo para recuperação de desastre.

O bot e a GameDeals-Live continuam em aplicativos separados. O fluxo de deploy do bot inclui deal-engine.js, mas nunca empacota o diretório de dados, credenciais ou arquivos .env.
