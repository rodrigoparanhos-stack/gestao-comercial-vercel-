// Serverless function: lê ao vivo as abas públicas (gviz) da planilha
// "Pós Call - Closers", que o próprio Closer OS já mantém atualizadas
// a cada ~15 min via n8n. Não usa MCP nem credenciais — só HTTP público.

const SHEET_ID = '10VATVqeOKP3KVHS5r_LNgNSBzy53MKO7kBJyjezZEeE';
// Competencias que o dashboard sabe que existem (pro seletor de mes no front). Setembro fica
// pra sempre como historico; outubro e o mes corrente a partir de 2026-10-02. Adicionar o
// proximo mes aqui quando a virada acontecer de novo.
const COMPETENCIAS_DISPONIVEIS = ['2026-09', '2026-10', '2026-11'];
function competenciaAtual_() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
// competencia era fixo em '2026-09' — na virada pra outubro (2026-10-02) o dashboard continuava
// preso em setembro pra sempre sem nenhum jeito de ver o mes corrente. Agora e resolvido por
// request a partir de ?mes=YYYY-MM (selecionado no front) com fallback pro mes corrente, e as
// metas BP Tatico (abaixo) passam a ser por competencia em vez de uma unica constante — mes sem
// meta cadastrada ainda mostra "—" em vez de reaproveitar o numero de outro mes por engano.
// Vendas de e-mails que aparecem no CRM mas não pertencem ao funil comercial da Colli & Co/V4
// (outro time usando a mesma instância). Confirmado por Rodrigo em 2026-09-29 pro caso do
// Grupo 2FUN (marcelo.gomes@v4company.com, sem SDR/canal vinculado — venda real, só não é nossa).
// Só entram aqui e-mails específicos confirmados manualmente; nunca um padrão amplo — qualquer
// outro e-mail "fora do padrão" continua contando normalmente (bucket "Outros").
// sara.pizzico@v4company.com: venda da Nucleo Gremio Sinop (R$4.322, Recovery, sem match no
// Conta Azul) desconsiderada a pedido de Rodrigo em 2026-10-08, mesmo padrão do Grupo 2FUN.
const EXCLUDED_SALE_EMAILS = new Set(['marcelo.gomes@v4company.com', 'sara.pizzico@v4company.com']);

// ---- Metas do BP Tático, por competência — adicionar o mês seguinte aqui na virada ----
// Antes era uma única constante por métrica (META_SDR, META_VENDAS, ...), presa em setembro.
// Virada pra outubro (2026-10-02): Rodrigo ainda não repassou o BP Tático de outubro, então
// esse mês entra com as metas em null — a UI mostra "—" em vez de reaproveitar o número de
// setembro (que seria dado errado) ou quebrar a página. Atualizar a entrada '2026-10' assim
// que o BP Tático do mês chegar.
const METAS_BP_TATICO = {
  '2026-09': {
    sdr: { geral: { leads: 539, rm: 222, rr: 175 },
      individual: { Davi:180, Biazon:160, Tamara:80, Lucas:60, Fausto:47, Vitor:0 } },
    // Historicamente alinhado ao 47 que SDR OS/Closer OS exibiam (ver
    // context/ARQUITETURA-COMERCIAL-OS.md, "Metas de setembro"), mas a planilha BP Tático -
    // Meta Set.csv sempre teve dois números diferentes pra isso (# WONs=49 geral, soma por
    // closer=51) que não batiam nem entre si nem com o 47 — mesmo padrão do gap de Leads
    // (539 vs soma 527), tratado como divergência conhecida em vez de escondido.
    // Corrigido 2026-09-30: Rodrigo reconfirmou pessoalmente via print da BP Tático que o
    // geral oficial é 49 (# WONs), não 47 — SDR OS/Closer OS ficaram desatualizados, não
    // este arquivo.
    vendas: { geral: 49, porCloser: { Rafael: 17, Filipe: 17, Pedro: 10, Herico: 7 } },
    // Meta de R.M/R.R/Vendas por SDR — confirmado 2026-09-16 direto do payload ao vivo do SDR OS
    // (execução real do workflow "SDR OS — Webhook Payload", campo targetsByScope.person; o mesmo
    // número já aparecia na planilha BP Tático - Meta Set.csv sob o nome antigo "Fausto" pra
    // Allison — confirmando que só o Leads daquela linha estava desatualizado, R.M/R.R/Vendas não).
    sdrRmRrVendas: {
      Biazon: { rm: 40, rr: 33, vendas: 9 }, Tamara: { rm: 36, rr: 30, vendas: 9 },
      Davi: { rm: 63, rr: 54, vendas: 16 }, Vitor: { rm: 20, rr: 17, vendas: 5 },
      Lucas: { rm: 29, rr: 24, vendas: 7 }, Fausto: { rm: 34, rr: 27, vendas: 8 },
    },
    holidays: ['2026-09-07'],
    // Meta de Receita M1 VENDIDO (todas as vendas fechadas, ativadas ou não) — fonte:
    // context/ARQUITETURA-COMERCIAL-OS.md, "Closer OS ... Setembro: a visão geral usa
    // 175 R.R, 45 ativações, Receita M1 de R$617.500". NÃO confundir com a meta de Receita
    // M1 ATIVADO (soma de closer_cockpit_metas.meta_receita_m1 = R$716.545) — esses dois
    // números são de fontes diferentes e Vendido < Ativado não faz sentido lógico, então
    // ficam expostos os dois separadamente em vez de um substituir o outro sem checagem.
    receitaVendido: 617500,
    // Meta de Receita M1 ATIVADO por categoria de produto — decompõe os R$716.545 já usados como
    // meta do card "Receita M1 Ativado" (soma de closer_cockpit_metas.meta_receita_m1). Fonte:
    // planilha "BP Tático - 2026" (Drive), bloco "Setembro" → tabela Players, linhas SABER/MRR,
    // coluna Total. Confirmado 2026-09-24: 660.800 (Saber) + 55.745 (Executar/MRR) + 0 (Ter) =
    // 716.545, bate exato com a soma por closer (96.030+138.600+240.100+241.815).
    receitaCategoriaAtivado: { saber: 660800, ter: 0, executar: 55745 },
    // Meta de Receita M1 VENDIDO por categoria — decompõe os R$617.500 (receitaVendido acima).
    // Mesma planilha, bloco esquerdo "$ Receita ... Ativada" (nome confuso na fonte, mas é o
    // bloco que a soma bate com 617.500). Saber 546.000 + Ter 0 + Executar/MRR 71.500 = 617.500.
    receitaCategoriaVendido: { saber: 546000, ter: 0, executar: 71500 },
    // Meta de Ativados (# de logos ativados no mês) — número fixo da BP Tático (45),
    // independente da soma de closer_cockpit_metas.meta_ativados por closer (que dá 51 — meta
    // de comprometimento individual, exposta à parte na seção "Por Closer", nunca usada aqui).
    ativados: 45,
    // Meta de Caixa (dinheiro esperado em conta este mês, projeção Receita M1 × % Pagamento M1
    // da BP Tático) — DIFERENTE da meta de "Receita M1 Ativado" (716.545): aquela é o valor
    // contratado de quem ativa; esta é o fluxo de caixa esperado no mês, já descontando o % que
    // só entra depois. Confirmado por Rodrigo 2026-09-30 via print da BP Tático (célula "Caixa").
    caixa: 481000,
  },
  '2026-10': {
    // BP Tático - 2026 - Outubro.csv, repassado por Rodrigo em 2026-10-08. Fausto = Allison
    // renomeado (mesma pessoa); Tamara saiu do roster ativo de outubro (sem meta), mas continua
    // listada em sdrNomes pra não sumir do histórico de setembro.
    sdr: { geral: { leads: 794, rm: 208, rr: 165 },
      individual: { Davi:180, Lucas:160, Fausto:160, Vitor:200, Biazon:70 },
      // Pedido por Rodrigo em 2026-10-12 (mesmo ajuste já feito no SDR OS/n8n): os 794 da BP
      // Tático somam os 4 canais incluindo Recovery (200) — mas Recovery é lead reciclado/
      // reativação, não geração nova, então o card/funil de Leads desconta esse valor da meta
      // exibida. geral.leads continua 794 (número bruto da fonte, histórico); metaLeads_ abaixo
      // é quem aplica o desconto.
      recoveryLeadsMeta: 200 },
    // vendas.geral = # WONs do funil geral (bloco Total); porCloser = linha "Vendas" do bloco
    // Players por Closer. Mesma divergência conhecida de setembro entre os dois (51 vs soma 46,
    // Hérico contado como 10 por arredondamento confirmado por Rodrigo) — exposta, não escondida.
    // Paulo (closer novo, onboarding em 2026-10-19): meta base era igual a do Herico, mas
    // Rodrigo pediu volume de R.R=20 (em vez de 27) — todo o resto escalado na mesma proporcao
    // (razao 20/27), ver mesma nota em closer_cockpit_metas (Closer OS).
    vendas: { geral: 51, porCloser: { Herico: 10, Pedro: 4, Filipe: 15, Rafael: 17, Paulo: 7 } },
    // R.M/R.R por SDR = linhas "META R.M"/"Meta R.R 100%" do bloco Players SDR. Vendas por SDR
    // não veio na BP Tático de outubro (só a de Closer tem); fica null até o SDR OS ter uma meta
    // individual de vendas configurada (ver sdr_os_targets, scope=person — hoje sem o campo sales
    // pra outubro, então o fallback "meta.vendas || 0" mostra 0 igual aqui).
    sdrRmRrVendas: {
      Davi: { rm: 63, rr: 52, vendas: null }, Lucas: { rm: 56, rr: 46, vendas: null },
      Fausto: { rm: 56, rr: 46, vendas: null }, Vitor: { rm: 15, rr: 11, vendas: null },
      Biazon: { rm: 14, rr: 11, vendas: null },
    },
    // Feriado nacional confirmado (Nossa Senhora Aparecida).
    holidays: ['2026-10-12'],
    // Receita M1 total (linha "Receita M1", coluna Total) = soma exata das 3 categorias abaixo.
    receitaVendido: 633000,
    // Decompõe a meta de Receita M1 ATIVADO (soma de closer_cockpit_metas.meta_receita_m1 =
    // 157.000+56.000+210.000+243.500 = 666.500) nas linhas SABER/MRR do bloco Players por Closer
    // da BP Tático — mesmo método usado em setembro. Revisado 2026-10-08: Rodrigo atualizou os
    // valores financeiros desse bloco (R.R e conversão por closer continuam os mesmos).
    receitaCategoriaAtivado: { saber: 616000, ter: 0, executar: 50500 },
    // Decompõe receitaVendido (633.000) nas linhas "$ Receita Saber/Ter/Executar Ativada" do
    // bloco Total — mesmo método usado em setembro.
    receitaCategoriaVendido: { saber: 573000, ter: 0, executar: 60000 },
    // "# Ativações" do bloco Total — bate exato com a soma de meta_ativados por closer (46).
    ativados: 46,
    // Meta de Caixa: Rodrigo confirmou usar o número do bloco Total (489.750) mesmo com a soma
    // por closer (526.064) divergindo — mesma divergência conhecida, não escondida.
    caixa: 489750,
  },
  '2026-11': {
    // BP Tático - 2026 - Novembro.csv, repassado por Rodrigo em 2026-11-05. Tamara segue fora
    // de individual/sdrRmRrVendas (saiu do roster ativo, mesmo padrão de outubro); a partir deste
    // mês ela também sai de sdrNomes (ver definição de sdrNomes abaixo) - confirmado por Rodrigo
    // 2026-11-07, ela só aparecia como linha zerada aqui. Dois feriados nacionais em dia útil este mês:
    // Finados (02/11) e Consciência Negra (20/11, feriado nacional desde 2024).
    sdr: { geral: { leads: 1234, rm: 219, rr: 168 },
      individual: { Davi:150, Lucas:150, Fausto:60, Vitor:200, Biazon:200 },
      // Lista Fria é canal novo este mês (600 MQL) — leads não entram no CRM nesse formato,
      // então, igual ao Recovery, fica fora da meta de "ideal-dia" (ver listaFriaLeadsMeta em
      // metaLeads_ acima). Aparece como meta visível em outros lugares do dashboard, só não
      // conta pro pace de leads do time. Confirmado por Rodrigo 2026-11-05.
      recoveryLeadsMeta: 200, listaFriaLeadsMeta: 600 },
    // vendas.geral = # WONs do funil geral (bloco Total); porCloser = linha "Vendas" do bloco
    // Players por Closer, que exclui Paulo da soma (mesma divergência conhecida dos meses
    // anteriores — exposta, não escondida).
    vendas: { geral: 48, porCloser: { Herico: 2, Pedro: 10, Filipe: 13, Rafael: 15, Paulo: 10 } },
    // R.M/R.R por SDR = linhas "META R.M"/"Meta R.R 100%" do bloco Players SDR. Vendas por SDR
    // não veio na BP Tático de novembro (só a de Closer tem), mesmo padrão de outubro.
    sdrRmRrVendas: {
      Davi: { rm: 53, rr: 42, vendas: null }, Lucas: { rm: 53, rr: 42, vendas: null },
      Fausto: { rm: 33, rr: 26, vendas: null }, Vitor: { rm: 18, rr: 14, vendas: null },
      Biazon: { rm: 18, rr: 14, vendas: null },
    },
    holidays: ['2026-11-02', '2026-11-20'],
    // Receita M1 total (linha "Receita M1", coluna Total do bloco de canais) = soma exata das
    // 3 categorias de receitaCategoriaVendido abaixo.
    receitaVendido: 602000,
    // Decompõe a meta de Receita M1 ATIVADO (soma de closer_cockpit_metas.meta_receita_m1,
    // EXCLUINDO Paulo da soma — mesmo método de outubro — linhas SABER/MRR do bloco Players por
    // Closer, coluna Total: 526.000 + 0 + 37.500 = 563.500).
    receitaCategoriaAtivado: { saber: 526000, ter: 0, executar: 37500 },
    // Decompõe receitaVendido (602.000) nas linhas "$ Receita Saber/Ter/Executar Ativada" do
    // bloco de canais, coluna Total — mesmo método usado nos meses anteriores.
    receitaCategoriaVendido: { saber: 566000, ter: 0, executar: 36000 },
    // "# Ativações" do bloco de canais, coluna Total. Diferente da soma de meta_ativados por
    // closer (vendas.porCloser acima, 40 excl. Paulo) — divergência conhecida, não escondida.
    ativados: 42,
    // Meta de Caixa: linha "Caixa" do bloco de investimento/topo (projeção Receita M1 × %
    // Pagamento M1 da BP Tático), não a soma de META CAIXA por closer (450.800) — mesmo critério
    // usado em setembro/outubro.
    caixa: 508300,
  },
};
// Metas vazias pra qualquer competência fora do mapa acima (selecionada via ?mes= antes de eu
// cadastrar o mês) — nunca derruba a página, só mostra tudo em "—".
const METAS_VAZIAS_ = { sdr: null, vendas: null, sdrRmRrVendas: null, holidays: [], receitaVendido: null, receitaCategoriaAtivado: null, receitaCategoriaVendido: null, ativados: null, caixa: null };
function metasDoMes_(competencia) {
  return METAS_BP_TATICO[competencia] || METAS_VAZIAS_;
}
// Canal de origem "primário" de cada SDR pra leads Inbound — confirmado pelo mesmo payload
// (targetsByScope.channel bate com isso) e pela coluna "Tier" da BP Tático - Meta Set.csv
// (Rec+Blackbox / Blackbox+Rcv / Blackbox / Rcv / Blackbox+Rcv / Leadbroker+Rcv). Cada SDR
// (exceto Vitor, que é 100% Recovery) trabalha só UM canal de lead-gen Inbound — então dá pra
// resolver Blackbox vs Leadbroker com certeza pelo SDR, sem precisar do join por nome de
// empresa. Usado só como fallback quando o join não resolve (ver canal5()).
const SDR_PRIMARY_CHANNEL = { Davi: 'Blackbox', Tamara: 'Blackbox', Biazon: 'Blackbox', Lucas: 'Blackbox', Fausto: 'Leadbroker' };
function computeDiasUteisDecorridos(competencia, holidays) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  const [cy, cm] = competencia.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const todayInMonth = todayStr.slice(0, 7) === competencia;
  const cutoffDay = todayInMonth ? Number(todayStr.slice(8, 10)) : lastDayOfMonth;
  let count = 0;
  for (let d = 1; d <= Math.min(cutoffDay, lastDayOfMonth); d++) {
    const dateStr = `${competencia}-${String(d).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(cy, cm - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.includes(dateStr)) continue;
    count++;
  }
  return count;
}
// Total de dias úteis do mês inteiro (não só os decorridos) — antes era uma constante
// (PACE_DU_TOTAL=21) que só valia pra setembro; agora calculado pra qualquer mês, mesma lógica
// de computeDiasUteisDecorridos mas sem o corte em "hoje".
function computeTotalDiasUteis_(competencia, holidays) {
  const [cy, cm] = competencia.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= lastDayOfMonth; d++) {
    const dateStr = `${competencia}-${String(d).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(cy, cm - 1, d)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.includes(dateStr)) continue;
    count++;
  }
  return count;
}
// e-mails confirmados por cruzamento de dados reais em 2026-09-16 (closer_cockpit_sales.sdr
// vem em e-mail, closer_cockpit_calls.sdr vem em primeiro nome — union por empresa+mês).
// Fausto = mesma pessoa que aparecia como "Allison" até setembro/2026 (e-mail não mudou) —
// nome corrigido a pedido de Rodrigo em 2026-10-08.
const SDR_EMAIL = { Davi: 'davioliveira@v4company.com', Tamara: 'tamara.ferreira@v4company.com',
  Biazon: 'henrique.biazon@v4company.com', Lucas: 'lucasqueiroz@v4company.com',
  Fausto: 'alisson.eduardo@v4company.com', Vitor: 'vitorbeloni@v4company.com' };
