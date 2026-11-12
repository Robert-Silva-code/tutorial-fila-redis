// exemplo-basico.js — comandos do redis-cli, agora em JavaScript
import { conectar } from './redis.js';

const client = await conectar();

await client.set('aluno:1:nome', 'Robert');
console.log(await client.get('aluno:1:nome'));        // Robert

await client.hSet('aluno:1', { nome: 'Robert', curso: 'TSI', periodo: 4 });
console.log(await client.hGetAll('aluno:1'));         // { nome: 'Robert', curso: 'TSI', periodo: '4' }

// fila: objetos viram texto com JSON.stringify
await client.lPush('fila:emails', JSON.stringify({ para: 'robert@ex.com', assunto: 'Oi' }));
console.log(await client.lLen('fila:emails'));        // 1
const item = await client.rPop('fila:emails');
console.log(JSON.parse(item));                        // { para: 'robert@ex.com', assunto: 'Oi' }

// transação: os comandos são executados juntos, sem intercalação
const [tamanho, total] = await client
  .multi()
  .lPush('fila:emails', 'a')
  .incr('stats:enfileirados')
  .exec();
console.log(tamanho, total);                          // 1 1

await client.close();