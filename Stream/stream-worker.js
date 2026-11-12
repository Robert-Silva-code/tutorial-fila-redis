// stream-worker.js — consome pedidos em grupo, com confirmação (XACK)
import { createClient } from 'redis';

const STREAM = 'fila:pedidos';
const GRUPO = 'cozinha';
const CONSUMIDOR = process.argv[2] ?? `worker-${process.pid}`;

const client = await createClient().on('error', console.error).connect();

// cria o grupo uma única vez ('0' = desde o início; '$' = só mensagens novas)
try {
  await client.xGroupCreate(STREAM, GRUPO, '0', { MKSTREAM: true });
} catch (erro) {
  if (!erro.message.includes('BUSYGROUP')) throw erro; // grupo já existe
}

async function processar(id, pedido) {
  console.log(`[${CONSUMIDOR}] preparando pedido ${pedido.pedido} de ${pedido.cliente}`);
  await new Promise((r) => setTimeout(r, 200)); // simula trabalho
}

let rodando = true;
process.on('SIGINT', () => { rodando = false; });

while (rodando) {
  // '>' = mensagens nunca entregues a ninguém do grupo; espera até 2 s
  const resposta = await client.xReadGroup(
    GRUPO, CONSUMIDOR,
    { key: STREAM, id: '>' },
    { COUNT: 10, BLOCK: 2000 },
  );
  if (!resposta) continue; // tempo esgotado, nada novo

  for (const { id, message } of resposta[0].messages) {
    await processar(id, message);
    await client.xAck(STREAM, GRUPO, id); // confirma: sai da lista de pendentes
  }
}
await client.close();