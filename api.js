// api.js — produtor: recebe pedidos HTTP e enfileira
import express from 'express';
import { conectar } from './redis.js';
import { FilaRedis } from './fila-redis.js';

const client = await conectar();
const fila = new FilaRedis(client, 'fila:emails');
const app = express();
app.use(express.json());

app.post('/emails', async (req, res) => {
  const { para, assunto } = req.body ?? {};
  if (!para || !assunto) {
    return res.status(400).json({ erro: 'Informe "para" e "assunto".' });
  }
  const id = await fila.enfileirar({ para, assunto });
  res.status(202).json({ id, status: 'enfileirado' }); // 202 = aceito, será processado depois
});

app.get('/status', async (req, res) => {
  res.json(await fila.tamanho());
});

app.listen(3000, () => console.log('API em http://localhost:3000'));