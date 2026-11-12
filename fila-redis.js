// fila-redis.js — a mesma ideia da classe Fila, agora guardada no Redis
import { randomUUID } from 'node:crypto';

export class FilaRedis {
  constructor(client, nome, { maxTentativas = 3 } = {}) {
    this.client = client;           // conexão para comandos normais
    this.nome = nome;               // ex.: 'fila:emails'
    this.falhas = `${nome}:falhas`; // fila de mensagens mortas (DLQ)
    this.maxTentativas = maxTentativas;
  }

  // enqueue: embrulha os dados numa tarefa e coloca no fim da fila
  async enfileirar(dados) {
    const tarefa = { id: randomUUID(), dados, tentativas: 0, criadaEm: Date.now() };
    await this.client.lPush(this.nome, JSON.stringify(tarefa));
    return tarefa.id;
  }

  async tamanho() {
    return {
      pendentes: await this.client.lLen(this.nome),
      falhas: await this.client.lLen(this.falhas),
    };
  }

  // devolve à fila o que ficou preso na lista de processamento de um worker
  async recuperar(workerId) {
    const processando = `${this.nome}:processando:${workerId}`;
    let recuperadas = 0;
    while (await this.client.lMove(processando, this.nome, 'RIGHT', 'RIGHT')) {
      recuperadas++;
    }
    return recuperadas;
  }

  // dequeue confiável: move a tarefa para a lista do worker antes de processar
  async consumir(bloqueante, workerId, tratar, deveContinuar) {
    const processando = `${this.nome}:processando:${workerId}`;

    while (deveContinuar()) {
      const bruto = await bloqueante.blMove(this.nome, processando, 'RIGHT', 'LEFT', 5);
      if (bruto === null) continue; // 5 s sem tarefas: confere se deve continuar

      const tarefa = JSON.parse(bruto);
      try {
        await tratar(tarefa.dados, tarefa);
        await this.client.lRem(processando, 1, bruto);            // sucesso: confirma
      } catch (erro) {
        tarefa.tentativas++;
        tarefa.ultimoErro = erro.message;
        const destino = tarefa.tentativas < this.maxTentativas ? this.nome : this.falhas;
        await this.client
          .multi()
          .lRem(processando, 1, bruto)                             // tira do processamento
          .lPush(destino, JSON.stringify(tarefa))                  // e reenfileira ou descarta
          .exec();
        console.log(`[${workerId}] tarefa ${tarefa.id} falhou (${tarefa.tentativas}x) -> ${destino}`);
      }
    }
  }
}