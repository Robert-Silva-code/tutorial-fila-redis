// monitor.js — painel da fila no terminal (atualiza a cada 500 ms)
import { styleText } from 'node:util';
import { conectar } from './redis.js';
import { K } from './chaves.js';

const client = await conectar();
const assinante = await client.duplicate().connect(); // conexão dedicada ao Pub/Sub

// 1) Eventos chegam "empurrados" pelo Pub/Sub, no momento em que acontecem
const eventos = [];
await assinante.subscribe(K.eventos, (mensagem) => {
  eventos.unshift(JSON.parse(mensagem));
  eventos.splice(6); // guarda só os 6 mais recentes
});

const rotulos = { na_fila: 'na fila', processando: 'processando', concluido: 'concluído', erro: 'erro' };
const cores = { na_fila: 'yellow', processando: 'cyan', concluido: 'green', erro: 'red' };
const coluna = (texto, largura) => String(texto ?? '').slice(0, largura).padEnd(largura);
const hora = (ms) => new Date(Number(ms)).toLocaleTimeString('pt-BR');

function barra(feito, total, largura = 20) {
  const cheio = total > 0 ? Math.round((feito / total) * largura) : 0;
  return '█'.repeat(cheio) + '░'.repeat(largura - cheio);
}

// soma o tamanho de todas as listas pdf:processando:<worker>
async function contarProcessando() {
  let total = 0;
  for await (const chaves of client.scanIterator({ MATCH: K.processando('*'), COUNT: 100 })) {
    for (const chave of chaves) total += await client.lLen(chave);
  }
  return total;
}

function linhaDoJob(job) {
  const paginas = Number(job.paginas ?? 0);
  const feito = job.status === 'concluido' ? paginas : Number(job.pagina ?? 0);
  const progresso = job.status === 'erro'
    ? coluna(`erro: ${job.erro}`, 28)
    : `${barra(feito, paginas)} ${coluna(paginas ? `${feito}/${paginas}` : '-', 7)}`;
  const status = styleText(cores[job.status] ?? 'white', coluna(rotulos[job.status], 12));
  return ` ${status} ${coluna(job.nome, 24)} ${progresso} ${coluna(job.worker, 9)}`;
}

function linhaDoEvento(e) {
  const nomes = { na_fila: 'na fila', iniciado: 'iniciado', concluido: 'concluído', reenfileirado: 'nova tentativa', erro: 'falhou' };
  const detalhe = {
    iniciado: `(${e.worker})`,
    concluido: `(${e.worker}, ${e.caracteres} caracteres)`,
    reenfileirado: `(${e.worker}, tentativa ${e.tentativas}: ${e.erro})`,
    erro: `(${e.tentativas} tentativas: ${e.erro})`,
  }[e.tipo] ?? '';
  return ` ${styleText('gray', hora(e.em))}  ${coluna(nomes[e.tipo] ?? e.tipo, 15)} ${coluna(e.nome, 24)} ${detalhe}`;
}

// 2) O estado é "puxado" do Redis a cada atualização da tela
async function desenhar() {
  const [naFila, falhas, processando, contagem, ids] = await Promise.all([
    client.lLen(K.fila),
    client.lLen(K.falhas),
    contarProcessando(),
    client.hGetAll(K.contagem),
    client.zRange(K.jobs, 0, 9, { REV: true }), // os 10 jobs mais recentes
  ]);
  const jobs = await Promise.all(ids.map((id) => client.hGetAll(K.job(id))));

  const linhas = [
    styleText('bold', ` Fila de PDFs no Redis — ${hora(Date.now())}`) + styleText('gray', '   (Ctrl+C para sair)'),
    '',
    ` Na fila: ${styleText('yellow', String(naFila))}   ` +
      `Processando: ${styleText('cyan', String(processando))}   ` +
      `Concluídos: ${styleText('green', contagem.concluidos ?? '0')}   ` +
      `Falhas: ${styleText('red', String(falhas))}   ` +
      `Retentativas: ${contagem.retentativas ?? '0'}`,
    '',
    styleText('bold', ` ${coluna('STATUS', 12)} ${coluna('ARQUIVO', 24)} ${coluna('PROGRESSO', 28)} WORKER`),
    ...jobs.map(linhaDoJob),
    '',
    styleText('bold', ' Últimos eventos (Pub/Sub pdf:eventos)'),
    ...eventos.map(linhaDoEvento),
  ];
  // \x1b[H\x1b[2J = volta o cursor ao topo e limpa a tela
  process.stdout.write('\x1b[H\x1b[2J' + linhas.join('\n') + '\n');
}

let ativo = true;
process.on('SIGINT', () => { ativo = false; });

while (ativo) {
  await desenhar();
  await new Promise((r) => setTimeout(r, 500));
}
await assinante.close();
await client.close();