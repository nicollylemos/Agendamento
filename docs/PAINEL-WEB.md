# Painel web (front)

Telas do que a API já faz (Fases 2 e 3). Cada fase nova vai chegar com as telas dela.

## Como abrir

Em dois terminais, na raiz do projeto:

```powershell
npm run dev:api
npm run dev:web
```

Abra http://localhost:5173 e entre com o admin que você criou.

## Telas

| Tela | Endereço | Requisitos |
| --- | --- | --- |
| Login (pede o código só se a pessoa ativou o 2FA) | `/login` | RF01 |
| Esqueci minha senha / nova senha | `/esqueci-senha`, `/redefinir-senha` | RF03 |
| Aceitar convite | `/convite` | RF02 |
| Início: agenda do dia em grade (uma coluna por profissional) + primeiros passos enquanto faltar algo | `/painel` | RF24, RF26 |
| Empresa | `/painel/empresa` | RF06 |
| Site: cores, fontes, logo, banner, textos, seções, galeria, depoimentos, perguntas extras, ordem dos serviços, com prévia (computador/celular) e publicar | `/painel/site` | RF07, RF08, RF10 |
| Serviços, categorias, quem faz, ficha técnica com custo e margem; coluna "No site" diz por que um serviço não aparece | `/painel/servicos` | RF12–RF15 |
| Equipe: cadastrar profissional direto (sem login), dar acesso ao painel com mensagem pronta para o WhatsApp, perfil de acesso, desativar | `/painel/equipe` | RF02, RF05, RF13, 9.2 |
| Estoque: produtos, entrada com prévia do custo médio, baixa, inventário, histórico, alertas | `/painel/estoque` | RF38–RF42 |
| Fidelidade: programa, recompensas, clientes (saldo, extrato, troca, ajuste), conferir e usar voucher | `/painel/fidelidade` | RF43–RF46 |
| Instagram: posts e stories a partir de modelos (serviço, promoção, horários livres, depoimento, equipe, aviso), preenchidos com os dados do sistema; legenda, situação, data e imagem PNG para baixar | `/painel/instagram` | marketing |
| Relatórios: faturamento, sinais, ocupação, serviços, estoque, clientes, fidelidade, comissões; exportar CSV/PDF (o profissional vê só os dele) | `/painel/relatorios` | RF47–RF55 |
| Sinal e Pix: regra do sinal, devolução, recebedor (cifrado, só os 4 últimos), testar e ativar, Pix que precisam de atenção | `/painel/pagamentos` | RF28, RF32, RF34–RF37 |
| Horários: jornada por pessoa, modelos, folgas, bloqueios, prévia de horários livres | `/painel/horarios` | RF16–RF18, RF20 |
| Meus horários (funcionário) | `/painel/meus-horarios` | RF19 |
| Agenda do dia em lista ou grade (todos ou só a própria), novo agendamento, encaixe, remarcar, status, regras | `/painel/agenda` | RF22, RF24–RF26 |
| Landing page da empresa | `/` | RF09, RF11 |
| Site do cliente: agendar (com sinal: QR Code, copia e cola, contador e confirmação automática) | `/agendar` | RF21, RF23, RF29, RF30 |
| Alerta de segurança "não fui eu" | `/seguranca/nao-fui-eu` | RF36 |
| Site do cliente: ver, remarcar, cancelar pelo link | `/meu-agendamento` | RF25 |
| Site do cliente: meus agendamentos e fidelidade (saldo, vouchers, trocar, extrato), com código por e-mail | `/meus-agendamentos` | RF04, RF46 |
| Minha conta: ativar e desativar o 2FA | `/painel/conta` | RF01 |

## Segurança no front

- **Token só em memória** (`src/lib/api.ts`). Nada de `localStorage`: um script
  malicioso injetado na página não consegue roubar a sessão. Ao recarregar, a sessão
  volta pelo cookie httpOnly. (9.1)
- **Uma renovação por vez:** se várias requisições recebem 401 juntas, todas esperam a
  mesma renovação. Sem isso, o mesmo cookie seria enviado duas vezes e a API entenderia
  como roubo. (9.1)
- **Duas abas abertas:** a API tolera 10 s em que o cookie antigo ainda pode chegar de
  outra aba. Só recusa, sem derrubar o login. Fora dessa janela, continua sendo tratado
  como roubo.
