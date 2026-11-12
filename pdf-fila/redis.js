// redis.js — um único lugar para criar a conexão
import { createClient } from 'redis';

export async function conectar() {
  const client = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  });
  client.on('error', (erro) => console.error('Erro no Redis:', erro.message));
  await client.connect();
  return client;
}