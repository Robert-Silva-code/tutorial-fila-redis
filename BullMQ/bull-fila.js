// bull-fila.js — produtor com BullMQ
import { Queue } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };
const fila = new Queue('emails', { connection });

// tarefa simples
await fila.add('confirmacao', { para: 'ana@ifpb.edu.br', assunto: 'Inscrição confirmada' });

// até 3 tentativas, esperando 1 s, depois 2 s entre elas
await fila.add(
  'confirmacao',
  { para: 'x@invalido.com', assunto: 'Teste' },
  { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
);

// só fica disponível daqui a 3 segundos
await fila.add('lembrete', { para: 'bruno@ifpb.edu.br', assunto: 'Prova amanhã' }, { delay: 3000 });

// com prioridade (1 = a mais alta entre as priorizadas)
await fila.add('senha', { para: 'caio@ifpb.edu.br', assunto: 'Redefinir senha' }, { priority: 1 });

console.log('tarefas por estado:', await fila.getJobCounts('wait', 'delayed', 'prioritized'));
// tarefas por estado: { wait: 2, delayed: 1, prioritized: 1 }
await fila.close();