- **Botões escondidos por permissão** (`useAuth().pode`), mas quem barra de verdade é a API. (9.2)
- **Trocar perfil de acesso pede senha e 2FA de novo** (tela Equipe). (9.1)
- **Link de acesso só aparece uma vez**, na mensagem para copiar. No banco fica só o hash; vale 48 h e um uso. Se o profissional já tiver sido vinculado, o link não vale mais. (9.1, RF02)
- **Links com token** (convite, senha): o token sai da barra de endereço assim que a
  página abre, e `<meta name="referrer" content="no-referrer">` impede que a URL vaze
  para outros sites.
- **Redirecionamento após login** só aceita caminhos internos do `/painel`
  (evita "open redirect").
- **Fonte servida pelo próprio projeto** (sem Google Fonts), então o navegador do cliente
  não avisa terceiros a cada visita.

## Visual

Minimalista e branco (revisão de 14/10):
- **Cores:** fundo branco, texto e botões principais em grafite (`#26292a`), linhas finas
  (`#ebeae7`) no lugar de sombras. Cor só quando quer dizer algo: erro (vermelho), alerta
  (âmbar) e um pontinho verde em "confirmado/aparece". Gráficos num azul-ardósia discreto.
- **Fonte:** Instrument Sans, uma família só, pesos 400 a 600. Sem caixa alta, sem emoji.
- **Menu lateral branco**, em três grupos (dia a dia, Negócio, Configurações); item ativo com
  fundo cinza bem claro.
- **Situações** em pílulas neutras com um ponto de cor; o texto sempre diz o que é.
- **Site do cliente:** hero só com tipografia, serviços em forma de cardápio (nome, tempo,
  preço e "Agendar") e seções separadas por uma linha. O padrão é grafite + Instrument Sans;
  o admin continua podendo trocar cor, fontes e logo em Site.
- Tudo em `src/index.css` (`@theme`) e `components/ui.tsx`.

### Site (ajuste de 14/10)
- Topo fixo com atalhos para as seções, abertura com foto ao lado (ou só tipografia),
  faixa "Hoje / Onde / Fale com a gente" com aberto ou fechado agora, "Como funciona"
  (3 passos), serviços agrupados por categoria, galeria com a 1ª foto maior, "Antes de vir"
  (políticas de cancelamento e atraso da empresa), horários com o dia de hoje destacado,
  chamada final e botão de agendar fixo no celular. Seções novas entram sozinhas no fim
  da lista de Site (dá para esconder ou mudar a ordem).

### Instagram (posts)
- Permissão `marketing:gerenciar` (admin e gerente). Tabela `posts_instagram`; o conteúdo
  é validado pela API (texto sem tags, só imagens enviadas pelo painel, cores #RRGGBB).
- A arte é desenhada em 1080 px e vira PNG no navegador (`html-to-image`); o que aparece
  na prévia é o que sai. No celular, "Compartilhar" abre a folha do sistema (dá para mandar
  direto ao Instagram). Postar sozinho pelo sistema exigiria conta Business e app da Meta.

### Início e Agenda (ajuste de 14/10)
- **Início** virou um painel: destaque do dia (quantos atendimentos e quem é o próximo),
  ocupação de hoje, meta do mês (a gestão define), serviços mais feitos no mês, lista do dia
  e um minicalendário com os dias que têm atendimento.
- **Agenda** em **Mês / Semana / Dia**, com painel de detalhes ao lado (situação, horário,
  profissional, telefone, valor, sinal, observações e as ações: iniciar, concluir, confirmar
  sem Pix, falta, remarcar, cancelar). A visão, a data e o atendimento ficam na URL.
- **Cores por situação:** aguardando sinal, sinal pago, confirmado, em atendimento,
  concluído, não compareceu e cancelado. O admin troca em Agenda → Regras e cores
  (`config_agenda.cores_agenda`). O nome da situação sempre aparece junto da cor.

## Organização

```
apps/web/src/
  lib/api.ts          cliente da API, sessão e renovação
  lib/formato.ts      moeda (centavos), duração, nomes
  lib/useSalvar.ts    estado de envio e erros por campo
  auth/               contexto de login e permissões
  components/         Botao, Campo, Entrada, Modal, Interruptor…
  layouts/            tela de acesso e painel com menu
  pages/public/       login, convite, senha
  pages/admin/        início, empresa, serviços, equipe
  pages/staff/        minha agenda, minha conta
  routes.tsx          rotas e proteção por login/permissão
```
