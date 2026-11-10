# GameDeals Discord Bot

Bot **100% Discord**, sem site: menu permanente com botões, pesquisas individuais, lista de desejos e avisos automáticos no canal separado `#promocoes-de-jogos`.

## O que já funciona (v0.1)

- Cria `#central-de-jogos` e `#promocoes-de-jogos` automaticamente (com **Gerenciar Canais**), edita/reutiliza o menu antigo quando reinicia e fixa o painel quando possível.
- Menus e formulários: ofertas, pesquisar na Steam, detalhes, acompanhar/deixar de acompanhar, preço-alvo em R$, histórico local, jogos grátis, pacotes, status e administração.
- Verifica **promoções em destaque na Steam** (Brasil) e **jogos temporariamente grátis na Epic Games Store**; envia alertas somente quando identifica novas ofertas ou alterações de preço.
- Preços reais sem conversão fictícia. Exibe a moeda recebida da fonte; verifica se o preço-alvo usa BRL. Consulta as fontes a cada 30 minutos por padrão.
- SQLite local: ofertas, mudanças de preço, preferências dos servidores, lista de desejos, registros de notificações e mensagem principal.
- Notificações privadas por DM para jogos acompanhados com limite de preço (dependem de a DM estar habilitada para o usuário).
- A primeira coleta de **cada fonte** serve para povoar o catálogo **sem anunciar em massa ofertas antigas**. Administradores podem clicar em **Publicar 3 ofertas** para testar o canal.

**Limitações honestas:** a coleta inicial da Steam lista somente ofertas **em destaque**, e não o catálogo completo. A busca da Steam consulta títulos por nome; o endpoint de preços detalhados aceita jogos individuais. Na Epic, o bot acompanha **resgates gratuitos**, não o catálogo geral pago. Ainda não há Nuuvem, GOG, Fanatical, Green Man Gaming, comparação completa entre lojas nem garantia de menor preço histórico absoluto. Esses recursos dependem de integrações confiáveis e do direito de reutilizar os dados. Os endpoints públicos usados pelas lojas não têm garantia de estabilidade.

## Identificadores do projeto

- Discord Application ID: `1569671744803967127`
- Servidor inicial de testes: `1476140209556029462`
- [Convidar GameDeals ao Discord](https://discord.com/oauth2/authorize?client_id=1569671744803967127&permissions=93200&scope=bot) — o convite pede permissões de canais, mensagens, links e fixação. **Não concede administrador**.
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

O SQLite é salvo em `data/gamedeals.db`. Faça backups consistentes, por exemplo com a função de backup do SQLite ou em uma janela sem gravações; **não copie apenas o `.db` enquanto o modo WAL estiver gravando**. A persistência do sistema de arquivos da hospedagem não equivale a backup. A atualização de código não deve substituir a pasta `data/`.

### Observações operacionais

- Cada servidor tem seu próprio canal de promoções e desconto mínimo. O painel mostra as funções para todos, mas o menu Administração só altera dados para pessoas com `Gerenciar Servidor`.
- Uma mensagem no canal principal é reaproveitada pelo seu ID, ou identificada pelas últimas mensagens do bot para evitar duplicação.
- A frequência configurável (`POLL_MINUTES`, mínimo 15) não significa preço em tempo real. As fontes podem estar atrasadas, indisponíveis ou limitadas.
- O histórico registra apenas preços observados **depois** do início do bot.
- Para crescer ou escanear catálogos inteiros, será necessário acrescentar fontes aprovadas, filas, rate limiting aprimorado, migrações e backups automáticos externos.

## Privacidade

Armazenamos identificadores técnicos de servidores e membros apenas para preferências e alertas. Não armazenamos e-mails, mensagens enviadas pelos membros ou credenciais da conta Steam/Epic. Ao remover o bot de um servidor, os dados locais desse servidor não são excluídos automaticamente nesta versão.