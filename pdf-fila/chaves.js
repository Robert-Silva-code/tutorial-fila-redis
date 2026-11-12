// chaves.js — nomes de todas as chaves do Redis usadas no projeto
export const K = {
  fila: 'pdf:fila',                          // List: IDs esperando processamento
  falhas: 'pdf:falhas',                      // List: IDs que falharam 3 vezes (DLQ)
  jobs: 'pdf:jobs',                          // Sorted Set: ID -> instante de criação
  contagem: 'pdf:contagem',                  // Hash: concluidos, erros, retentativas
  eventos: 'pdf:eventos',                    // canal Pub/Sub para o monitor
  job: (id) => `pdf:job:${id}`,              // Hash: dados e progresso de um job
  processando: (w) => `pdf:processando:${w}`, // List: job em andamento no worker w
};

// avisa quem estiver ouvindo (o monitor) que algo aconteceu
export async function publicar(client, tipo, dados) {
  await client.publish(K.eventos, JSON.stringify({ tipo, em: Date.now(), ...dados }));
}