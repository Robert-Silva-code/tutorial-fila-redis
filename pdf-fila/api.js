// api.js — backend: recebe os PDFs do formulário e cria um job por arquivo
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { conectar } from './redis.js';
import { K, publicar } from './chaves.js';

mkdirSync('uploads', { recursive: true });
const client = await conectar();
const app = express();

// multer grava cada arquivo em uploads/ e preenche req.files
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024, files: 10 }, // até 10 arquivos de 20 MB
  fileFilter: (req, arquivo, aceitar) => aceitar(null, arquivo.mimetype === 'application/pdf'),
});

app.use(express.static('public')); // serve o formulário (public/index.html)

app.post('/pdfs', upload.array('arquivos', 10), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ erro: 'Envie ao menos um arquivo PDF.' });
  }
  const criados = [];
  for (const arquivo of req.files) {
    const id = randomUUID();
    const agora = Date.now();
    // o multer entrega o nome em latin1; isto recupera os acentos
    const nome = Buffer.from(arquivo.originalname, 'latin1').toString('utf8');

    // MULTI: o job nasce inteiro ou não nasce
    await client
      .multi()
      .hSet(K.job(id), {
        id, nome, caminho: arquivo.path, bytes: arquivo.size,
        status: 'na_fila', tentativas: 0, criadoEm: agora,
      })
      .zAdd(K.jobs, { score: agora, value: id })
      .lPush(K.fila, id) // na fila vai só o ID; os dados ficam no Hash
      .exec();

    await publicar(client, 'na_fila', { id, nome });
    criados.push({ id, nome });
  }
  res.status(202).json(criados);
});

app.get('/pdfs/:id', async (req, res) => {
  const job = await client.hGetAll(K.job(req.params.id));
  if (!job.id) return res.status(404).json({ erro: 'Job não encontrado.' });
  res.json(job);
});

app.get('/pdfs/:id/texto', async (req, res) => {
  const job = await client.hGetAll(K.job(req.params.id));
  if (job.status !== 'concluido') {
    return res.status(409).json({ erro: `O job está "${job.status ?? 'inexistente'}".` });
  }
  res.type('text/plain; charset=utf-8').sendFile(job.resultado, { root: process.cwd() });
});

// erros do multer (arquivo grande demais, muitos arquivos...)
app.use((erro, req, res, next) => res.status(400).json({ erro: erro.message }));

app.listen(3000, () => console.log('Formulário em http://localhost:3000'));