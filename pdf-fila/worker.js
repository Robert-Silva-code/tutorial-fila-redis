// worker.js — retira jobs da fila e extrai o texto, página por página
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
import { conectar } from './redis.js';
import { K, publicar } from './chaves.js';

const workerId = process.argv[2] ?? 'worker-1';
const MAX_TENTATIVAS = 3;
// pausa artificial por página, só para dar tempo de ver o progresso no monitor
const ATRASO_MS = Number(process.env.ATRASO_POR_PAGINA_MS ?? 400);

const client = await conectar();
const bloqueante = await client.duplicate().connect(); // só para o blMove
const processando = K.processando(workerId);
await mkdir('resultados', { recursive: true });

async function extrairTexto(id, caminho) {
  const parser = new PDFParse({ data: await readFile(caminho) });
  try {
    const { total } = await parser.getInfo();
    await client.hSet(K.job(id), { paginas: total, pagina: 0 });

    const partes = [];
    for (let n = 1; n <= total; n++) {
      const { text } = await parser.getText({ partial: [n] }); // só a página n
      partes.push(text);
      await client.hSet(K.job(id), { pagina: n }); // progresso visível para todos
      await new Promise((r) => setTimeout(r, ATRASO_MS));
    }

    const texto = partes.join('\n\n');
    const resultado = `resultados/${id}.txt`;
    await writeFile(resultado, texto, 'utf8');
    return { resultado, caracteres: texto.length };
  } finally {
    await parser.destroy();
  }
}

let rodando = true;
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log(`[${workerId}] encerrando após o job atual...`);
    rodando = false;
  });
}

// se este worker caiu no meio de um job, devolve o job para a fila
let preso;
while ((preso = await client.lMove(processando, K.fila, 'RIGHT', 'RIGHT'))) {
  await client.hSet(K.job(preso), { status: 'na_fila' });
  console.log(`[${workerId}] job ${preso} recuperado`);
}

console.log(`[${workerId}] aguardando PDFs...`);
while (rodando) {
  const id = await bloqueante.blMove(K.fila, processando, 'RIGHT', 'LEFT', 5);
  if (id === null) continue;

  const { nome, caminho } = await client.hGetAll(K.job(id));
  await client.hSet(K.job(id), { status: 'processando', worker: workerId, iniciadoEm: Date.now() });
  await publicar(client, 'iniciado', { id, nome, worker: workerId });
  console.log(`[${workerId}] processando ${nome}`);

  try {
    const { resultado, caracteres } = await extrairTexto(id, caminho);
    await client
      .multi()
      .hSet(K.job(id), { status: 'concluido', resultado, caracteres, concluidoEm: Date.now() })
      .hIncrBy(K.contagem, 'concluidos', 1)
      .lRem(processando, 1, id) // confirma: sai da lista de processamento
      .exec();
    await publicar(client, 'concluido', { id, nome, caracteres, worker: workerId });
    console.log(`[${workerId}] ${nome}: ${caracteres} caracteres extraídos`);
  } catch (erro) {
    const tentativas = await client.hIncrBy(K.job(id), 'tentativas', 1);
    const desistir = tentativas >= MAX_TENTATIVAS;
    await client
      .multi()
      .hSet(K.job(id), { status: desistir ? 'erro' : 'na_fila', erro: erro.message })
      .lRem(processando, 1, id)
      .lPush(desistir ? K.falhas : K.fila, id)
      .hIncrBy(K.contagem, desistir ? 'erros' : 'retentativas', 1)
      .exec();
    await publicar(client, desistir ? 'erro' : 'reenfileirado', {
      id, nome, worker: workerId, tentativas, erro: erro.message,
    });
    console.log(`[${workerId}] ${nome}: falha ${tentativas}/${MAX_TENTATIVAS} (${erro.message})`);
  }
}

await bloqueante.close();
await client.close();