const EMAIL_SDR = Object.fromEntries(Object.entries(SDR_EMAIL).map(([n, e]) => [e, n]));
function sdrFirstName(row) { return row.sdr && EMAIL_SDR[row.sdr] ? EMAIL_SDR[row.sdr] : row.sdr; }

function gvizUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.length > 1 || r[0]).map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
    return obj;
  });
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || parseFloat(v) || 0;
}
// "Ativado" = fez o 1º pagamento (qualquer parcela), e a partir daí conta o valor CONTRATADO
// inteiro (receita_m1), não a parcela isolada — regra revista com Rodrigo em 2026-10-12: um
// boleto 3x de R$12.000 conta R$12.000 em Ativado assim que a 1ª parcela de R$4.000 confirma,
// mesmo as outras duas ainda não tendo entrado. Isso é diferente de Caixa (soma real do que já
// entrou no Conta Azul, parcela por parcela — ver m1Total/Caixa). Substitui a regra anterior
// (17/09, caso Interpharma) que usava valor_pago_conta_azul aqui — aquele caso era sobre Caixa,
// não Ativado; a distinção entre os dois não estava clara ainda naquele momento.
function receitaAtivadaValor(r) {
  return toNum(r.receita_m1);
}
// Rótulos de forma de pagamento — mesmos códigos usados pelo CRM (closer_cockpit_sales.forma_pagamento
// e o snapshot do Closer OS trazem o mesmo enum).
const FORMA_PAGAMENTO_LABEL = { CREDIT_CARD: 'Cartão', BILLET: 'Boleto', PIX: 'Pix', BANK_CHECK: 'Cheque', BOLETO: 'Boleto' };
function formaLabel(v) { const k = String(v || '').toUpperCase().trim(); return FORMA_PAGAMENTO_LABEL[k] || (v || '—'); }
// Ticket médio M1 de uma categoria de produto (Saber/Ter/Executar) — média do valor da categoria
// só entre as vendas que TÊM aquele componente (valor>0), não uma média diluída por todas as vendas.
function ticketMedioCategoria(rows, field) {
  const vals = rows.map(r => toNum(r[field])).filter(v => v > 0);
  return { valor: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, n: vals.length };
}

async function fetchSheet(sheet) {
  const res = await fetch(gvizUrl(sheet), { cache: 'no-store' });
  if (!res.ok) throw new Error('gviz fetch failed for ' + sheet + ': ' + res.status);
  const text = await res.text();
  return parseCSV(text);
}

