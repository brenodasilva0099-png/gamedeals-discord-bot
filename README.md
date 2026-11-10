# GameDeals Discord Bot

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

## Correção de banners (v0.3.2)

- O banner registrado pela API Steam/Epic agora tem prioridade sobre URLs genéricas construídas manualmente.
- Para produtos Steam sem imagem registrada, usa-se um fallback para `steam/apps/<id>/header.jpg` ou `steam/subs/<id>/header.jpg` conforme o tipo do produto.
- Inclui testes para imagens oficiais, pacotes `sub`, URLs Steam antigas e lojas externas.
- Se nem a origem nem o fallback tiverem uma imagem disponível, o Discord poderá mostrar só o título; nunca utilizamos uma imagem inventada de outro jogo.

## Lojas parceiras e comparação (v0.4.0)

- O botão Outras lojas mostra ofertas de revendedoras autorizadas que constem na API CheapShark, como Green Man Gaming, Fanatical, GOG, Humble Store, Gamesplanet, GameBillet e outras, conforme disponibilidade real.
- Os preços obtidos do CheapShark são em USD (não convertidos para BRL). Steam mantém valores BRL; Epic monitora jogos gratuitos temporários. O botão Comparar lojas agrupa preços por moeda e exige nome/edição correspondentes.
- Pesquisar consulta Steam e CheapShark, com até dois banners e seletor de até 25 produtos; o comando opcional /buscar usa autocomplete nativo da Steam.
- Compras de lojas parceiras usam links do tipo https://www.cheapshark.com/redirect?dealID=... , conforme documentação em https://apidocs.cheapshark.com/ . Não trocar por links de afiliado próprios.
- O monitor automático consulta apenas uma página de até 35 ofertas CheapShark aproximadamente a cada quatro horas; não varre o catálogo inteiro. Após a primeira coleta, publica no máximo seis ofertas novas ou alteradas por ciclo. Busca tem cache de 15 minutos.
- Lista de desejos: alertas podem usar limites em BRL ou USD por produto. Só jogos Steam monitorados recebem rechecagem individual gradual; ofertas internacionais dependem da amostra futura e podem não ser detectadas.
- Nuuvem: a API https://docs.nuuvem.com/ exige aprovação de parceiro. Não há preços Nuuvem nesta versão.
- Instant Gaming: feed ou API com autorização não verificados; não integrada e não classificada como revendedora oficialmente verificada.
- O CheapShark limita requisições, requer User-Agent e HTTP 429 pode suspender consultas. A integração implementa cache, intervalo e bloqueio temporário.
- Limite de preço máximo do painel administrativo é em BRL: se configurado, exclui notificações USD para evitar conversões artificiais.
- O conjunto de 12 testes locais passou. As consultas de rede e a operação real dependem de validação no deploy da Square Cloud.

## Catalogo por loja (v0.4.1)

- `Outras lojas` abre um seletor com os revendedores autorizados ativos retornados pelo CheapShark.
- Escolhendo Green Man Gaming, GOG, Fanatical ou outra loja ativa, o bot consulta **so as ofertas daquela loja**, com 2 banners por pagina, preco USD, desconto, link e paginacao.
- O primeiro clique busca no CheapShark por `storeID`, `onSale=1` e `pageNumber`; cada lote remoto possui 20 ofertas. Os cliques paginam duas por vez e reutilizam o cache (15 minutos), para reduzir requisicoes.
- As lojas surgem somente quando estiverem ativas na fonte. Catalogos podem ter lacunas e nao sao garantia de disponibilidade para clientes brasileiros.
- Nuuvem aparece marcada como **integracao pendente**: sua API exige chave de parceiro aprovado. Instant Gaming nao esta integrada por falta de fonte autorizada verificada.
