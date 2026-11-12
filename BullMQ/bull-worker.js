// bull-worker.js — consumidor com BullMQ
import { Worker } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };

const worker = new Worker(
  'emails',
  async (job) => {
    const { para } = job.data;
    await new Promise((r) => setTimeout(r, 500));
    if (para.endsWith('@invalido.com')) throw new Error('domínio inexistente');
    return { enviadoEm: new Date().toISOString() }; // fica salvo como resultado
  },
  { connection, concurrency: 5 }, // até 5 tarefas ao mesmo tempo neste processo
);

worker.on('completed', (job) => console.log(`ok   #${job.id} ${job.name} -> ${job.data.para}`));
worker.on('failed', (job, erro) =>
  console.log(`erro #${job.id} tentativa ${job.attemptsMade}/${job.opts.attempts ?? 1}: ${erro.message}`));

process.on('SIGINT', async () => {
  await worker.close(); // espera as tarefas em andamento terminarem
  process.exit(0);
});