// ---------- R.F (reuniões futuras): fonte bruta da aba "Reuniões" do SDR OS ----------
// Corrigido em 2026-11-02: o R.F vinha de sdrOsLive.meetings (payload do webhook SDR OS),
// que no dia estava mostrando 7 reuniões futuras quando a aba "Reuniões" (fonte do próprio
// SDR OS) já tinha 17 linhas com reunião marcada pra frente — confirmadas uma a uma com o
// Rodrigo contra a agenda real (Distribuidora Minas Flor, Suporte Smart, Magna Box, Vivo,
// Atrys, entre outras). Das 17, 13 ainda não tinham Closer preenchido — e isso é normal
// (closer é atribuído depois do agendamento, às vezes no mesmo dia da call, confirmado com
// Rodrigo), não deveria nunca ter sido motivo pra sumir da contagem. Em vez de tentar
// consertar o payload do SDR OS (fora do nosso controle aqui), o R.F agora lê direto a
// mesma planilha operacional que o SDR OS usa (Reuniões), sem depender de Closer estar
// preenchido nem do mês da competência selecionada (uma reunião qualificada em outubro com
// data marcada pra novembro continua contando).
const SDR_OPERATIONAL_SHEET_ID = '1SrlBImYmQv1Be-8cwNegGZhi3vaQl9AYfw9ilbXYuV8';
function sdrOperationalGvizUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${SDR_OPERATIONAL_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
}
async function fetchReunioesFuturas() {
  const res = await fetch(sdrOperationalGvizUrl('Reuniões'), { cache: 'no-store' });
  if (!res.ok) throw new Error('gviz fetch failed for Reuniões: ' + res.status);
  const text = await res.text();
  return parseCSV(text);
}
// "Dia Qualifação"/"Dia Da Reunião" vêm como texto "DD/MM/AAAA" — converte pra "AAAA-MM-DD"
// pra comparar com todayStr (mesmo formato usado no resto do arquivo).
function parseBrDate_(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ---------- CANAL: regra de negócio fixa (5 canais reais da operação) ----------
// closer_cockpit_calls/sales não trazem lead_id preenchido (buraco confirmado na origem),
// então não dá pra cruzar com a planilha de leads por id. O que É confiável nas duas fontes:
// - canal nativo do CRM (Inbound/Outbound/Recomendação) — sempre presente.
// - nome da empresa — cruza com a planilha de leads (que tem canal_aquisicao) com ~89% de acerto 1:1.
// Regra, nessa ordem (fixa — não reordena nem some de mês pra mês):
//   1) SDR = Vitor (calls) ou e-mail vitorbeloni@ (sales)  -> Recovery (motion de reativação, meta própria)
//   2) canal nativo = Recomendação                          -> Recomendação
//   3) canal nativo = Outbound                               -> Indicação
//   4) canal nativo = Inbound + empresa casa 1:1 com a planilha de leads -> Blackbox ou Leadbroker
//   5) qualquer coisa que não bateu -> "Inbound (não classificado)" (mostrado, nunca escondido)
// Planilha de leads (INBOUND only — Outbound/Recomendação não passam por aqui, são board direto do CRM).
// Dá 3 coisas: (a) join por nome de empresa pra classificar R.R/Vendas dos closers nos 5 canais;
// (b) Leads/R.M por canal_aquisicao ao vivo (contagem direta, sem join, só pra Blackbox/Leadbroker/Recovery);
// (c) Leads/R.M por tier_lp ao vivo (mesma ressalva: só cobre a parte Inbound).
const LEADS_SHEET_ID = '1dki7sCnyNMqwgEYoPlxM0TDKRzXBjvFRkxc7qOdLeRo';
// Lista Fria (canal novo de novembro/2026, frente de prospecção fria SDR-led): distinguível no
// CRM via acquisition_channel="Prospecção Fria" (nunca via board, que fica "Outbound" igual
// Recovery/Indicação). Achado por Rodrigo 2026-11-06 ("Por canal" sem Lista Fria nenhuma, apesar
// de já ter R.M/R.R reais). Leads/R.M vêm do SDR OS (sdrOsChannelAgg, já ajustado lá pra ler
// acquisition_channel); R.R/Vendas aqui ainda dependem de CANAL_AQUISICAO_OVERRIDES por nome de
// empresa (ver abaixo) porque closer_cockpit_calls não carrega acquisition_channel.
const CANAL5_ORDER = ['Blackbox', 'Leadbroker', 'Indicação', 'Recomendação', 'Recovery', 'Lista Fria'];
const CANAL5_COLOR = { Blackbox: 'var(--accent)', Leadbroker: 'var(--info)', 'Indicação': 'var(--safe)', 'Recomendação': 'var(--care)', Recovery: '#8B5CF6', 'Lista Fria': '#38BDF8', 'Inbound (não classificado)': 'var(--muted)' };
const TIER_LP_MAP = { tiny: 'tiny', small: 'small', medium: 'medium', large: 'large', enterprise: 'enterprise' };
function normName(s) { return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
// normNameTokens: mesma normalização mas preserva fronteira de palavra (espaço em vez de colar
// tudo) — usado só pro fallback substring do resolveByName/buildNameIndex abaixo, pra não deixar
// uma palavra de uma empresa colar com o início de outra por acidente (ver bug real 2026-11-11:
// "Suporte Smart Mogi-Gaçu-Centro" virava "suportesmartmogigacucentro" colado, que CONTÉM
// "portesmart" como substring pura coincidência de "suPORTE"+"SMART" — e um lead curto/lixo
// chamado literalmente "Porte Smart" (canal errado) batia nisso, classificando a venda errado
// como Leadbroker quando o CRM confirma Blackbox). Tokens com <3 letras são descartados (corta
// sufixo tipo "ltda"/"me"/iniciais soltas tipo "S"/"B" que geravam falso-positivo igual).
function normNameTokens(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length >= 3);
}
// Um candidato só entra no índice de substring se tiver substância: 1 token de 6+ letras, ou 2+
// tokens de 3+ (mesmo espírito do limite de 6 caracteres antigo, mas por palavra não por string
// colada — admite "Porte Smart" (2 tokens) como candidato, mas o match em si exige subset exato
// de tokens, não substring cru, então "Porte Smart" nunca mais bate em "Suporte Smart...").
function tokensQualify(tokens) {
  if (!tokens.length) return false;
  if (tokens.length >= 2) return true;
  return tokens[0].length >= 6;
}
async function fetchLeadsSheet() {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${LEADS_SHEET_ID}/gviz/tq?tqx=out:csv`, { cache: 'no-store' });
  if (!res.ok) throw new Error('gviz fetch failed for leads sheet: ' + res.status);
  const text = await res.text();
  return parseCSV(text);
}
// Bug real corrigido em 16/09: "Gomarine Corp" (venda) vs "GoMarine" (planilha de leads) não batiam no
// match exato (sufixo de razão social), e a venda caía em "Inbound (não classificado)" — mas o canal
// era Leadbroker de verdade. Fix: depois do match exato, tenta substring nos dois sentidos, só quando o
// nome normalizado tem 6+ caracteres (evita falso-positivo com nome de empresa curto tipo "M"/"S"/".")
// e só quando todos os candidatos batidos concordam no mesmo canal_aquisicao (senão fica ambíguo mesmo).
// Índice genérico nome-de-empresa -> valor de um campo da planilha de leads (usado pra
// canal_aquisicao E, com a mesma lógica exata+substring, pra tier_lp — ver resolveTier()).
function buildNameIndex(rows, field) {
  const byName = {};
  rows.forEach(r => {
    const k = normName(r.company_name);
    if (!k) return;
    const v = r[field];
    if (!v) return;
    (byName[k] = byName[k] || []).push(v);
  });
  const exact = {};
  const sub = [];
  Object.keys(byName).forEach(k => {
    const vals = [...new Set(byName[k])];
    if (vals.length !== 1) return; // nome repetido com valores diferentes na fonte -> não usa nem exato nem substring
    exact[k] = vals[0];
  });
  // tokensByName: um candidato de fallback por EMPRESA (não por linha), já que várias linhas da
  // planilha podem repetir o mesmo nome — mesma regra de "só usa se o valor for único" do exact.
  const tokensByName = {};
  rows.forEach(r => {
    const k = normName(r.company_name);
    if (!k || tokensByName[k]) return;
    const v = r[field];
    if (!v) return;
    tokensByName[k] = { tokens: normNameTokens(r.company_name), vals: new Set() };
  });
  rows.forEach(r => {
    const k = normName(r.company_name);
    const v = r[field];
    if (!k || !v || !tokensByName[k]) return;
    tokensByName[k].vals.add(v);
  });
  Object.values(tokensByName).forEach(entry => {
    if (entry.vals.size !== 1) return;
    if (!tokensQualify(entry.tokens)) return;
    sub.push([entry.tokens, [...entry.vals][0]]);
  });
  return { exact, sub };
}
function resolveByName(empresa, index) {
  const k = normName(empresa);
  if (!k) return null;
  if (index.exact[k]) return index.exact[k];
  const queryTokens = normNameTokens(empresa);
  if (!tokensQualify(queryTokens)) return null;
  const qSet = new Set(queryTokens);
  const hits = index.sub.filter(([candTokens]) => {
    const cSet = new Set(candTokens);
    // subset num sentido ou no outro, nunca por substring de caracteres colados — token inteiro
    // tem que bater com token inteiro (corrige o falso-positivo "Porte Smart" em "Suporte Smart...").
    const candInQuery = candTokens.every(t => qSet.has(t));
    const queryInCand = queryTokens.every(t => cSet.has(t));
    return candInQuery || queryInCand;
  });
  const vals = [...new Set(hits.map(h => h[1]))];
  return vals.length === 1 ? vals[0] : null;
}
// Leads/R.M ao vivo por canal_aquisicao, só pra quem tem fonte Inbound (Blackbox/Leadbroker/Recovery).
function leadsRmByCanal(rows, competencia) {
  const agg = {};
  const touch = k => (agg[k] = agg[k] || { leads: 0, rm: 0 });
  rows.forEach(r => {
    if ((r.dt_cadastro_lead || '').startsWith(competencia)) touch(r.canal_aquisicao).leads++;
    if ((r.dt_primeira_reuniao_marcada || '').startsWith(competencia)) touch(r.canal_aquisicao).rm++;
  });
  return agg;
}
function leadsRmByTier(rows, competencia) {
  const agg = {};
  const touch = k => (agg[k] = agg[k] || { leads: 0, rm: 0 });
  rows.forEach(r => {
    const k = TIER_LP_MAP[(r.tier_lp || '').toLowerCase()] || 'semtier';
    if ((r.dt_cadastro_lead || '').startsWith(competencia)) touch(k).leads++;
    if ((r.dt_primeira_reuniao_marcada || '').startsWith(competencia)) touch(k).rm++;
  });
  return agg;
}
function isVitor(row) { return sdrFirstName(row) === 'Vitor'; }
// Corrigido 2026-09-16: 4 vendas caíam em "não classificado" mesmo sendo de SDRs com canal
// Inbound único e conhecido (Davi/Biazon só trabalham Blackbox). O join por nome de empresa
// continua sendo a primeira tentativa (é o único jeito de pegar Recovery fora do Vitor), mas
// agora, quando ele não resolve, cai no canal primário do SDR em vez de "não classificado" —
// ver SDR_PRIMARY_CHANNEL acima.
// Corrigido 2026-09-17: venda recém-fechada (Tukka's) chegou com sdr E canal vazios na fonte —
// campo que o CRM só preenche um pouco depois do fechamento, não algo que dá pra evitar na
// origem. Antes, só tentava o cruzamento por empresa quando canal==='Inbound' literalmente;
// canal vazio caía direto em "não classificado" sem nem tentar. Agora trata canal vazio do
// mesmo jeito que Inbound (é o cenário mais provável pra uma venda nova sem canal ainda) — só
// desiste de verdade se nem o cruzamento por nome nem o canal primário do SDR resolverem.
// Overrides manuais de Canal de aquisição — mesmo padrão do manualPaidOverrides já usado no
// n8n (Closer OS), só que pra canal em vez de pagamento. Necessário porque o campo real
// "Canal de aquisição" do CRM (Blackbox/Leadbroker/Recovery/Indicação/Evento) não é sincronizado
// pra nenhuma fonte que esse arquivo acessa fora do Inbound (confirmado 2026-10-02, dump completo
// de campos de consultar_leads_crm/sales_crm/consultar_ops_crm, nenhuma tem o campo pra
// Outbound/Recomendação) — a regra mecânica (Outbound+SDR≠Davi=Recovery) é só uma aproximação e
// já foi provada errada (Princess Presentes é Outbound+Alleson Santos mas o CRM diz Indicação,
// não Recovery — print do Rodrigo). Até alguém expor esse campo na sincronização CRM→BigQuery,
// confirmações pontuais do Rodrigo (vendo o card no CRM) entram aqui. Chave = nome da empresa
// normalizado (normName), case/acento-insensível.
const CANAL_AQUISICAO_OVERRIDES = [
  // confirmado por Rodrigo 2026-10-02 via print do CRM (campo "Canal de aquisição" real) —
  // chave por substring normalizado (sem acento/maiúsculas/sufixo), igual resolveByName, pra
  // não quebrar por causa de "LTDA"/variação de nome entre as fontes.
  { nome: normName('Princess Presentes'), canal: 'Indicação' },
  // Nutrema entrou como "Recomendação" no CRM por erro de cadastro (confirmado por Rodrigo
  // 2026-10-02) — é Indicação de verdade, mas ele não tem como corrigir direto no CRM.
  { nome: normName('Nutrema'), canal: 'Indicação' },
  // Zilix caía em "Inbound (não classificado)" (sem match no cruzamento por nome com a
  // planilha de leads) — Rodrigo confirmou 2026-10-02 que é Leadbroker.
  { nome: normName('Zilix'), canal: 'Leadbroker' },
  // Casemaq (SDR Lucas) e InfoTech (SDR Fausto) caíam em Blackbox (canal primário do SDR,
  // fallback de SDR_PRIMARY_CHANNEL) porque o lead foi movimentado errado no CRM — são
  // Recovery de verdade. Confirmado por Rodrigo 2026-10-28.
  { nome: normName('Casemaq'), canal: 'Recovery' },
  { nome: normName('InfoTech'), canal: 'Recovery' },
  // DLOOK BAY LOJA DANI LTDA (SDR Fausto): sem match na planilha de leads, caía no fallback
  // SDR_PRIMARY_CHANNEL['Fausto']='Leadbroker' — mas o CRM (consultado direto via localize_crm)
  // confirma acquisition_channel='Blackbox' pra essa OP. Achado por Rodrigo 2026-11-11
  // perguntando "tem certeza que o canal é leadbroker?" sobre as vendas de Leadbroker do mês.
  { nome: normName('DLOOK BAY LOJA DANI LTDA'), canal: 'Blackbox' },
  // Lista Fria (prospecção fria, novo canal de novembro/2026) — todos os leads caem em
  // board="Outbound" no CRM, igual Recovery, então sem override viram Recovery aqui (mesmo tipo
  // de confusão corrigido no SDR OS 2026-11-06 via acquisition_channel). closer_cockpit_calls
  // não carrega acquisition_channel, então o cruzamento aqui é por nome de empresa, igual
  // Casemaq/InfoTech acima — atualizar esta lista conforme novos leads de Lista Fria avançam
  // pra R.R/venda (confirmados via CRM em 2026-11-06: Ricardo Sant Anna/Tecway, Ari de
  // Souza/Gram Clip, Danton/Group Door já realizados; Marcelo Mendes/MGI, Tiago De
  // Oliveira/TDM, Profam ainda não realizados mas incluídos pra quando realizarem).
  { nome: normName('Tecway'), canal: 'Lista Fria' },
  { nome: normName('Gram Clip'), canal: 'Lista Fria' },
  { nome: normName('Group Door'), canal: 'Lista Fria' },
  { nome: normName('MGI Metalurgica'), canal: 'Lista Fria' },
  { nome: normName('TDM Automação'), canal: 'Lista Fria' },
  { nome: normName('Profam'), canal: 'Lista Fria' },
  // Mais 2 de Lista Fria (mesmo padrão acima, confirmados via CRM em 2026-11-12):
  // CORREAMAQ e Clínica Dr. Agnaldo Lima (SDR Vitor, acquisition_channel="Prospecção Fria").
  { nome: normName('CORREAMAQ'), canal: 'Lista Fria' },
  { nome: normName('Clinica Dr Agnaldo Lima'), canal: 'Lista Fria' },
  // Indicação não é exclusividade do Davi: Fausto (SDR) também tem leads confirmados no CRM com
  // acquisition_channel="Indicação" (Indicação de Investidor/Parceiro) vindos do board Outbound —
  // a regra "Outbound + SDR≠Davi = Recovery" jogava esses 3 pra Recovery por engano. Rodrigo
  // perguntou 2026-11-12 "não tivemos nenhuma realizada de indicação?" e tinha razão: tinha sim,
  // 3, só contadas no canal errado. Confirmado direto no CRM (acquisition_channel) via localize_crm
  // /consultar_leads_crm — essas 3 são as únicas de Indicação-via-Fausto resolvidas em novembro.
  { nome: normName('Arranjo Express Brasil'), canal: 'Indicação' },
  { nome: normName('Hi-Teck Audio e Video'), canal: 'Indicação' },
  { nome: normName('Aline Parente Psicologia'), canal: 'Indicação' },
];
function canal5(row, leadsCanalIndex) {
  const empresaNorm = normName(row.empresa);
  if (empresaNorm) {
    const override = CANAL_AQUISICAO_OVERRIDES.find(o => empresaNorm.includes(o.nome) || o.nome.includes(empresaNorm));
    if (override) return override.canal;
  }
  if (isVitor(row)) return 'Recovery';
  if (row.canal === 'Recomendação' || row.canal === 'Recomendacao') return 'Recomendação';
  // Outbound só é "Indicação" pro Davi — pra qualquer outro SDR (incluindo fora do roster,
  // ex. Alleson Santos) é motion de recuperação de lead frio, não indicação nova. Mesma regra
  // já usada no SDR OS (canonicalChannel: outbound → player==='Davi' ? 'Indicação' : 'Recovery')
  // que o Gestão Comercial não tinha replicado — Rodrigo pegou isso 2026-10-02 com exemplos
  // reais (Stark Engenharia/Lucas, NOIX Premium/Alleson Santos, ambos Outbound mapeando errado
  // pra Indicação em vez de Recovery).
  if (row.canal === 'Outbound') return sdrFirstName(row) === 'Davi' ? 'Indicação' : 'Recovery';
  if (row.canal === 'Inbound' || !row.canal) {
    const aquis = resolveByName(row.empresa, leadsCanalIndex);
    if (aquis === 'Blackbox' || aquis === 'Leadbroker' || aquis === 'Recovery') return aquis;
    const primary = SDR_PRIMARY_CHANNEL[sdrFirstName(row)];
    if (primary) return primary;
    return 'Inbound (não classificado)';
  }
  return 'Inbound (não classificado)';
}
// Backfill de tier: closer_cockpit_calls/sales só tem o campo tier preenchido em ~37% dos R.R
// (checado ao vivo: 24/65) — a fonte trava vazio no resto, não é bug daqui. A planilha de leads
// tem tier_lp quase sempre preenchido pro lado Inbound; usamos o mesmo cruzamento por nome de
// empresa (mesma regra/risco do canal) só como fallback quando o campo nativo vem vazio.
const TIER_LP_TO_KEY = { tiny: 'tiny', small: 'small', medium: 'medium', large: 'large', enterprise: 'enterprise' };
function resolveTier(row, tierIndex) {
  if (row.tier) return row.tier.toLowerCase();
  const lp = resolveByName(row.empresa, tierIndex);
  return TIER_LP_TO_KEY[(lp || '').toLowerCase()] || null;
}

function money1(n) { return n; }

export default async function handler(req, res) {
  try {
    // Competência vem de ?mes=YYYY-MM (seletor no front) — valida o formato e cai pro mês
    // corrente se vier vazio/inválido. Nunca deixa a página presa num mês fixo de novo.
    const mesPedido = String((req.query || {}).mes || '').trim();
    const competencia = /^\d{4}-\d{2}$/.test(mesPedido) ? mesPedido : competenciaAtual_();
    const metaMes = metasDoMes_(competencia);
    // vendas e representativo de "BP Tatico cadastrado" — fica null ate eu preencher
    // METAS_BP_TATICO[competencia] com os numeros reais do mes.
    const metasPendentes = metaMes.vendas == null;
    const META_SDR = metaMes.sdr;
    const META_VENDAS = metaMes.vendas;
    const META_SDR_RM_RR_VENDAS = metaMes.sdrRmRrVendas || {};
    const META_RECEITA_VENDIDO = metaMes.receitaVendido;
    const META_RECEITA_CATEGORIA_ATIVADO = metaMes.receitaCategoriaAtivado;
    const META_RECEITA_CATEGORIA_VENDIDO = metaMes.receitaCategoriaVendido;
    const META_ATIVADOS = metaMes.ativados;
    const META_CAIXA = metaMes.caixa;
    // Calculado a cada request (não no carregamento do módulo) — serverless functions ficam
    // "quentes" entre requests, então um valor calculado só na inicialização travaria no dia
    // do cold start em vez de acompanhar o dia real.
    const PACE = { du: computeDiasUteisDecorridos(competencia, metaMes.holidays), duTotal: computeTotalDiasUteis_(competencia, metaMes.holidays) };
    const [sales, calls, metas, leadsRows, sdrOsLive, closerSnapshot, reunioesRows] = await Promise.all([
      fetchSheet('closer_cockpit_sales'),
      fetchSheet('closer_cockpit_calls'),
      fetchSheet('closer_cockpit_metas'),
      fetchLeadsSheet().catch(() => []), // se a planilha de leads falhar, Inbound cai todo em "não classificado" e sem Leads/R.M vivo (nunca quebra a página)
      // Payload real do SDR OS (mesma fonte que o produto SDR OS usa) — sem isso a seção
      // "Por SDR" caía pra números estáticos/derivados de outra planilha e divergia do SDR
      // OS de verdade (Rodrigo pegou isso em 2026-09-21: "SDR OS - Totalmente errado"). Se o
      // endpoint falhar, cai pro fallback estático abaixo em vez de quebrar a página.
      fetch('https://n8n-v4.services2.collieassociados.com/webhook/sdr-os-cockpit-fresh-c72e91?competencia=' + competencia, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      // Só pro selo de "atualizado há X min" (generatedAt) — não usado pra nenhum número,
      // closer_cockpit_sales/calls (as planilhas acima) continuam a fonte dos valores.
      // Adicionado 2026-09-21: Rodrigo pediu visibilidade de defasagem em vez de precisar
      // notar um número errado primeiro pra gente investigar depois.
      fetch('https://n8n-v4.services2.collieassociados.com/webhook/closer-os-crm-ca/snapshot-fresh-b91a2c?competencia=' + competencia, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      // R.F (reuniões futuras) — fonte bruta da aba "Reuniões", ver nota em fetchReunioesFuturas
      // acima. Se falhar, cai pro cálculo antigo via sdrOsLive.meetings (nunca quebra a página).
      fetchReunioesFuturas().catch(() => null),
    ]);
    const leadsCanalIndex = buildNameIndex(leadsRows, 'canal_aquisicao');
    const leadsTierIndex = buildNameIndex(leadsRows, 'tier_lp');
    const canalLeadsRmAgg = leadsRmByCanal(leadsRows, competencia);
    const tierLeadsRmAgg = leadsRmByTier(leadsRows, competencia);

    const salesMonth = sales.filter(r => r.competencia === competencia
      && !EXCLUDED_SALE_EMAILS.has(String(r.closer || '').toLowerCase())
      && !EXCLUDED_SALE_EMAILS.has(String(r.sdr || '').toLowerCase()));
    const rrMonth = calls.filter(r => r.competencia_rr === competencia && r.reuniao_realizada === 'SIM');
    const metasMonth = metas.filter(r => r.competencia === competencia);

    // ---------- CLOSERS ----------
    // R.R por closer: preferir closerSnapshot.byCloser (mesmo motivo do rrTotal acima) em vez de
    // contar linhas de closer_cockpit_calls — essa planilha parou de receber linhas novas depois
    // da migração do Closer OS pro workflow BQ v3 (workflow antigo desligado 2026-10-27), então
    // pra qualquer mês que inclua dias depois disso o rrMonth.filter() fica muito abaixo do real
    // (Rodrigo pegou isso em 2026-11-10: R.R total 115 no funil, só 20 somando os closers aqui).
    // Fallback pro cálculo antigo só se o snapshot não vier.
    const closerNames = ['Rafael', 'Filipe', 'Pedro', 'Herico', 'Paulo'];
    const closerLabel = { Rafael: 'Rafael', Filipe: 'Filipe', Pedro: 'Pedro', Herico: 'Hérico', Paulo: 'Paulo' };
    const byCloserSnapshot = closerSnapshot && closerSnapshot.byCloser ? closerSnapshot.byCloser : null;
    const closers = closerNames.map(name => {
      const rr = byCloserSnapshot && byCloserSnapshot[name]
        ? toNum(byCloserSnapshot[name].rr)
        : rrMonth.filter(r => r.closer === name).length;
      const mySales = salesMonth.filter(r => r.closer === name);
      const vendas = mySales.length;
      const vendida = mySales.reduce((a, r) => a + toNum(r.receita_m1), 0);
      const ativ = mySales.filter(r => r.ativado === 'SIM').length;
      const m1 = mySales.filter(r => r.ativado === 'SIM').reduce((a, r) => a + receitaAtivadaValor(r), 0);
      const meta = metasMonth.find(m => m.closer === name) || {};
      return {
        nome: closerLabel[name], rr, rrMeta: toNum(meta.meta_rr),
        ativ, ativMeta: toNum(meta.meta_ativados),
        m1, m1Meta: toNum(meta.meta_receita_m1),
        vendas, vendida, vendasMeta: (META_VENDAS && META_VENDAS.porCloser[name]) || 0,
      };
    });
    // "Outros" — qualquer R.R/venda de um closer fora do roster fixo (ex.: Rodrigo Paranhos
    // fechando um negócio pontualmente). Antes ficava fora da seção "Por Closer" inteira e não
    // somava no total ali (o funil geral já contava certo, só essa seção que excluía) — Rodrigo
    // percebeu isso com uma venda do Berkan/Rodrigo Paranhos. Nunca esconder, sempre somar.
    const outrosRR = rrMonth.filter(r => !closerNames.includes(r.closer));
    const outrosSales = salesMonth.filter(r => !closerNames.includes(r.closer));
    const outrosRRCountCloser = byCloserSnapshot
      ? Object.keys(byCloserSnapshot).filter(k => !closerNames.includes(k)).reduce((a, k) => a + toNum(byCloserSnapshot[k].rr), 0)
      : outrosRR.length;
    if (outrosRRCountCloser || outrosSales.length) {
      const ativ = outrosSales.filter(r => r.ativado === 'SIM').length;
      closers.push({
        nome: 'Outros', rr: outrosRRCountCloser, rrMeta: 0,
        ativ, ativMeta: 0,
        m1: outrosSales.filter(r => r.ativado === 'SIM').reduce((a, r) => a + receitaAtivadaValor(r), 0), m1Meta: 0,
        vendas: outrosSales.length, vendida: outrosSales.reduce((a, r) => a + toNum(r.receita_m1), 0), vendasMeta: 0,
        outros: true,
      });
    }
    const totalsCloser = closers.reduce((a, c) => ({
      rr: a.rr + c.rr, rrMeta: a.rrMeta + c.rrMeta, vendas: a.vendas + c.vendas,
      vendida: a.vendida + c.vendida, ativ: a.ativ + c.ativ, ativMeta: a.ativMeta + c.ativMeta,
      m1: a.m1 + c.m1, m1Meta: a.m1Meta + c.m1Meta,
    }), { rr: 0, rrMeta: 0, vendas: 0, vendida: 0, ativ: 0, ativMeta: 0, m1: 0, m1Meta: 0 });

    // ---------- CANAL (5 canais reais — ver regra de negócio em canal5() acima) ----------
    const rrByCanal5 = rrMonth.map(r => ({ ...r, __canal5: canal5(r, leadsCanalIndex), __tier: resolveTier(r, leadsTierIndex) }));
    const salesByCanal5 = salesMonth.map(r => ({ ...r, __canal5: canal5(r, leadsCanalIndex), __tier: resolveTier(r, leadsTierIndex) }));
    const canal5Keys = [...CANAL5_ORDER];
    if (rrByCanal5.some(r => r.__canal5 === 'Inbound (não classificado)') || salesByCanal5.some(r => r.__canal5 === 'Inbound (não classificado)')) {
      canal5Keys.push('Inbound (não classificado)');
    }
    // Leads/R.M por canal: o SDR OS já calcula isso certo pra TODOS os boards (Inbound, Outbound,
    // Recomendação), direto dos detalhes de reunião do CRM, usando o mesmo canonicalChannel() que
    // decide "Vitor = sempre Recovery, não importa o board". A planilha de leads (canalLeadsRmAgg)
    // só cobre Inbound — Recovery/Indicação ficavam incompletos (Vitor sozinho tem 17 R.M de
    // Recovery, a planilha só pegava os poucos Inbound e mostrava 3 no total, com R.R passando
    // R.M). Rodrigo pegou isso 2026-10-02 (card Recovery com R.R > R.M, 533% de conversão).
    // Preferir sempre o SDR OS quando disponível; cair pra planilha de leads só se faltar (nunca
    // quebra a página) — isso cobre "Inbound (não classificado)", que o SDR OS não tem.
    const sdrOsChannelAgg = {};
    if (sdrOsLive && Array.isArray(sdrOsLive.channels)) {
      sdrOsLive.channels.forEach(c => { sdrOsChannelAgg[c.name] = { leads: c.leads, rm: c.rm, leadsMeta: c.leadsMeta,
        // rmMeta/rrMeta/salesMeta: metas por canal já vem prontas do sdr_os_targets (mesma fonte
        // do leadsMeta acima) — só não eram repassadas pro payload do Gestão Comercial. Pedido
        // por Rodrigo 2026-11-12 pro popup "Meta x Projetado x Realizado" por canal.
        rmMeta: c.rmMeta, rrMeta: c.rrMeta, salesMeta: c.salesMeta }; });
    }
    // Meta de leads por canal (sdr_os_targets, via SDR OS) e Projetado (meta × dias úteis
    // decorridos/total) — pedido por Rodrigo 2026-10-13 pro drill-down do card "Leads".
    const leadsPaceFrac = PACE.du / PACE.duTotal;
    const canais = canal5Keys.map(k => {
      const rr = rrByCanal5.filter(r => r.__canal5 === k).length;
      const s = salesByCanal5.filter(r => r.__canal5 === k);
      const ativ = s.filter(r => r.ativado === 'SIM').length;
      // Leadbroker é exceção à regra "preferir sempre o SDR OS" acima: o SDR OS conta Leads/R.M
      // de Inbound numa query agregada por SDR (by_sdr) que nunca teve granularidade de canal -
      // todo lead de Leadbroker sempre caía dentro de Blackbox lá (Leadbroker sempre mostrava 0,
      // Blackbox vinha inflado com os leads de Leadbroker juntos). A planilha de leads
      // (canalLeadsRmAgg) tem canal_aquisicao por lead e já separa certo (12 Leadbroker reais em
      // novembro até aqui / 5 R.M, confirmado direto no CRM) - só falta leadsMeta, que vem do SDR
      // OS mesmo (sdr_os_targets, não afetado pelo bug). Blackbox precisa descontar esses mesmos
      // leads/R.M pra não contar em dobro (bate exato com o Blackbox da própria planilha: 128
      // leads / 23 R.M em novembro = 136/28 do SDR OS menos 12/5 do Leadbroker). Achado por
      // Rodrigo 2026-11-09 ("tem mais leads de Leadbroker esse mês e não está contabilizando").
      const sheetAgg = canalLeadsRmAgg[k];
      const liveAgg = sdrOsChannelAgg[k];
      const sheetLeadbroker = canalLeadsRmAgg['Leadbroker'];
      let agg;
      if (k === 'Leadbroker') {
        agg = sheetAgg ? { ...sheetAgg, leadsMeta: liveAgg ? liveAgg.leadsMeta : undefined } : liveAgg;
      } else if (k === 'Blackbox' && liveAgg && sheetLeadbroker) {
        agg = { ...liveAgg, leads: Math.max(0, liveAgg.leads - sheetLeadbroker.leads), rm: Math.max(0, liveAgg.rm - sheetLeadbroker.rm) };
      } else {
        agg = liveAgg || sheetAgg;
      }
      const leadsMeta = agg && agg.leadsMeta != null ? agg.leadsMeta : null;
      // rmMeta/rrMeta/salesMeta sempre vêm do agregado "cru" do SDR OS (liveAgg), nunca do `agg`
      // escolhido acima pra REALIZADO — pra Leadbroker, `agg` vira o sheetAgg (planilha de leads,
      // sem esses campos de meta); pra Blackbox, `agg` já tem leads/rm descontados de Leadbroker,
      // mas a meta do canal não deve ser descontada (é um alvo próprio, já separado na fonte).
      const projetar = v => v != null ? Math.round(v * leadsPaceFrac) : null;
      const rmMeta = liveAgg && liveAgg.rmMeta != null ? liveAgg.rmMeta : null;
      const rrMeta = liveAgg && liveAgg.rrMeta != null ? liveAgg.rrMeta : null;
      const vendasMeta = liveAgg && liveAgg.salesMeta != null ? liveAgg.salesMeta : null;
      return { nome: k, cor: CANAL5_COLOR[k] || 'var(--muted)', leads: agg ? agg.leads : null, rm: agg ? agg.rm : null, rr,
        leadsMeta, leadsProjetado: projetar(leadsMeta),
        rmMeta, rmProjetado: projetar(rmMeta),
        rrMeta, rrProjetado: projetar(rrMeta),
        vendasMeta, vendasProjetado: projetar(vendasMeta),
        vendas: s.length, ativ, receita: s.reduce((a, r) => a + toNum(r.receita_m1), 0),
        receitaAtiv: s.filter(r => r.ativado === 'SIM').reduce((a, r) => a + receitaAtivadaValor(r), 0),
        // Saber/Ter/Executar vendido por canal — pedido por Rodrigo 2026-10-02 (indicador
        // completo por canal). Soma direto dos componentes de cada venda já classificada no
        // canal certo (mesmo canal5() usado em todo o resto da página, overrides inclusos).
        saberVendido: s.reduce((a, r) => a + toNum(r.saber), 0),
        terVendido: s.reduce((a, r) => a + toNum(r.ter), 0),
        executarVendido: s.reduce((a, r) => a + toNum(r.executar), 0),
        // Contagem de vendas por categoria (não valor) — uma venda com componente em mais de
        // uma categoria (ex.: Saber + Executar no mesmo contrato) conta em cada uma, mesmo
        // padrão já usado nas metas por categoria (META_RECEITA_CATEGORIA_*).
        saberVendas: s.filter(r => toNum(r.saber) > 0).length,
        terVendas: s.filter(r => toNum(r.ter) > 0).length,
        executarVendas: s.filter(r => toNum(r.executar) > 0).length };
    });
    const canalClassifiedPct = rrMonth.length ? Math.round((1 - rrByCanal5.filter(r => r.__canal5 === 'Inbound (não classificado)').length / rrMonth.length) * 100) : 100;
    const tierClassifiedPct = rrMonth.length ? Math.round((1 - rrByCanal5.filter(r => !r.__tier).length / rrMonth.length) * 100) : 100;

    // ---------- TIER (o campo tier nem sempre vem preenchido na fonte — mostramos a lacuna em vez de escondê-la) ----------
    const tierOrder = ['tiny', 'small', 'medium', 'large', 'enterprise'];
    const tierLabel = { tiny: 'Tiny', small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };
    const tierCores = { tiny: 'var(--muted)', small: 'var(--care)', medium: 'var(--accent)', large: 'var(--info)', enterprise: 'var(--ink)' };
    const tiers = tierOrder.map(k => {
      const rr = rrByCanal5.filter(r => r.__tier === k).length;
      const s = salesByCanal5.filter(r => r.__tier === k);
      const ativ = s.filter(r => r.ativado === 'SIM').length;
      const agg = tierLeadsRmAgg[k];
      return { nome: tierLabel[k], cor: tierCores[k], leads: agg ? agg.leads : null, rm: agg ? agg.rm : null, rr,
        vendas: s.length, ativ, receita: s.reduce((a, r) => a + toNum(r.receita_m1), 0),
        receitaAtiv: s.filter(r => r.ativado === 'SIM').reduce((a, r) => a + receitaAtivadaValor(r), 0),
        // Só Saber aqui (nunca Ter/Executar) — pedido explícito do Rodrigo pra não confundir
        // categorias de produto diferentes nessa visão pequena por tier.
        tmSaber: ticketMedioCategoria(s, 'saber').valor };
    });
    const rrSemTier = rrByCanal5.filter(r => !r.__tier).length;
    const vendasSemTier = salesByCanal5.filter(r => !r.__tier);
    if (rrSemTier || vendasSemTier.length) {
      const ativSemTier = vendasSemTier.filter(r => r.ativado === 'SIM').length;
      tiers.push({ nome: 'Sem tier (fonte incompleta)', cor: 'var(--muted)', leads: null, rm: null, rr: rrSemTier,
        vendas: vendasSemTier.length, ativ: ativSemTier, receita: vendasSemTier.reduce((a, r) => a + toNum(r.receita_m1), 0),
        receitaAtiv: vendasSemTier.filter(r => r.ativado === 'SIM').reduce((a, r) => a + receitaAtivadaValor(r), 0),
        tmSaber: ticketMedioCategoria(vendasSemTier, 'saber').valor });
    }

    // ---------- FUNIL ----------
    // R.R e Receita M1 Ativado: preferir o snapshot ao vivo do Closer OS (totals.rr /
    // totals.valorPagoContaAzul) em vez de recalcular a partir das planilhas closer_cockpit_calls/
    // sales, que podem estar um passo atrás do snapshot (mesmo padrão de "dois cálculos
    // paralelos da mesma métrica" já corrigido em Leads/R.M — Rodrigo pegou a divergência em
    // 2026-09-23: R.R 97 no SDR OS/Closer OS vs 96 aqui, Receita M1 Ativado R$253k aqui vs
    // R$231k no Closer OS por causa do fallback pra receita_m1 quando valor_pago_conta_azul
    // ainda não chegou na planilha). Fallback pro cálculo antigo só se o snapshot falhar.
    const closerTotals = closerSnapshot && closerSnapshot.totals ? closerSnapshot.totals : null;
    const rrTotal = closerTotals && closerTotals.rr != null ? closerTotals.rr : rrMonth.length;
    const vendasTotal = salesMonth.length;
    const vendidaTotal = salesMonth.reduce((a, r) => a + toNum(r.receita_m1), 0);
    const ativTotal = salesMonth.filter(r => r.ativado === 'SIM').length;
    // m1Total = Caixa (o que REALMENTE entrou no Conta Azul, parcela por parcela) — distinto de
    // Ativado (valor contratado inteiro, ver ativadoContratadoTotal abaixo). Fallback soma
    // valor_pago_conta_azul por venda (não receitaAtivadaValor, que agora é sempre o contratado).
    const m1Total = closerTotals && closerTotals.valorPagoContaAzul != null
      ? closerTotals.valorPagoContaAzul
      : salesMonth.filter(r => r.ativado === 'SIM').reduce((a, r) => a + toNum(r.valor_pago_conta_azul), 0);
    const metaRRSum = metasMonth.reduce((a, m) => a + toNum(m.meta_rr), 0);
    const metaAtivSum = metasMonth.reduce((a, m) => a + toNum(m.meta_ativados), 0);
    const metaM1Sum = metasMonth.reduce((a, m) => a + toNum(m.meta_receita_m1), 0);
    const paceFrac = PACE.du / PACE.duTotal;
    // Realizado por categoria, nas duas visões (toggle Venda/Ativado no front — pedido por Rodrigo
    // em 2026-09-24, "visualização padrão da venda, mas com ícone seletor do ativado"):
    // - "vendido": valor contratado de TODAS as vendas do mês, ativadas ou não (mesmo escopo do
    //   card "Receita M1 Vendido").
    // - "ativado": valor contratado só de quem já ativou (mesmo escopo do card "Receita M1 Ativado").
    // Sempre valor CONTRATADO (fee da categoria), nunca caixa — o Conta Azul não discrimina qual
    // componente de uma venda parcial foi recebido, então não existe "recebido por categoria".
    function buildCategoria(meta, rows) {
      function real(field) { return rows.reduce((a, r) => a + toNum(r[field]), 0); }
      // meta vem null pra mes sem BP Tatico cadastrado (ver METAS_BP_TATICO) — mostra so o
      // realizado, sem meta/projetado, em vez de quebrar a pagina.
      if (!meta) return {
        saber: { meta: null, proj: null, real: real('saber') },
        ter: { meta: null, proj: null, real: real('ter') },
        executar: { meta: null, proj: null, real: real('executar') },
      };
      return {
        saber: { meta: meta.saber, proj: Math.round(meta.saber * paceFrac), real: real('saber') },
        ter: { meta: meta.ter, proj: Math.round(meta.ter * paceFrac), real: real('ter') },
        executar: { meta: meta.executar, proj: Math.round(meta.executar * paceFrac), real: real('executar') },
      };
    }
    const receitaCategoria = {
      vendido: buildCategoria(META_RECEITA_CATEGORIA_VENDIDO, salesMonth),
      ativado: buildCategoria(META_RECEITA_CATEGORIA_ATIVADO, salesMonth.filter(r => r.ativado === 'SIM')),
    };

    // R.F (reuniões futuras) e Taxa de Show — pedidos por Rodrigo em 2026-09-21 como dois
    // indicadores pequenos no card de R.R. Taxa de Show continua vindo do payload do SDR OS
    // (sdrOsLive.meetings), não de closer_cockpit_calls: checado ao vivo em 2026-09-21 que
    // essa planilha não tem NENHUMA linha reuniao_realizada=NAO pra competencia_rr=2026-09
    // (85 de 85 = SIM) nem nenhuma linha com data futura — o no-show simplesmente não chega
    // nela ainda pro mês corrente. R.F passou a ler a aba "Reuniões" direto (ver
    // fetchReunioesFuturas acima) a partir de 2026-11-02, porque sdrOsLive.meetings estava
    // sub-contando reuniões futuras sem Closer atribuído.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const sdrOsMeetings = (sdrOsLive && Array.isArray(sdrOsLive.meetings)) ? sdrOsLive.meetings : [];
    // R.F: lê direto a aba "Reuniões" (ver nota acima) — conta qualquer linha com R.R
    // diferente de Sim/Não (cobre "Agendada", vazio ou qualquer outro texto pendente) e data
    // (da reunião, ou na falta dela, da qualificação) >= hoje. Sem exigir Closer preenchido,
    // sem travar no mês da competência selecionada. Fallback pro cálculo antigo via
    // sdrOsLive.meetings só se a planilha falhar (nunca quebra a página).
    const futureMeetings = Array.isArray(reunioesRows)
      ? reunioesRows.filter(row => {
          const rr = String(row['R.R'] || '').trim().toLowerCase();
          if (/^(sim|yes|true|1)$/.test(rr) || /^(nao|não|no|false|0)$/.test(rr)) return false;
          const dateStr = parseBrDate_(row['Dia Da Reunião']) || parseBrDate_(row['Dia Qualifação']);
          return !!(dateStr && dateStr >= todayStr);
        }).length
      : sdrOsMeetings.filter(m => m.status === 'Marcada' && m.date >= todayStr).length;
    const sdrOsRealized = sdrOsMeetings.filter(m => m.status === 'Realizada').length;
    const sdrOsNoShow = sdrOsMeetings.filter(m => m.status === 'No-show').length;
    const showRate = (sdrOsRealized + sdrOsNoShow) > 0 ? Math.round((sdrOsRealized / (sdrOsRealized + sdrOsNoShow)) * 1000) / 10 : null;

    // Leads e R.M eram literais fixos (237 / 113) marcados live:false desde 2026-09-16 —
    // não achamos fonte publica equivalente na epoca. Agora que sdrOsLive (payload real do
    // SDR OS) ja esta religado no dashboard (fix de 2026-09-21 pro "Por SDR"), reaproveitar
    // pros dois estagios gerais tambem. Fallback pros valores antigos so se o fetch falhar,
    // mesmo padrao ja usado no resto do arquivo — nunca quebra a pagina por causa disso.
    const leadsLive = sdrOsLive && sdrOsLive.team && sdrOsLive.team.leads;
    const rmLive = sdrOsLive && sdrOsLive.team && sdrOsLive.team.rm;
    // Valor contratado (receita_m1) só de quem ativou — distinto do "real" do card (m1Total,
    // que é o RECEBIDO no Conta Azul, regra confirmada com Rodrigo em 2026-09-17). Pedido por
    // Rodrigo em 2026-09-24: mostrar os dois lado a lado no card, pequeno, pra não confundir
    // "ativado" (contrato) com "recebido" (caixa) — mesma distinção da seção 05.
    const ativadoContratadoTotal = salesMonth.filter(r => r.ativado === 'SIM').reduce((a, r) => a + toNum(r.receita_m1), 0);
    // Ticket médio M1 por categoria de produto (Saber/Ter/Executar) — pedido por Rodrigo em
    // 2026-09-24, pra entender o tamanho médio de venda por linha de produto, não só o total.
    const ticketMedio = {
      saber: ticketMedioCategoria(salesMonth, 'saber'),
      ter: ticketMedioCategoria(salesMonth, 'ter'),
      executar: ticketMedioCategoria(salesMonth, 'executar'),
    };
    // null-safe: meses sem BP Tatico cadastrado (ver METAS_BP_TATICO) tem META_* em null —
    // mostra "—" em vez de quebrar a pagina ou projetar sobre um numero inexistente.
    const pm_ = (v) => (v == null ? null : Math.round(v * paceFrac));
    // Meta de Leads sem Recovery nem Lista Fria (ver recoveryLeadsMeta/listaFriaLeadsMeta em
    // METAS_BP_TATICO acima) — default 0 pra meses sem esses campos (ex. setembro), nunca muda
    // o número de lá. Lista Fria (canal novo de novembro/2026) entrou em 2026-11-05: esses leads
    // não entram no CRM nesse formato, então não há como medir ideal-dia/pace contra eles —
    // mesmo tratamento do Recovery. Confirmado por Rodrigo.
    const metaLeads_ = META_SDR && META_SDR.geral.leads != null
      ? META_SDR.geral.leads - (META_SDR.recoveryLeadsMeta || 0) - (META_SDR.listaFriaLeadsMeta || 0)
      : null;
    const metaRm_ = META_SDR && META_SDR.geral.rm;
    const metaVendas_ = META_VENDAS && META_VENDAS.geral;
    // R.R: fonte preferencial é a soma por closer (closer_cockpit_metas, metaRRSum), mais precisa
    // porque reflete a meta individual de cada um. Enquanto essas linhas de outubro não existem
    // na planilha (metasMonth vazio), cai pro R.R geral da BP Tático (META_SDR.geral.rr) — mesmo
    // padrão de fallback já usado em R.M — em vez de mostrar "—". Pedido por Rodrigo em 2026-10-08.
    const metaRr_ = metasMonth.length ? metaRRSum : (META_SDR && META_SDR.geral.rr);
    const stages = [
      // proj era um espelho do real (sempre "0% vs projetado", sem sinal nenhum) — corrigido
      // 2026-10-12 pra usar a mesma fórmula de pace das outras etapas (meta × dias úteis
      // decorridos/total), agora que a meta já desconta Recovery.
      { name: 'Leads', real: leadsLive != null ? leadsLive : 237, meta: metaLeads_ ?? null, proj: pm_(metaLeads_), live: leadsLive != null },
      { name: 'R.M', real: rmLive != null ? rmLive : 113, meta: metaRm_ ?? null, proj: pm_(metaRm_), live: rmLive != null },
      { name: 'R.R', real: rrTotal, meta: metaRr_ ?? null, proj: pm_(metaRr_), live: true, futureMeetings, showRate },
      { name: 'Vendas', real: vendasTotal, meta: metaVendas_ ?? null, proj: pm_(metaVendas_), live: true },
      { name: 'Ativados', real: ativTotal, meta: META_ATIVADOS, proj: pm_(META_ATIVADOS), live: true },
      { name: 'Receita M1 Vendido', real: vendidaTotal, meta: META_RECEITA_VENDIDO, proj: pm_(META_RECEITA_VENDIDO), money: true, live: true, noCrArrow: true, caption: 'Todas as vendas fechadas no mês' },
      { name: 'Receita M1 Ativado', real: ativadoContratadoTotal, meta: metasMonth.length ? metaM1Sum : null, proj: metasMonth.length ? pm_(metaM1Sum) : null, money: true, live: true, caption: 'Valor contratado inteiro de quem já fez o 1º pagamento no Conta Azul' },
      { name: 'Caixa', real: m1Total, meta: META_CAIXA, proj: pm_(META_CAIXA), money: true, live: true, noCrArrow: true, caption: 'Projeção de fluxo de caixa do mês (Receita M1 × % Pagamento M1 da BP Tático) — soma real do que entrou no Conta Azul, parcela por parcela' },
    ];

    // ---------- SDR (fonte preferencial: payload real do SDR OS; fallback estático/derivado se o endpoint falhar) ----------
    // Fausto = Allison renomeado (mesma pessoa, e-mail igual) a pedido de Rodrigo em 2026-10-08.
    // Setembro já estava fechado com o payload do SDR OS gravado sob a chave "Allison" —
    // continua lido por ela (nunca re-sincronizado), só o rótulo daqui em diante é Fausto.
    // Tamara saiu do roster ativo em outubro (sem meta nem payload ao vivo desde então) e
    // continuava listada aqui "só por histórico" - mas isso fazia ela aparecer como linha zerada
    // (rm:0, rr:0, showRate:null) em TODO mês depois disso, inclusive novembro, porque
    // sdrLivePeople nunca tem a chave Tamara (o roster do SDR OS/n8n já não a inclui há tempo).
    // Rodrigo confirmou 2026-11-07: a partir de novembro ela sai de vez; meses anteriores (onde
    // ela teve volume real) continuam exatamente como estavam.
    const sdrNomes = competencia >= '2026-11'
      ? ['Davi', 'Biazon', 'Vitor', 'Lucas', 'Fausto']
      : ['Davi', 'Tamara', 'Biazon', 'Vitor', 'Lucas', 'Fausto'];
    const sdrLeadsStatic = { Davi: 81, Tamara: 45, Biazon: 38, Vitor: 1, Lucas: 51, Fausto: 21 };
    const sdrRmStatic = { Davi: 38, Tamara: 20, Biazon: 11, Vitor: 12, Lucas: 23, Fausto: 9 };
    const sdrLivePeople = sdrOsLive && sdrOsLive.people ? sdrOsLive.people : null;
    // Taxa de Show por SDR (pedido por Rodrigo em 2026-11-04): R.R ÷ (R.R + No-show), só
    // reuniões que já têm desfecho — mesma régua já usada no card geral de R.R (showRate
    // acima, via sdrOsMeetings). Antes o único sinal de conversão no card do SDR era o badge
    // entre R.M→R.R (pctOf), que mistura reunião pendente/futura no denominador junto com a
    // resolvida — por isso o 56% do Davi divergia da Taxa de Show geral de 75,9%. Calculado
    // aqui por `player` (nome do SDR em cada linha de sdrOsMeetings), não por live.rr, pra
    // numerador e denominador virem sempre da mesma fonte/mesmo filtro de status.
    const sdrOsMeetingsByPlayer = {};
    sdrOsMeetings.forEach(m => {
      const p = m.player || '';
      if (!sdrOsMeetingsByPlayer[p]) sdrOsMeetingsByPlayer[p] = { realizada: 0, noShow: 0 };
      if (m.status === 'Realizada') sdrOsMeetingsByPlayer[p].realizada++;
      else if (m.status === 'No-show') sdrOsMeetingsByPlayer[p].noShow++;
    });
    function showRateFor(nome) {
      const liveKey2 = nome === 'Fausto' && !sdrOsMeetingsByPlayer.Fausto && sdrOsMeetingsByPlayer.Allison ? 'Allison' : nome;
      const bucket = sdrOsMeetingsByPlayer[liveKey2];
      if (!bucket) return { noShow: 0, showRate: null };
      const denom = bucket.realizada + bucket.noShow;
      return { noShow: bucket.noShow, showRate: denom > 0 ? Math.round((bucket.realizada / denom) * 1000) / 10 : null };
    }
    const sdrs = sdrNomes.map(nome => {
      const liveKey = nome === 'Fausto' && sdrLivePeople && !sdrLivePeople.Fausto && sdrLivePeople.Allison ? 'Allison' : nome;
      const live = sdrLivePeople && sdrLivePeople[liveKey];
      const email = SDR_EMAIL[nome];
      const vendida = salesMonth.filter(r => r.sdr === email).reduce((a, r) => a + toNum(r.receita_m1), 0);
      const meta = META_SDR_RM_RR_VENDAS[nome] || {};
      const sr = showRateFor(nome);
      if (live) {
        return { nome, leads: live.leads, leadsMeta: (META_SDR && META_SDR.individual[nome]) || 0,
          rm: live.rm, rmMeta: live.rmMeta || meta.rm || 0, rr: live.rr, rrMeta: live.rrMeta || meta.rr || 0,
          vendas: live.sales, vendida, vendasMeta: live.salesMeta || meta.vendas || 0,
          noShow: sr.noShow, showRate: sr.showRate };
      }
      // sdrLivePeople existe e está ao vivo (não é queda do SDR OS), mas essa pessoa não está no
      // roster ativo do payload deste mês (ex.: Tamara saiu em 2026-11-05) — mostrar zero, nunca
      // o fallback estático (sdrLeadsStatic/sdrRmStatic), que é número velho de outro mês e
      // estava sendo somado como se fosse ao vivo, quebrando a soma sdrs[].leads vs team.leads
      // (achado via bridge de Aquisição: "Gestão Comercial inconsistente em leads (105/60)",
      // 2026-11-06). O fallback estático continua valendo só quando sdrLivePeople inteiro falta.
      if (sdrLivePeople) {
        return { nome, leads: 0, leadsMeta: (META_SDR && META_SDR.individual[nome]) || 0,
          rm: 0, rmMeta: meta.rm || 0, rr: 0, rrMeta: meta.rr || 0,
          vendas: 0, vendida, vendasMeta: meta.vendas || 0,
          noShow: sr.noShow, showRate: sr.showRate };
      }
      const rr = rrMonth.filter(r => r.sdr === nome).length;
      const vendas = salesMonth.filter(r => r.sdr === email).length;
      return { nome, leads: sdrLeadsStatic[nome], leadsMeta: (META_SDR && META_SDR.individual[nome]) || 0,
        rm: sdrRmStatic[nome], rmMeta: meta.rm || 0, rr, rrMeta: meta.rr || 0,
        vendas, vendida, vendasMeta: meta.vendas || 0,
        noShow: sr.noShow, showRate: sr.showRate };
    });
    // "Outros" — mesmo padrão já usado em "Por Closer": venda/RR de um sdr_email fora do
    // roster fixo de 6 (ex.: alleson.santos@v4company.com, variação não mapeada em SDR_EMAIL)
    // não pode sumir da seção "Por SDR" nem ser atribuída a um SDR errado. O funil geral
    // (vendasTotal/rrTotal) já soma isso certo por não ser roster-filtrado; só esta seção
    // detalhada excluía. Corrigido 2026-09-19 junto com o mesmo bug no SDR OS (n8n); passou a
    // usar o campo team.outros do próprio payload do SDR OS em 2026-09-21 (mesma fonte, evita
    // recalcular com outra planilha que pode divergir).
    const liveOutros = sdrOsLive && sdrOsLive.team && sdrOsLive.team.outros;
    const sdrEmails = Object.values(SDR_EMAIL);
    const outrosSdrRR = rrMonth.filter(r => !sdrNomes.includes(r.sdr));
    const outrosSdrSales = salesMonth.filter(r => !sdrEmails.includes(r.sdr));
    const outrosRRCount = liveOutros ? liveOutros.rr : outrosSdrRR.length;
    const outrosSalesCount = liveOutros ? liveOutros.sales : outrosSdrSales.length;
    // Taxa de Show de "Outros": soma de todo `player` de sdrOsMeetings fora do roster fixo
    // (mesmo critério de "fora do roster" já usado pra RR/vendas acima).
    const rosterPlayers = sdrNomes.concat(['Allison']);
    const outrosRealizadaNS = sdrOsMeetings.filter(m => !rosterPlayers.includes(m.player || '') && m.status === 'Realizada').length;
    const outrosNoShowNS = sdrOsMeetings.filter(m => !rosterPlayers.includes(m.player || '') && m.status === 'No-show').length;
    const outrosDenomNS = outrosRealizadaNS + outrosNoShowNS;
    if (outrosRRCount || outrosSalesCount) {
      sdrs.push({
        nome: 'Outros', leads: liveOutros ? liveOutros.leads : 0, leadsMeta: 0,
        rm: liveOutros ? liveOutros.rm : 0, rmMeta: 0,
        rr: outrosRRCount, rrMeta: 0,
        vendas: outrosSalesCount,
        vendida: outrosSdrSales.reduce((a, r) => a + toNum(r.receita_m1), 0),
        vendasMeta: 0, outros: true,
        noShow: outrosNoShowNS, showRate: outrosDenomNS > 0 ? Math.round((outrosRealizadaNS / outrosDenomNS) * 1000) / 10 : null,
      });
    }
    const rrSdrTotal = sdrs.reduce((a, s) => a + s.rr, 0);

    // ---------- LINHAS BRUTAS (pro filtro global SDR/Closer/Canal/Tier no front) ----------
    // Conjunto mínimo de campos por registro — o front recalcula funil/canal/tier/closer/sdr
    // filtrado a partir daqui em vez de re-perguntar o servidor a cada troca de filtro.
    const rawRR = rrByCanal5.map(r => ({
      sdr: r.sdr || null, closer: closerLabel[r.closer] || r.closer || null,
      canal: r.__canal5, tier: r.__tier, data: r.data_rr || null, empresa: r.empresa || '',
    }));
    // Drill-down do gráfico "Reuniões por dia" (seção 09) — R.M usa a mesma fonte do card de
    // Leads/R.M diário (leadsRows, só Inbound, data ISO -> convertida pra DD/MM/AAAA aqui pra
    // casar com o resto das linhas brutas). N.S usa sdrOsLive.meetings (único lugar com os 3
    // estados Realizada/No-show/Marcada por reunião) — mesma fonte de dailySeries.noShow.
    // Pedido por Rodrigo em 2026-10-12: clicar numa barra do dia abre a lista por trás do número.
    function isoToBr_(iso) {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    }
    const rawLeadsRM = leadsRows
      .filter(r => String(r.dt_primeira_reuniao_marcada || '').startsWith(competencia))
      .map(r => ({
        empresa: r.company_name || '', data: isoToBr_(r.dt_primeira_reuniao_marcada), canal: r.canal_aquisicao || '',
        sdr: EMAIL_SDR[r.owner_email] || r.lead_owner || '',
      }));
    // canal_aquisicao (texto livre da planilha) -> canal canônico de 5 vias (mesmo vocabulário
    // de CANAL5_ORDER/CANAL5_COLOR usado na seção 01). "Reativação" é sinônimo de Recovery na
    // planilha (mesmo motion, nome alternativo); o resto cai em "Inbound (não classificado)".
    const CANAL_AQUISICAO_TO_CANAL5 = { Blackbox: 'Blackbox', Leadbroker: 'Leadbroker', Recovery: 'Recovery', 'Reativação': 'Recovery' };
    // Drill-down do gráfico "Leads por dia" (aba nova, pedida por Rodrigo 2026-10-12) — usa
    // dt_cadastro_lead (data de ENTRADA do lead), não dt_primeira_reuniao_marcada (usada acima
    // em rawLeadsRM, que é a data da reunião) — são datas diferentes pro mesmo lead.
    const rawLeadsCadastro = leadsRows
      .filter(r => String(r.dt_cadastro_lead || '').startsWith(competencia))
      .map(r => ({
        empresa: r.company_name || '', data: isoToBr_(r.dt_cadastro_lead),
        canal: CANAL_AQUISICAO_TO_CANAL5[r.canal_aquisicao] || 'Inbound (não classificado)',
        sdr: EMAIL_SDR[r.owner_email] || r.lead_owner || '',
      }));
    const rawMeetingsSdrOs = sdrOsMeetings.map(m => ({
      empresa: m.company || '', player: m.player || '', canal: m.channel || '',
      status: m.status || '', data: isoToBr_(m.date),
    }));
    // Snapshot do Closer OS (closerSnapshot.sales) tem, por venda, valor_pago_conta_azul/
    // forma_pagamento/qtd_parcelas_crm/installments mais confiáveis que a cópia na planilha
    // (que fica com valor_pago_conta_azul vazio até o próximo sync — mesmo gap já usado acima
    // pra m1Total). Join por sale_id, que é o mesmo valor nas duas fontes.
    const snapshotSalesById = {};
    if (closerSnapshot && Array.isArray(closerSnapshot.sales)) {
      closerSnapshot.sales.forEach(s => { if (s.sale_id) snapshotSalesById[s.sale_id] = s; });
    }
    const rawSales = salesByCanal5.map(r => {
      const snap = snapshotSalesById[r.sale_id];
      const contrato = toNum(r.receita_m1); // mesma definição de "valor" usada no resto da página (nunca TCV)
      // snap vem do snapshot do Closer OS (já é number nativo do JS) — toNum() espera string
      // pt-BR ("13.488,01") e corrompe um float nativo (ex.: 13488.01 -> 1348801, removendo o
      // ponto decimal como se fosse separador de milhar). Só usar toNum() na string da planilha.
      const recebido = snap ? (Number(snap.valor_pago_conta_azul) || 0) : toNum(r.valor_pago_conta_azul);
      const forma = formaLabel(snap ? snap.forma_pagamento : r.forma_pagamento);
      const parcelas = snap && snap.qtd_parcelas_crm ? String(snap.qtd_parcelas_crm) : '';
      const installments = snap && Array.isArray(snap.installments) ? snap.installments : [];
      const statusAtivacao = snap ? snap.status_ativacao : (r.status_ativacao || (r.ativado === 'SIM' ? 'ATIVADO' : 'SEM_MATCH'));
      return {
        sdr: EMAIL_SDR[r.sdr] || null, closer: closerLabel[r.closer] || r.closer || null,
        canal: r.__canal5, tier: r.__tier, ativado: r.ativado === 'SIM',
        receita: toNum(r.receita_m1), data: r.data_ganho || null,
        empresa: r.empresa || '',
        // Canal nativo do CRM (Inbound/Outbound/Outros) — distinto de `canal` acima (classificação
        // 5-vias por nome de empresa). É o campo que bate com os buckets do gráfico "Receita por
        // dia" (buildDailyReceitaByCanal usa r.canal, não __canal5) — precisa pro drill-down.
        canalNativo: r.canal || '',
        // Valor "de exibição" (ex.: lista de Vendas): recebido quando já ativado, contratado
        // enquanto não ativou ainda — mesma regra de receitaAtivadaValor() usada no resto da página.
        valor: r.ativado === 'SIM' ? receitaAtivadaValor(r) : toNum(r.receita_m1),
        contrato, recebido, forma, parcelas, installments, statusAtivacao,
        // Decomposição por categoria de produto do mesmo contrato (um contrato pode ter valor em
        // mais de uma categoria ao mesmo tempo) — pedido por Rodrigo pra tabela "Vendas" da
        // Evolução diária (Empresa · Closer · Executar · Ter · Saber · Forma de Pagamento).
        saber: toNum(r.saber), ter: toNum(r.ter), executar: toNum(r.executar),
      };
    });
    const ativadosRows = rawSales.filter(r => r.ativado);
    const activationTotals = {
      vendido: rawSales.reduce((a, r) => a + r.contrato, 0),
      ativado: ativadosRows.reduce((a, r) => a + r.contrato, 0),
      recebido: ativadosRows.reduce((a, r) => a + r.recebido, 0),
      countAtivados: ativadosRows.length,
      countTotal: rawSales.length,
    };

    // ---------- EVOLUÇÃO DIÁRIA (ao vivo: R.R por data_rr, Vendas/Ativados por data_ganho) ----------
    function dayKey(brDate) { // "16/09/2026" -> "2026-09-16"
      if (!brDate) return null;
      const m = String(brDate).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    }
    const [__cy, __cm] = competencia.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(__cy, __cm, 0)).getUTCDate();
    const dayLabels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0'));
    const compMonth = competencia.slice(5, 7);
    const dayLabelsDisplay = dayLabels.map(d => `${d}/${compMonth}`); // "01/09" — pro eixo do gráfico, mais claro que só "01"
    function buildDaily(rows, dateField, filterFn) {
      const counts = {};
      rows.forEach(r => {
        if (filterFn && !filterFn(r)) return;
        const k = dayKey(r[dateField]);
        if (k && k.startsWith(competencia)) counts[k] = (counts[k] || 0) + 1;
      });
      return dayLabels.map(d => counts[`${competencia}-${d}`] || 0);
    }
    // R.M diário: só a planilha de leads tem data por dia (dt_primeira_reuniao_marcada, já em ISO
    // YYYY-MM-DD) — e só cobre a parte Inbound (mesma ressalva do agregado mensal por canal/tier).
    function buildDailyIso(rows, dateField) {
      const counts = {};
      rows.forEach(r => {
        const v = r[dateField] || '';
        if (v.startsWith(competencia)) counts[v.slice(0, 10)] = (counts[v.slice(0, 10)] || 0) + 1;
      });
      return dayLabels.map(d => counts[`${competencia}-${d}`] || 0);
    }
    // Receita diária por canal nativo (Inbound/Outbound/Outros) — pra o gráfico de faturamento por dia.
    function buildDailyReceitaByCanal(rows) {
      const out = { inbound: dayLabels.map(() => 0), outbound: dayLabels.map(() => 0), outros: dayLabels.map(() => 0) };
      rows.forEach(r => {
        const k = dayKey(r.data_ganho);
        if (!k || !k.startsWith(competencia)) return;
        const idx = dayLabels.indexOf(k.slice(8, 10));
        if (idx < 0) return;
        const bucket = r.canal === 'Inbound' ? 'inbound' : (r.canal === 'Outbound' ? 'outbound' : 'outros');
        out[bucket][idx] += toNum(r.receita_m1);
      });
      return out;
    }
    // Leads diário por canal (dt_cadastro_lead) — nova aba "Leads" pedida por Rodrigo 2026-10-12
    // pra acompanhar pace de entrada por canal, não só o agregado mensal. Blackbox/Leadbroker/
    // Recovery vêm da planilha de leads (único lugar com esses 3 sub-canais distintos). Indicação/
    // Recomendação nunca passam por essa planilha (são board nativo do CRM) — inicialmente ficavam
    // zeradas aqui; corrigido 2026-10-12 lendo sdrOsLive.dailyLeadsByChannel (consulta direta ao
    // CRM, por dia, adicionada no n8n), sem filtro de dono (regra confirmada por Rodrigo: lead
    // conta pelo board onde caiu, não por quem é o SDR — só R.M/R.R/Vendas filtram por dono).
    function buildDailyLeadsByCanal(rows, sdrOsDailyLeads) {
      const out = {};
      CANAL5_ORDER.concat(['Inbound (não classificado)']).forEach(k => { out[k] = dayLabels.map(() => 0); });
      rows.forEach(r => {
        const v = String(r.dt_cadastro_lead || '');
        if (!v.startsWith(competencia)) return;
        const idx = dayLabels.indexOf(v.slice(8, 10));
        if (idx < 0) return;
        const bucket = CANAL_AQUISICAO_TO_CANAL5[r.canal_aquisicao] || 'Inbound (não classificado)';
        out[bucket][idx] += 1;
      });
      ['Indicação', 'Recomendação'].forEach(canal => {
        const dayMap = sdrOsDailyLeads && sdrOsDailyLeads[canal];
        if (!dayMap) return;
        Object.keys(dayMap).forEach(iso => {
          if (!iso.startsWith(competencia)) return;
          const idx = dayLabels.indexOf(iso.slice(8, 10));
          if (idx >= 0) out[canal][idx] = dayMap[iso];
        });
      });
      return out;
    }
    // N.S (No-show) diário: mesma fonte do indicador "Taxa de Show" do card de R.R acima
    // (sdrOsLive.meetings, único lugar com os 3 estados Realizada/No-show/Marcada por reunião).
    // Pedido por Rodrigo em 2026-10-09 como 3ª barra no gráfico "Reuniões por dia".
    function buildDailyFromMeetings(meetings, status) {
      const counts = {};
      meetings.forEach(m => {
        if (m.status !== status) return;
        const k = String(m.date || '').slice(0, 10);
        if (k && k.startsWith(competencia)) counts[k] = (counts[k] || 0) + 1;
      });
      return dayLabels.map(d => counts[`${competencia}-${d}`] || 0);
    }
    // R.M diário: sdrOsLive.dailyRmTeam — campo adicionado no workflow n8n (2026-11-11) que
    // conta por dia com o MESMO filtro/correções que gera team.rm (rmIsAgendada + rmTrueCompetencia
    // + rmCorrections), então a soma bate EXATO com o card "R.M" do funil (58=58, por construção,
    // não aproximação). Antes usava meetings[].rmDate (63, não batia — não aplica rmTrueCompetencia/
    // rmCorrections) ou a planilha de leads, só-Inbound (51). Rodrigo: "precisa ser a mesma fonte
    // e o mesmo número". Pode ter 1-2 dias de um mês anterior quando rmCorrections aponta pra cá
    // (raro) — esses ficam fora do grid de dias do mês, então a soma visível pode ficar 1-2 abaixo
    // do card nesse caso raro; o card em si nunca é afetado (lê team.rm direto).
    function buildDailyFromRmTeam(map) {
      const counts = map || {};
      return dayLabels.map(d => counts[`${competencia}-${d}`] || 0);
    }
    // Fallback intermediário: aproximação por meetings[].rmDate (não bate exato com o card, mas é
    // bem mais perto da verdade que a planilha de leads só-Inbound) — usado só se dailyRmTeam vier
    // ausente do payload. Achado real em 2026-11-11: numa execução AGENDADA do n8n (mas não numa
    // execução manual de teste, mesmo código/versão) o campo simplesmente não apareceu no payload
    // — suspeita de pressão de performance/memória nesse ambiente (já documentado no workflow:
    // "alguns syncs desse ambiente cortam silenciosamente"). Corrigido lá (memoização de
    // rmDateForRow), mas como fallback nunca é demais: nunca mais cair direto pro pior caso (51)
    // se esse campo falhar de novo por qualquer motivo.
    function buildDailyFromMeetingsByRmDateApprox(meetings) {
      const counts = {};
      meetings.forEach(m => {
        const k = String(m.rmDate || '').slice(0, 10);
        if (k && k.startsWith(competencia)) counts[k] = (counts[k] || 0) + 1;
      });
      return dayLabels.map(d => counts[`${competencia}-${d}`] || 0);
    }
    const dailySeries = {
      // R.R diário: mesma causa raiz do bug de "Por Closer" corrigido em 2026-11-10 — rrMonth
      // vem de closer_cockpit_calls, que parou de receber linhas novas após a migração do
      // Closer OS pro workflow BQ v3 (27/10). sdrOsLive.meetings com status 'Realizada' bate
      // exatamente com o total ao vivo do card R.R (confirmado 41=41 em 2026-11-11).
      rm: (sdrOsLive && sdrOsLive.dailyRmTeam && Object.keys(sdrOsLive.dailyRmTeam).length)
        ? buildDailyFromRmTeam(sdrOsLive.dailyRmTeam)
        : (sdrOsMeetings.length ? buildDailyFromMeetingsByRmDateApprox(sdrOsMeetings) : buildDailyIso(leadsRows, 'dt_primeira_reuniao_marcada')),
      rr: sdrOsMeetings.length ? buildDailyFromMeetings(sdrOsMeetings, 'Realizada') : buildDaily(rrMonth, 'data_rr'),
      noShow: buildDailyFromMeetings(sdrOsMeetings, 'No-show'),
      vendas: buildDaily(salesMonth, 'data_ganho'),
      ativados: buildDaily(salesMonth, 'data_ganho', r => r.ativado === 'SIM'),
      receita: buildDailyReceitaByCanal(salesMonth),
      leads: buildDailyLeadsByCanal(leadsRows, sdrOsLive && sdrOsLive.dailyLeadsByChannel),
    };
    const lastDayWithData = Math.max(
      dailySeries.rr.map((v, i) => v > 0 ? i : -1).reduce((a, b) => Math.max(a, b), -1),
      dailySeries.vendas.map((v, i) => v > 0 ? i : -1).reduce((a, b) => Math.max(a, b), -1)
    );
    // Mês corrente: corta nos dias úteis já decorridos, pra não mostrar uma fileira de colunas
    // vazias do resto do mês. Mês fechado (qualquer competência != a atual): sempre o mês
    // inteiro — cortar pelo "último dia com dado" escondia o dia 31 de outubro sempre que não
    // havia R.R/venda nesse dia (Rodrigo pegou isso em 2026-11-10, gráfico de outubro parava no 30).
    const trimLen = competencia === competenciaAtual_()
      ? Math.max(lastDayWithData + 1, PACE.du)
      : daysInMonth;
    const trimmedLabels = dayLabelsDisplay.slice(0, trimLen);
    const trimSeries = arr => arr.slice(0, trimLen);

    const payload = {
      generatedAt: new Date().toISOString(),
      competencia: competencia,
      competenciasDisponiveis: COMPETENCIAS_DISPONIVEIS,
      // true quando o BP Tatico desse mes ainda nao foi cadastrado em METAS_BP_TATICO (ver
      // topo do arquivo) — front usa isso pra avisar em vez de deixar os "—" sem explicacao.
      metasPendentes,
      pace: PACE,
      liveFields: ['Leads', 'R.M', 'R.R', 'Vendas', 'Ativados', 'Receita M1 Vendido', 'Receita M1 Ativado', 'Canal (RR/Vendas)', 'Tier (RR/Vendas)', 'Closer (tudo)', 'SDR (tudo, incl. Leads/R.M individual)'],
      staticFields: [], // tudo ao vivo desde 2026-09-21; cai pra fallback estático só se a fonte (SDR OS/n8n) falhar — ver sdrOsLive/leadsLive/rmLive acima
      stages,
      canais,
      tiers,
      closers,
      sdrs,
      totals: {
        rr: rrTotal, rrMeta: metaRr_ ?? null, vendas: vendasTotal, vendida: vendidaTotal,
        ativ: ativTotal, ativMeta: metasMonth.length ? metaAtivSum : null, m1: m1Total, m1Meta: metasMonth.length ? metaM1Sum : null,
        leads: leadsLive != null ? leadsLive : 237,
        leadsMetaSum: META_SDR ? Object.values(META_SDR.individual).reduce((a, v) => a + v, 0) : null,
        leadsMetaGeral: metaLeads_ ?? null,
        rm: rmLive != null ? rmLive : 113, rrSdr: rrSdrTotal,
      },
      // Freshness: pra sinalizar na tela "atualizado ha X min" por fonte, em vez de
      // precisar notar um numero errado primeiro pra so entao a gente investigar quando
      // sincronizou de verdade. Adicionado 2026-09-21.
      freshness: {
        sdrOs: sdrOsLive && sdrOsLive.generatedAt ? sdrOsLive.generatedAt : null,
        closerOs: closerSnapshot && closerSnapshot.generatedAt ? closerSnapshot.generatedAt : null,
        dashboard: new Date().toISOString(),
      },
      series: {
        labels: trimmedLabels,
        rm: trimSeries(dailySeries.rm),
        rr: trimSeries(dailySeries.rr),
        noShow: trimSeries(dailySeries.noShow),
        vendas: trimSeries(dailySeries.vendas),
        ativados: trimSeries(dailySeries.ativados),
        receita: {
          inbound: trimSeries(dailySeries.receita.inbound),
          outbound: trimSeries(dailySeries.receita.outbound),
          outros: trimSeries(dailySeries.receita.outros),
        },
        leads: Object.fromEntries(CANAL5_ORDER.concat(['Inbound (não classificado)']).map(k => [k, trimSeries(dailySeries.leads[k])])),
        note: 'R.M diário cobre só a parte Inbound (única com data por dia na fonte) — R.R, Vendas e Ativados são o total real de cada registro.',
        leadsNote: 'Blackbox/Leadbroker/Recovery vêm da planilha de leads; Indicação/Recomendação vêm direto do CRM (board, sem filtro de dono) — corrigido 2026-10-12.',
      },
      canalClassifiedPct,
      tierClassifiedPct,
      rawRR,
      rawSales,
      rawLeadsRM,
      rawLeadsCadastro,
      rawMeetingsSdrOs,
      activationTotals,
      ticketMedio,
      receitaCategoria,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
