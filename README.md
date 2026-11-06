# Tutorial: Redis, Filas e JavaScript

## 1. Apresentação

Ao final deste tutorial, você terá usado o Redis como servidor de filas e construído, em JavaScript, uma aplicação produtor/consumidor que não perde tarefas quando o worker cai.

**Objetivos de aprendizagem**

- Explicar o que é o Redis, por que ele é rápido e quando usá-lo.
- Operar os principais tipos de dados pelo `redis-cli`.
- Relacionar o tipo abstrato de dados Fila (FIFO) com as estruturas do Redis: List, Sorted Set e Stream.
- Implementar produtor e consumidor em Node.js com o cliente oficial `redis` (node-redis).
- Reconhecer quando trocar o código "na mão" por uma biblioteca pronta, como o BullMQ.

**Pré-requisitos**: JavaScript moderno (classes, módulos ES, `async/await`), Node.js instalado, Docker (ou o Redis instalado direto na máquina) e noções de terminal.

**Roteiro**

1. Seções 2 a 4: o que é o Redis, como instalar e seus tipos de dados.
2. Seções 5 a 8: filas — do conceito em JavaScript puro até Lists, Sorted Sets e Streams no Redis.
3. Seções 9 a 12: Redis com JavaScript, dois projetos práticos (fila de e-mails e extração de texto de PDFs) e o BullMQ.
4. Seções 13 e 14: boas práticas, armadilhas e exercícios.

## 2. O que é o Redis

O Redis (*REmote DIctionary Server*) é um banco de dados chave-valor que guarda tudo na memória RAM e, por isso, responde em frações de milissegundo. Foi criado por Salvatore Sanfilippo em 2009 e hoje é um dos serviços mais usados em back-end.

A diferença para um banco chave-valor simples é que o **valor** de cada chave pode ser uma estrutura de dados: lista, conjunto, mapa (hash), conjunto ordenado, stream e outras. Por isso o Redis é chamado de *servidor de estruturas de dados*: em vez de buscar um valor, alterá-lo na aplicação e gravá-lo de volta, você pede ao servidor a operação pronta ("insira no fim da lista", "some 1 ao contador").

**Quatro ideias que explicam o comportamento do Redis**

- **Memória primeiro.** Leitura e escrita acontecem na RAM. O limite prático de dados é a memória disponível no servidor.
- **Persistência opcional.** O Redis pode gravar fotografias periódicas em disco (RDB) e/ou um registro de cada escrita (AOF, *append-only file*). Sem nenhum dos dois, um reinício apaga os dados.
- **Um comando por vez.** Os comandos são executados um após o outro, numa única linha de execução. Consequência importante para filas: cada comando é **atômico** — dois workers nunca retiram o mesmo item com um único `RPOP`.
- **Protocolo simples via TCP.** Clientes se conectam na porta 6379 e enviam comandos de texto. Há bibliotecas para praticamente todas as linguagens, inclusive JavaScript.

**Usos comuns**: cache de consultas, sessões de usuário, contadores e limitação de requisições (*rate limiting*), rankings, mensagens em tempo real (pub/sub) e — o foco deste tutorial — **filas de tarefas** entre partes de um sistema.

**Sobre a licença**: desde o Redis 8 (maio de 2025) o "Redis Open Source" voltou a ter uma licença de código aberto aprovada pela OSI, a AGPLv3. Existe também o **Valkey**, um *fork* mantido pela Linux Foundation e compatível com os mesmos comandos; tudo o que este tutorial ensina vale para os dois.

## 3. Instalação e primeiros comandos

O jeito mais rápido de ter um Redis para aula é um contêiner Docker: um comando sobe o servidor e outro abre o terminal interativo `redis-cli`.

**Opção A — Docker (Windows, macOS ou Linux)**

```bash
# sobe o servidor em segundo plano, na porta padrão 6379
docker run -d --name redis-aula -p 6379:6379 redis:8

# abre o cliente de linha de comando dentro do contêiner
docker exec -it redis-aula redis-cli
```

**Opção B — Ubuntu/Debian (inclusive WSL no Windows)**

```bash
sudo apt update && sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # deve responder PONG
```

O pacote do Ubuntu 24.04 instala o Redis 7.0, suficiente para todos os exemplos deste tutorial. Para uma interface gráfica, o **Redis Insight** (gratuito) mostra as chaves e permite rodar comandos.

**Primeira sessão no `redis-cli`**

```text
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SET aluno:1:nome "Maria"
OK
127.0.0.1:6379> GET aluno:1:nome
"Maria"
127.0.0.1:6379> SET visitas 0
OK
127.0.0.1:6379> INCR visitas
(integer) 1
127.0.0.1:6379> INCRBY visitas 10
(integer) 11
127.0.0.1:6379> SET codigo 4821 EX 60      # expira em 60 segundos
OK
127.0.0.1:6379> TTL codigo
(integer) 58
127.0.0.1:6379> DEL aluno:1:nome
(integer) 1
127.0.0.1:6379> GET aluno:1:nome
(nil)
```

Três observações para guardar:

- **Os dois-pontos são só parte do nome** (`aluno:1:nome`): para o Redis, esse texto inteiro é **uma** chave, sem pastas nem hierarquia. A convenção `tipo:id` organiza os nomes para quem lê, permite buscas como `SCAN 0 MATCH aluno:*` e faz ferramentas como o Redis Insight exibirem as chaves em árvore. Para um objeto com vários atributos, porém, o mais comum é usar só `aluno:1` como chave e guardar `nome` como **campo** de um Hash — veja "Chave com dois-pontos ou Hash?" no fim da seção 4.
- **`INCR` é atômico**: mil clientes incrementando ao mesmo tempo nunca perdem uma contagem. É o mesmo princípio que torna as filas seguras.
- **Evite `KEYS *` em produção**: ele percorre todas as chaves de uma vez e trava o servidor. Use `SCAN 0 MATCH aluno:* COUNT 100`, que devolve as chaves aos poucos.

## 4. Tipos de dados do Redis

Cada chave do Redis guarda um tipo de dado, e o tipo decide quais comandos ela aceita. Três deles servem para montar filas: **List**, **Sorted Set** e **Stream**.

| Tipo | O que guarda | Comandos principais | Uso típico |
| --- | --- | --- | --- |
| String | Texto, número ou bytes (até 512 MB) | `SET`, `GET`, `INCR`, `EXPIRE` | Cache, contadores, tokens |
| Hash | Mapa campo → valor dentro de uma chave | `HSET`, `HGET`, `HGETALL`, `HINCRBY` | Objetos (um aluno, um pedido) |
| List | Sequência ordenada de strings, com inserção e remoção nas pontas | `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `BLMOVE`, `LRANGE` | **Filas** e pilhas |
| Set | Conjunto sem repetição e sem ordem | `SADD`, `SISMEMBER`, `SMEMBERS`, `SINTER` | Tags, "quem já votou" |
| Sorted Set | Conjunto em que cada membro tem uma nota (*score*) e fica ordenado por ela | `ZADD`, `ZRANGE`, `ZPOPMIN`, `ZRANGEBYSCORE` | Rankings, **filas de prioridade e de agendamento** |
| Stream | Registro só de inserção, com IDs por tempo e grupos de consumidores | `XADD`, `XREADGROUP`, `XACK`, `XPENDING` | **Filas com confirmação**, eventos |

Os exemplos abaixo mostram cada tipo no `redis-cli`:

```text
# Hash: um objeto com campos
127.0.0.1:6379> HSET aluno:1 nome "Maria" curso "TSI" periodo 3
(integer) 3
127.0.0.1:6379> HGET aluno:1 curso
"TSI"

# Set: sem repetição
127.0.0.1:6379> SADD disciplinas:maria redes web redes
(integer) 2
127.0.0.1:6379> SISMEMBER disciplinas:maria redes
(integer) 1

# Sorted Set: ordenado pela nota
127.0.0.1:6379> ZADD ranking 87 ana 95 bruno 72 caio
(integer) 3
127.0.0.1:6379> ZRANGE ranking 0 -1 REV WITHSCORES
1) "bruno"
2) "95"
3) "ana"
4) "87"
5) "caio"
6) "72"

# List: inserção no fim, leitura em ordem
127.0.0.1:6379> RPUSH tarefas a b c
(integer) 3
127.0.0.1:6379> LRANGE tarefas 0 -1
1) "a"
2) "b"
3) "c"

# Stream: cada entrada recebe um ID <milissegundos>-<sequência>
127.0.0.1:6379> XADD eventos * tipo login usuario maria
"1793892253809-0"
```

No `SADD` acima, `redes` aparece duas vezes, mas só é contado uma vez: o retorno `2` indica quantos membros **novos** entraram.

**Chave com dois-pontos ou Hash?**

O mesmo aluno pode ser guardado de duas formas, e as duas usam a convenção de nomes com dois-pontos. A diferença é **onde termina o nome da chave**: na primeira, o atributo faz parte do nome; na segunda, o nome para em `aluno:2` e o atributo vira um campo dentro do valor.

```text
# Forma 1 — uma String por atributo: "nome" faz parte do NOME da chave
127.0.0.1:6379> SET aluno:1:nome "Maria"
127.0.0.1:6379> SET aluno:1:curso "TSI"
127.0.0.1:6379> SET aluno:1:periodo 3
127.0.0.1:6379> GET aluno:1:nome
"Maria"

# Forma 2 — um Hash por aluno: a chave é aluno:2 e "nome" é um CAMPO
127.0.0.1:6379> HSET aluno:2 nome "Ana" curso "TSI" periodo 5
(integer) 3
127.0.0.1:6379> HGET aluno:2 nome
"Ana"
```

Lendo `HSET chave campo valor [campo valor ...]` peça por peça: `aluno:2` é a **chave** (o namespace `aluno:` mais o id `2`), `nome` é o **campo** e `"Ana"` é o **valor**. O namespace continua no nome da chave; só o último pedaço saiu do nome e foi para dentro do Hash. A listagem das chaves mostra a diferença:

```text
$ redis-cli --scan --pattern 'aluno:*'
aluno:1:curso
aluno:1:nome
aluno:1:periodo
aluno:2
```

As duas formas não se misturam: `HGET aluno:1:nome nome` falha com `WRONGTYPE`, porque `aluno:1:nome` é uma String, e `GET aluno:2` falha pelo mesmo motivo, porque `aluno:2` é um Hash.

| Critério | Forma 1: `SET aluno:1:nome ...` | Forma 2: `HSET aluno:1 nome ...` |
| --- | --- | --- |
| Chaves por aluno | Uma por atributo (3 no exemplo) | Uma só |
| Ler o aluno inteiro | `MGET` listando cada chave | `HGETALL aluno:1` |
| Memória para 1.000 alunos com 3 atributos (medido no Redis 7.0) | Cerca de 320 KB, em 3.000 chaves | Cerca de 120 KB, em 1.000 chaves |
| Apagar o aluno | Um `DEL` com todas as chaves | `DEL aluno:1` |
| Somar 1 a um atributo | `INCR aluno:1:periodo` | `HINCRBY aluno:1 periodo 1` |
| Prazo de expiração só para um atributo | `EXPIRE` na chave, em qualquer versão | `HEXPIRE`, só a partir do Redis 7.4 |

**Regra prática: um objeto = um Hash**, com a chave no formato `tipo:id` (`aluno:1`, `pdf:job:<id>`). Use chaves separadas no formato `tipo:id:atributo` quando aquele dado tiver vida própria: outro tipo de estrutura (uma List `aluno:1:notas`, um Set `aluno:1:disciplinas`), um prazo de expiração próprio, ou leitura e escrita independentes do resto. É o que os projetos deste tutorial fazem: `pdf:job:<id>` é um Hash com os dados do job, e `pdf:processando:worker-1` é uma List à parte, porque é uma fila.

## 5. Fila como estrutura de dados

Uma fila é uma coleção em que o primeiro elemento a entrar é o primeiro a sair — **FIFO** (*First In, First Out*), como a fila de um banco. Inserções acontecem só no **fim** e remoções só no **início**.

| Operação | Nome comum | O que faz | Custo esperado |
| --- | --- | --- | --- |
| `enfileirar(x)` | enqueue | Coloca `x` no fim | O(1) |
| `desenfileirar()` | dequeue | Remove e devolve o item do início | O(1) |
| `frente()` | peek / front | Mostra o item do início sem remover | O(1) |
| `tamanho()` / `estaVazia()` | size / isEmpty | Quantos itens há / se há algum | O(1) |

**5.1 Implementação com array**

A forma mais direta usa um array do JavaScript: `push` coloca no fim e `shift` retira do início.

```javascript
// fila-array.js — fila com array: push no fim, shift no início
export class FilaArray {
  #itens = [];

  enfileirar(item) {          // O(1): coloca no fim do array
    this.#itens.push(item);
  }

  desenfileirar() {           // O(n): tira o primeiro e desloca todos os outros
    return this.#itens.shift();
  }

  frente() {
    return this.#itens[0];
  }

  tamanho() {
    return this.#itens.length;
  }

  estaVazia() {
    return this.#itens.length === 0;
  }
}
```

O problema está no `shift`: para remover o primeiro elemento, ele desloca todos os outros uma posição para a esquerda. Com n itens na fila, cada remoção custa O(n), e esvaziar a fila inteira custa O(n²). A atividade da seção 5.3 mede esse efeito.

**Variação sem deslocamento.** Em vez de mover os itens a cada remoção, a classe `Fila` abaixo guarda os itens num objeto indexado por números (como as posições de um array) e apenas avança o índice `#inicio`. Assim todas as operações ficam O(1). É esta classe que as seções seguintes chamam de `Fila`.

```javascript
// fila.js — Fila (FIFO) com operações O(1)
export class Fila {
  #itens = {};   // índice -> item
  #inicio = 0;   // índice do primeiro item
  #fim = 0;      // próximo índice livre

  enfileirar(item) {          // enqueue
    this.#itens[this.#fim] = item;
    this.#fim++;
  }

  desenfileirar() {           // dequeue
    if (this.estaVazia()) return undefined;
    const item = this.#itens[this.#inicio];
    delete this.#itens[this.#inicio];
    this.#inicio++;
    return item;
  }

  frente() {                  // peek
    return this.#itens[this.#inicio];
  }

  tamanho() {
    return this.#fim - this.#inicio;
  }

  estaVazia() {
    return this.tamanho() === 0;
  }
}
```

```javascript
// teste-fila.js
import { Fila } from './fila.js';

const atendimento = new Fila();
atendimento.enfileirar('Ana');
atendimento.enfileirar('Bruno');
atendimento.enfileirar('Caio');

console.log(atendimento.frente());        // Ana
console.log(atendimento.desenfileirar()); // Ana
console.log(atendimento.desenfileirar()); // Bruno
console.log(atendimento.tamanho());       // 1
```

**5.2 Implementação encadeada**

Na fila encadeada não existe um bloco contínuo de posições. Cada item fica dentro de um **nó**, um pequeno objeto com dois campos: `valor` e `proximo`, a referência para o nó seguinte. A fila guarda só duas referências — `#inicio` (o próximo a sair) e `#fim` (o último que entrou) — e por isso nunca precisa deslocar nenhum item.

&#91;embedded content: fila encadeada · 3 nós e 1 novo\]

- **Enfileirar**: cria um nó, faz o antigo último (`#fim.proximo`) apontar para ele e move `#fim` para o nó novo. Se a fila estava vazia, o nó novo também passa a ser o `#inicio`.
- **Desenfileirar**: guarda o valor do primeiro nó e move `#inicio` para `#inicio.proximo`. O nó antigo fica sem nenhuma referência, e o coletor de lixo do JavaScript libera a memória dele. Se a fila esvaziou, `#fim` também volta a `null`.

```javascript
// fila-encadeada.js — fila com nós ligados: cada nó aponta para o próximo
class No {
  constructor(valor) {
    this.valor = valor;
    this.proximo = null;     // referência para o nó seguinte (ou null)
  }
}

export class FilaEncadeada {
  #inicio = null;            // nó que sai primeiro
  #fim = null;               // último nó que entrou
  #tamanho = 0;

  enfileirar(item) {         // O(1): liga um nó novo depois do último
    const novo = new No(item);
    if (this.#fim) {
      this.#fim.proximo = novo;  // o antigo último passa a apontar para o novo
    } else {
      this.#inicio = novo;       // fila vazia: o novo é também o primeiro
    }
    this.#fim = novo;
    this.#tamanho++;
  }

  desenfileirar() {          // O(1): o segundo nó vira o primeiro
    if (this.estaVazia()) return undefined;
    const { valor } = this.#inicio;
    this.#inicio = this.#inicio.proximo;
    if (this.#inicio === null) this.#fim = null; // a fila esvaziou
    this.#tamanho--;
    return valor;
  }

  frente() {
    return this.#inicio?.valor;
  }

  tamanho() {
    return this.#tamanho;
  }

  estaVazia() {
    return this.#tamanho === 0;
  }
}
```

O contador `#tamanho` evita percorrer os nós para saber quantos há: sem ele, `tamanho()` seria O(n). E como as três classes têm a mesma interface, o `teste-fila.js` da seção 5.1 roda sem alterações trocando só a importação — no teste deste tutorial, as três devolveram exatamente os mesmos resultados:

```javascript
import { FilaEncadeada as Fila } from './fila-encadeada.js';
```

**Array ou encadeada?**

| Característica | `FilaArray` | `Fila` (índices) | `FilaEncadeada` |
| --- | --- | --- | --- |
| Enfileirar | O(1) | O(1) | O(1) |
| Desenfileirar | O(n) | O(1) | O(1) |
| Ver a frente / tamanho | O(1) | O(1) | O(1) |
| Acessar a posição i | O(1) | O(1) | O(n): percorre os nós |
| Memória por item | Só o valor, em posições contíguas | Só o valor | O valor mais um objeto nó |
| Código | O mais curto | Curto | O mais longo |

**5.3 Atividade: comparando o desempenho**

Nesta atividade você mede, com os relógios do próprio JavaScript, quanto tempo a `FilaArray` e a `FilaEncadeada` levam para encher e esvaziar filas de tamanhos crescentes, e confere na prática a diferença entre O(1) e O(n).

*Como medir tempo em JavaScript*

| Recurso | Onde funciona | Precisão | Quando usar |
| --- | --- | --- | --- |
| `performance.now()` | Node.js e navegador | Milissegundos com fração | Medições no código: subtraia duas marcas de tempo |
| `console.time(rótulo)` e `console.timeEnd(rótulo)` | Node.js e navegador | Milissegundos com fração | Medir um trecho rapidamente; o tempo é impresso, não devolvido |
| `process.hrtime.bigint()` | Só Node.js | Nanossegundos, como `BigInt` | Trechos muito curtos |
| `Date.now()` | Node.js e navegador | Milissegundos inteiros; muda se o relógio do sistema for ajustado | Datas e horários — evite em medições de desempenho |

```javascript
// tempos.js — os três jeitos de medir, num exemplo pequeno
import { FilaEncadeada } from './fila-encadeada.js';
const fila = new FilaEncadeada();

console.time('enfileirar 100 mil');
for (let i = 0; i < 100_000; i++) fila.enfileirar(i);
console.timeEnd('enfileirar 100 mil');          // enfileirar 100 mil: 13.381ms

const inicio = process.hrtime.bigint();
while (!fila.estaVazia()) fila.desenfileirar();
const ns = process.hrtime.bigint() - inicio;     // BigInt, em nanossegundos
console.log(`desenfileirar 100 mil: ${ns} ns (${Number(ns) / 1e6} ms)`);
// desenfileirar 100 mil: 2487586 ns (2.487586 ms)
```

*O script de comparação*

```javascript
// comparar.js — mede o tempo para encher e esvaziar cada fila com N itens
import { FilaArray } from './fila-array.js';
import { FilaEncadeada } from './fila-encadeada.js';

const implementacoes = { FilaArray, FilaEncadeada };
const tamanhos = [5_000, 10_000, 20_000, 40_000, 80_000];
const REPETICOES = 3;

function medir(Classe, n) {
  const fila = new Classe();
  const t0 = performance.now();               // marca de tempo inicial (ms, com fração)
  for (let i = 0; i < n; i++) fila.enfileirar({ id: i });
  const t1 = performance.now();
  while (!fila.estaVazia()) fila.desenfileirar();
  const t2 = performance.now();
  return { enfileirar: t1 - t0, desenfileirar: t2 - t1 };
}

// mediana: o valor do meio, menos sensível a uma medição atrapalhada
function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

// aquecimento: o compilador JIT otimiza o código nas primeiras execuções
for (const Classe of Object.values(implementacoes)) medir(Classe, 10_000);

const resultados = [];
for (const n of tamanhos) {
  for (const [nome, Classe] of Object.entries(implementacoes)) {
    const medidas = Array.from({ length: REPETICOES }, () => medir(Classe, n));
    resultados.push({
      fila: nome,
      n,
      'enfileirar (ms)': Number(mediana(medidas.map((m) => m.enfileirar)).toFixed(2)),
      'desenfileirar (ms)': Number(mediana(medidas.map((m) => m.desenfileirar)).toFixed(2)),
    });
  }
}
console.table(resultados);
```

O script inteiro roda em cerca de 2 segundos. Evite passar de 80 mil itens: no teste, com 160 mil a `FilaArray` levou de 2 a 18 segundos por medição, e a execução completa passou de 1 minuto.

*Roteiro*

1. Na mesma pasta, reúna `fila-array.js`, `fila-encadeada.js` e `comparar.js`, com `"type": "module"` no `package.json`.
2. Rode `node comparar.js` três vezes e anote na tabela abaixo os valores da última execução.
3. Numa planilha, faça um gráfico de linhas com n no eixo horizontal e o tempo de desenfileirar no vertical, uma linha por implementação.
4. Responda às perguntas de discussão.

| n | FilaArray: enfileirar (ms) | FilaArray: desenfileirar (ms) | FilaEncadeada: enfileirar (ms) | FilaEncadeada: desenfileirar (ms) |
| --- | --- | --- | --- | --- |
| 5.000 |  |  |  |  |
| 10.000 |  |  |  |  |
| 20.000 |  |  |  |  |
| 40.000 |  |  |  |  |
| 80.000 |  |  |  |  |

*Perguntas para discussão*

1. Quando n dobra (20 mil → 40 mil → 80 mil), por quanto o tempo de desenfileirar é multiplicado em cada implementação? Relacione com O(n²) para esvaziar a `FilaArray` e O(n) para esvaziar a `FilaEncadeada`.
2. Por que o tempo de enfileirar é parecido nas duas?
3. Com 5 mil e 10 mil itens, a `FilaArray` pode parecer quase tão rápida quanto a encadeada. Por quê? Dica: o desempenho real também depende de otimizações do motor V8, que executa o JavaScript no Node.js e no Chrome; pesquise como ele trata o `shift` em arrays pequenos.
4. Por que o script repete cada medição e usa a mediana, em vez de medir uma vez só? E para que serve o aquecimento antes das medições?
5. Por que `Date.now()` não é uma boa escolha para estas medições?
6. **Memória.** Adapte o script para ler `process.memoryUsage().heapUsed` antes e depois de enfileirar 1 milhão de números em cada fila. Rode com `node --expose-gc` e chame `globalThis.gc()` antes de cada leitura. Qual fila usa mais memória, e por quê?
7. **Desafio.** Inclua a classe `Fila` (índices) da seção 5.1 em `implementacoes` e compare as três. Depois, rode o teste no console do navegador (DevTools) e compare com o Node.js.

**Por que levar a fila para o Redis?** A classe `Fila` vive na memória de **um** processo. Se o processo cair, as tarefas somem; e outro programa, em outra máquina, não enxerga essa fila. Em sistemas reais, quem **produz** tarefas (uma API web) e quem **consome** (um ou mais *workers*) são processos diferentes. O Redis resolve isso: a fila passa a morar num servidor compartilhado, com operações atômicas e persistência opcional.

## 6. Fila no Redis com Lists

Uma List do Redis já é uma fila: inserir por uma ponta e remover pela outra dá FIFO, e as duas operações são O(1). A convenção mais usada é **`LPUSH` para enfileirar** (entra pela esquerda) e **`RPOP` para desenfileirar** (sai pela direita).

**6.1 Esquerda e direita: como o Redis enxerga uma List**

Pense na List como uma fileira horizontal com duas pontas: a **esquerda** (*left*, o início, posição `0`) e a **direita** (*right*, o fim, posição `-1`). Todo comando de inserção ou remoção diz em qual ponta age, e é a combinação das pontas que decide se você tem uma fila ou uma pilha.

&#91;embedded content: as duas pontas de uma List · 3 elementos\]

- **Posições (índices)**: os positivos contam a partir da esquerda (`0`, `1`, `2`...); os negativos, a partir da direita (`-1` é o último, `-2` o penúltimo). Assim você chega ao fim da List sem saber o tamanho dela.
- **Fila (FIFO)** = entrar por uma ponta e sair pela outra: `LPUSH` + `RPOP`, ou o espelho `RPUSH` + `LPOP`. As duas formas funcionam; escolha uma e use sempre a mesma no projeto.
- **Pilha (LIFO)** = entrar e sair pela mesma ponta: `LPUSH` + `LPOP`, ou `RPUSH` + `RPOP`.
- **Ninguém cria nem apaga a fila à mão**: a List nasce no primeiro `LPUSH`/`RPUSH` e some sozinha quando o último elemento sai. Depois disso, `EXISTS fila` responde `0`, e `LLEN fila` responde `0` sem erro.
- **Uma chave, um tipo**: `LPUSH` numa chave que guarda uma String falha com `WRONGTYPE Operation against a key holding the wrong kind of value`.

**6.2 Como ler o nome dos comandos**

Os nomes dos comandos são pedacinhos colados, e cada pedacinho tem um significado fixo. Quem aprende os pedacinhos lê `BRPOP` como "retire da direita, esperando se estiver vazia" sem precisar decorar. A ordem é sempre a mesma: **\[B\] + \[tipo ou ponta\] + VERBO + \[sufixo\]**.

**Prefixos**

| Pedacinho | Vem do inglês | Significado | Exemplos |
| --- | --- | --- | --- |
| `B` (no começo) | *Blocking* | Bloqueante: se não houver o que retirar, a conexão espera até chegar um item ou acabar o tempo | `BRPOP`, `BLPOP`, `BLMOVE`, `BZPOPMIN` |
| `L` antes de `PUSH`/`POP` | *Left* | Ponta **esquerda** (início) | `LPUSH`, `LPOP`, `BLPOP` |
| `R` | *Right* | Ponta **direita** (fim) | `RPUSH`, `RPOP`, `BRPOP` |
| `L` nos demais | *List* | Comando do tipo List que não escolhe ponta pelo nome | `LLEN`, `LRANGE`, `LINDEX`, `LREM`, `LMOVE` |
| `M` depois do tipo | *Multi* | Recebe várias chaves e age na primeira que não estiver vazia | `LMPOP`, `BLMPOP`, `ZMPOP` |
| `Z` | — | Comando de Sorted Set (seção 7) | `ZADD`, `ZPOPMIN`, `ZRANGE` |
| `X` | — | Comando de Stream (seção 8) | `XADD`, `XREADGROUP`, `XACK` |
| `H` / `S` | *Hash* / *Set* | Comando de Hash / de Set (seção 4) | `HSET`, `SADD` |

A única pegadinha é o `L`, que tem dois sentidos. A regra prática: **se logo depois do `L` vem `PUSH` ou `POP`, ele quer dizer *Left***; em qualquer outro caso, quer dizer *List*. Por isso `LPUSH` é "empurre na esquerda", mas `LLEN` é "tamanho da List". Em `LMOVE` e `LMPOP` o `L` é *List*, e a ponta vai como argumento (`LEFT` ou `RIGHT`).

**Verbos e sufixos**

| Pedacinho | Vem do inglês | Significado |
| --- | --- | --- |
| `PUSH` | *push*, empurrar | Insere |
| `POP` | *pop*, estourar/tirar | Remove **e devolve** (ler e apagar num passo só) |
| `MOVE` | *move* | Retira de uma chave e insere em outra, de uma vez |
| `LEN` | *length* | Tamanho |
| `INDEX` | *index* | Elemento numa posição |
| `RANGE` | *range*, intervalo | Elementos entre duas posições (ou duas notas) |
| `REM` | *remove* | Apaga elementos pelo valor |
| `ADD` | *add* | Acrescenta (Sorted Set e Stream) |
| `MIN` / `MAX` | *minimum* / *maximum* | O de menor / maior nota |
| `ACK` | *acknowledge*, confirmar | Confirma que uma mensagem foi processada |

**Decompondo os comandos usados neste tutorial**

| Comando | Pedacinhos | Leitura |
| --- | --- | --- |
| `LPUSH` | L + PUSH | Insira na esquerda |
| `RPUSH` | R + PUSH | Insira na direita |
| `LPOP` | L + POP | Retire da esquerda |
| `RPOP` | R + POP | Retire da direita |
| `BLPOP` | B + L + POP | Retire da esquerda, esperando se estiver vazia |
| `BRPOP` | B + R + POP | Retire da direita, esperando se estiver vazia |
| `LLEN` | L + LEN | Tamanho da List |
| `LINDEX` | L + INDEX | Leia a posição indicada, sem remover |
| `LRANGE` | L + RANGE | Leia um intervalo de posições, sem remover |
| `LREM` | L + REM | Apague elementos com este valor |
| `LMOVE` | L + MOVE | Mova um elemento de uma List para outra |
| `BLMOVE` | B + L + MOVE | Mova, esperando se a origem estiver vazia |
| `LMPOP` | L + M + POP | Retire da primeira List não vazia entre várias |
| `BZPOPMIN` | B + Z + POP + MIN | Retire o membro de menor nota do Sorted Set, esperando |
| `RPOPLPUSH` (obsoleto) | R + POP + L + PUSH | Retire da direita de uma List e insira na esquerda de outra: é o antecessor do `LMOVE` |

No JavaScript (node-redis), os pedacinhos continuam no nome do método: os prefixos ficam minúsculos e cada palavra seguinte ganha inicial maiúscula — `lPush`, `brPop`, `blMove`, `zPopMin`, `xReadGroup`.

**6.3 Os comandos de fila, um a um**

Cada comando abaixo traz a sintaxe, o que faz, o que devolve e um exemplo executado. Na sintaxe, `[ ]` marca o que é opcional, `...` indica que o item pode se repetir e `|` separa alternativas.

*Inserir*

- `LPUSH chave valor [valor ...]` — insere na esquerda e **devolve o novo tamanho** da List. Com vários valores, cada um entra pela esquerda na ordem escrita, então o último fica na frente. Custo O(1) por valor.
- `RPUSH chave valor [valor ...]` — o mesmo, pela direita.

```text
127.0.0.1:6379> LPUSH f a b c     # a entra, b entra à esquerda de a, c à esquerda de b
(integer) 3
127.0.0.1:6379> LRANGE f 0 -1
1) "c"
2) "b"
3) "a"
127.0.0.1:6379> RPUSH f d         # d entra pela direita
(integer) 4
127.0.0.1:6379> LRANGE f 0 -1
1) "c"
2) "b"
3) "a"
4) "d"
```

*Retirar (remove e devolve)*

- `RPOP chave [quantidade]` — remove o elemento da direita e o devolve; `(nil)` se a List estiver vazia ou não existir. Com `quantidade` (Redis 6.2+), retira até esse número de elementos de uma vez.
- `LPOP chave [quantidade]` — o mesmo, pela esquerda.

```text
127.0.0.1:6379> RPOP f 2          # continuando: f = c b a d
1) "d"
2) "a"
127.0.0.1:6379> LPOP f
"c"
```

*Retirar esperando (bloqueantes)*

- `BRPOP chave [chave ...] tempo` — igual ao `RPOP`, mas se **todas** as chaves estiverem vazias, a conexão espera. O `tempo` é em **segundos**, aceita decimais (`0.5` esperou 516 ms no teste) e `0` significa "sem limite". Devolve **dois** valores: o nome da chave de onde o item saiu e o item, porque você pode ter passado várias chaves. Se o tempo acabar, devolve `(nil)`. As chaves são verificadas na ordem escrita.
- `BLPOP chave [chave ...] tempo` — o mesmo, pela esquerda.
- `LMPOP número_de_chaves chave [chave ...] LEFT|RIGHT [COUNT n]` e a versão bloqueante `BLMPOP tempo número_de_chaves ...` (Redis 7.0+) — retiram da primeira chave não vazia, com a ponta escolhida no argumento. O número antes das chaves diz quantas chaves vêm a seguir.

```text
127.0.0.1:6379> RPUSH fila:baixa relatorio
(integer) 1
127.0.0.1:6379> LMPOP 2 fila:alta fila:baixa RIGHT   # 2 = duas chaves
1) "fila:baixa"                                     # fila:alta estava vazia
2) 1) "relatorio"
```

*Consultar sem remover*

- `LLEN chave` — número de elementos; `0` se a chave não existe. O(1).
- `LINDEX chave posição` — lê um elemento sem removê-lo. `LINDEX fila 0` lê a esquerda; `LINDEX fila -1`, a direita (o próximo a sair numa fila `LPUSH` + `RPOP`). O(1) nas pontas.
- `LRANGE chave início fim` — lê um intervalo, **incluindo as duas pontas**: `LRANGE fila 0 1` devolve os dois primeiros, `LRANGE fila 0 -1` devolve tudo. O(n): use para depurar, não no laço do worker.

*Mover entre Lists*

- `LMOVE origem destino LEFT|RIGHT LEFT|RIGHT` — retira de uma ponta da origem e insere numa ponta do destino, **num único passo atômico**, e devolve o elemento movido. O primeiro `LEFT|RIGHT` diz **de onde sai**; o segundo, **onde entra**.
- `BLMOVE origem destino LEFT|RIGHT LEFT|RIGHT tempo` — o mesmo, esperando se a origem estiver vazia (tempo em segundos).

```text
127.0.0.1:6379> RPUSH origem 1 2 3
(integer) 3
127.0.0.1:6379> LMOVE origem destino RIGHT LEFT   # sai da direita da origem, entra na esquerda do destino
"3"
127.0.0.1:6379> LMOVE origem destino LEFT LEFT    # sai da esquerda da origem, entra na esquerda do destino
"1"
127.0.0.1:6379> LRANGE origem 0 -1
1) "2"
127.0.0.1:6379> LRANGE destino 0 -1
1) "1"
2) "3"
```

*Apagar um valor específico*

- `LREM chave quantidade valor` — apaga elementos **iguais** a `valor` e devolve quantos apagou. O sinal de `quantidade` diz por onde começar: positivo = as primeiras N ocorrências a partir da esquerda; negativo = a partir da direita; `0` = todas. O(n), porque percorre a List.

```text
127.0.0.1:6379> RPUSH r x y x z x
(integer) 5
127.0.0.1:6379> LREM r 1 x        # primeira x pela esquerda   -> y x z x
(integer) 1
127.0.0.1:6379> LREM r -1 x       # primeira x pela direita    -> y x z
(integer) 1
127.0.0.1:6379> LREM r 0 x        # todas as x que sobraram    -> y z
(integer) 1
```

**Resumo: a fila e seus comandos**

| Operação da fila | Comando | Devolve |
| --- | --- | --- |
| Enfileirar | `LPUSH fila item` | O novo tamanho |
| Desenfileirar | `RPOP fila` | O item, ou `(nil)` se vazia |
| Desenfileirar esperando | `BRPOP fila 5` | O nome da fila e o item, ou `(nil)` após 5 s |
| Ver o próximo a sair | `LINDEX fila -1` | O item, sem removê-lo |
| Tamanho | `LLEN fila` | Um número (`0` se vazia) |
| Retirar com segurança | `BLMOVE fila processando RIGHT LEFT 5` | O item, que fica guardado em `processando` |
| Confirmar o processamento | `LREM processando 1 item` | `1` se apagou |

**6.4 Fila simples na prática**

```text
127.0.0.1:6379> LPUSH fila:emails email-1
(integer) 1
127.0.0.1:6379> LPUSH fila:emails email-2
(integer) 2
127.0.0.1:6379> LPUSH fila:emails email-3
(integer) 3
127.0.0.1:6379> LRANGE fila:emails 0 -1
1) "email-3"
2) "email-2"
3) "email-1"
127.0.0.1:6379> RPOP fila:emails
"email-1"          # o primeiro que entrou é o primeiro que sai
```

**6.5 Consumidor sem desperdício: `BRPOP`**

Um worker que chama `RPOP` em laço fica perguntando "tem tarefa?" milhares de vezes por segundo quando a fila está vazia. O `BRPOP` resolve: a conexão fica **bloqueada** até chegar um item ou acabar o tempo limite.

```text
# Terminal 1 (worker) — fica esperando
127.0.0.1:6379> BRPOP fila:emails 0

# Terminal 2 (produtor)
127.0.0.1:6379> LPUSH fila:emails email-4

# Terminal 1 recebe na hora o nome da fila e o item:
1) "fila:emails"
2) "email-4"
```

Com vários workers bloqueados na mesma fila, cada item vai para **um único** worker — o que está esperando há mais tempo. É assim que se divide o trabalho entre processos sem nenhuma coordenação extra.

**6.6 Fila confiável: `BLMOVE` e a lista de processamento**

`RPOP` e `BRPOP` **apagam** o item no momento da leitura. Se o worker travar no meio do trabalho, a tarefa se perde. O padrão "fila confiável" usa duas listas:

1. O worker executa `BLMOVE fila:emails fila:emails:processando RIGHT LEFT 5`, que **move** o item de uma lista para a outra numa única operação atômica.
2. Ao terminar com sucesso, remove o item da lista de processamento com `LREM fila:emails:processando 1 <item>`.
3. Se o worker morrer antes do passo 2, o item continua em `fila:emails:processando`, e um processo de recuperação pode devolvê-lo à fila principal.

```text
127.0.0.1:6379> LPUSH fila:emails '{"id":1,"para":"ana@ex.com"}'
(integer) 1
127.0.0.1:6379> BLMOVE fila:emails fila:emails:processando RIGHT LEFT 5
"{\"id\":1,\"para\":\"ana@ex.com\"}"
127.0.0.1:6379> LREM fila:emails:processando 1 '{"id":1,"para":"ana@ex.com"}'
(integer) 1      # confirmado: tarefa concluída
```

Dois cuidados com esse padrão. Primeiro, `BLMOVE` e `LMOVE` existem desde o Redis 6.2 e substituem os antigos `BRPOPLPUSH`/`RPOPLPUSH`, hoje marcados como obsoletos. Segundo, `LREM` percorre a lista (O(n)); por isso, em produção, cada worker costuma ter **sua própria** lista de processamento (`fila:emails:processando:worker-1`), que fica pequena e ainda indica quem estava com cada tarefa.

## 7. Filas de prioridade e de atraso

Quando a ordem não é "quem chegou primeiro", e sim "quem é mais urgente" ou "quem já está na hora", o Sorted Set faz o papel da fila: a nota (*score*) decide quem sai primeiro.

**Lendo os nomes dos comandos de Sorted Set**

Todos começam com `Z`, e os verbos são os mesmos da seção 6.2. Num Sorted Set não há esquerda e direita: a ordem vem da nota, por isso a "ponta" aparece como sufixo `MIN` (menor nota) ou `MAX` (maior nota).

| Comando | Pedacinhos | O que faz | Devolve |
| --- | --- | --- | --- |
| `ZADD chave nota membro [nota membro ...]` | Z + ADD | Insere membros, ou atualiza a nota de quem já existe | Quantos membros **novos** entraram |
| `ZPOPMIN chave [quantidade]` | Z + POP + MIN | Retira o membro de menor nota | O membro e a nota |
| `ZPOPMAX chave [quantidade]` | Z + POP + MAX | Retira o membro de maior nota | O membro e a nota |
| `BZPOPMIN chave [chave ...] tempo` | B + Z + POP + MIN | Como `ZPOPMIN`, esperando até `tempo` segundos | A chave, o membro e a nota, ou `(nil)` |
| `ZRANGE chave mín máx BYSCORE [LIMIT início qtd]` | Z + RANGE | Lista, sem remover, os membros com nota entre `mín` e `máx` (`-inf`/`+inf` = sem limite) | Os membros, em ordem de nota |
| `ZREM chave membro [membro ...]` | Z + REM | Apaga membros específicos | Quantos apagou (`0` se já tinham saído) |
| `ZCARD chave` | Z + CARD | Conta os membros (*cardinality*, cardinalidade) | Um número |

`ZRANGE ... BYSCORE` substitui o antigo `ZRANGEBYSCORE`, que ainda funciona mas é considerado obsoleto desde o Redis 6.2.

**7.1 Fila de prioridade com Sorted Set**

Use a prioridade como nota (1 = mais urgente) e retire com `ZPOPMIN`, que remove o membro de **menor** nota. A versão bloqueante é `BZPOPMIN`.

```text
127.0.0.1:6379> ZADD fila:suporte 3 ticket-a 1 ticket-b 2 ticket-c
(integer) 3
127.0.0.1:6379> ZADD fila:suporte 1 ticket-d
(integer) 1
127.0.0.1:6379> ZPOPMIN fila:suporte
1) "ticket-b"
2) "1"
127.0.0.1:6379> ZPOPMIN fila:suporte
1) "ticket-d"
2) "1"
127.0.0.1:6379> BZPOPMIN fila:suporte 5
1) "fila:suporte"
2) "ticket-c"
3) "2"
```

Atenção ao empate: `ticket-b` e `ticket-d` têm nota 1, e o Redis desempata pela **ordem alfabética** do membro, não pela ordem de chegada. Se precisar de FIFO dentro da mesma prioridade, use a alternativa abaixo.

**7.2 Prioridade com várias Lists**

`BRPOP` aceita várias chaves e verifica na **ordem em que foram passadas**. Com uma List por nível, o worker sempre esvazia a fila alta antes da normal, e cada nível continua FIFO:

```text
BRPOP fila:alta fila:normal fila:baixa 0
```

Em JavaScript (o cliente é apresentado na seção 9), o teste abaixo enfileirou `relatorio` na baixa, `email` na normal e `senha` na alta, nessa ordem:

```javascript
for (let i = 0; i < 3; i++) {
  console.log(await client.brPop(['fila:alta', 'fila:normal', 'fila:baixa'], 1));
}
// { key: 'fila:alta', element: 'senha' }
// { key: 'fila:normal', element: 'email' }
// { key: 'fila:baixa', element: 'relatorio' }
```

**7.3 Fila de atraso (agendamento)**

Para executar uma tarefa daqui a 10 minutos, guarde-a num Sorted Set com a nota igual ao **instante de execução** em milissegundos. Um processo "agendador" consulta periodicamente as tarefas cuja nota já passou de `Date.now()` e as move para a fila principal.

```javascript
// agendador.js — fila de atraso: move tarefas vencidas para a fila principal
import { createClient } from 'redis';

const client = await createClient().on('error', console.error).connect();

// agenda uma tarefa para daqui a "ms" milissegundos
async function agendar(tarefa, ms) {
  await client.zAdd('fila:agendada', {
    score: Date.now() + ms,
    value: JSON.stringify(tarefa),
  });
}

async function moverVencidas() {
  const vencidas = await client.zRange('fila:agendada', '-inf', Date.now(), {
    BY: 'SCORE',
    LIMIT: { offset: 0, count: 100 },
  });
  for (const tarefa of vencidas) {
    // só enfileira quem conseguiu remover: evita duplicar com 2 agendadores
    if ((await client.zRem('fila:agendada', tarefa)) === 1) {
      await client.lPush('fila:emails', tarefa);
    }
  }
  return vencidas.length;
}

// demonstração
await client.del(['fila:agendada', 'fila:emails']);
await agendar({ id: 1, assunto: 'Lembrete da prova' }, 1000);
await agendar({ id: 2, assunto: 'Resultado' }, 60000);
console.log('agora:', await moverVencidas());            // agora: 0
await new Promise((r) => setTimeout(r, 1100));
console.log('após 1,1 s:', await moverVencidas());       // após 1,1 s: 1
console.log(await client.lRange('fila:emails', 0, -1));  // [ '{"id":1,...}' ]
console.log('ainda agendadas:', await client.zCard('fila:agendada')); // 1
await client.close();
```

O truque está no `zRem`: ele devolve `1` apenas para quem de fato removeu o item. Se dois agendadores lerem a mesma tarefa, só um a enfileira. Resta uma janela pequena: se o processo cair entre o `zRem` e o `lPush`, a tarefa se perde. A solução completa é fazer as duas operações num script Lua (`client.eval`), que o Redis executa de forma atômica — bom tema para o exercício 4.

## 8. Redis Streams e grupos de consumidores

O Stream é a estrutura do Redis feita para filas com **confirmação de processamento**: a mensagem entregue a um worker fica marcada como pendente até ele confirmar com `XACK`, e outro worker pode assumi-la se o primeiro morrer. É a fila confiável da seção 6.6, só que já embutida no servidor.

**Conceitos**

- **Entrada**: cada `XADD` cria uma entrada com ID `<milissegundos>-<sequência>` e um conjunto de campos, como um pequeno hash.
- **Grupo de consumidores**: um nome (ex.: `cozinha`) que reparte as entradas entre os consumidores do grupo. Cada entrada vai para **um** consumidor do grupo.
- **PEL** (*Pending Entries List*): lista das entradas entregues e ainda não confirmadas, com o nome de quem as recebeu.
- **Reivindicação**: `XAUTOCLAIM` transfere para outro consumidor as entradas pendentes há mais de N milissegundos.

**Lendo os nomes dos comandos de Stream**

Todos começam com `X`. Streams não têm versão com prefixo `B`: para esperar, você passa a opção `BLOCK` — e ela é medida em **milissegundos**, ao contrário de `BRPOP` e `BLMOVE`, que usam segundos. `BLOCK 2000` são 2 segundos; `BRPOP fila 2000` esperaria mais de meia hora.

| Comando | Pedacinhos | O que faz | Devolve |
| --- | --- | --- | --- |
| `XADD chave * campo valor [...]` | X + ADD | Acrescenta uma entrada no fim; `*` pede ao Redis para gerar o ID | O ID criado |
| `XGROUP CREATE chave grupo id [MKSTREAM]` | X + GROUP, subcomando CREATE | Cria um grupo de consumidores; `MKSTREAM` cria o stream se ele não existir | `OK` (ou erro `BUSYGROUP` se o grupo já existe) |
| `XREADGROUP GROUP grupo consumidor [COUNT n] [BLOCK ms] STREAMS chave id` | X + READ + GROUP | Lê como membro de um grupo; o id `>` significa "só mensagens nunca entregues" | As entradas, ou `(nil)` se o `BLOCK` acabar |
| `XACK chave grupo id [id ...]` | X + ACK | Confirma o processamento e tira a entrada da lista de pendentes | Quantas confirmou |
| `XPENDING chave grupo` | X + PENDING | Mostra as entregues e ainda não confirmadas, e com quem estão | Total, menor e maior ID, pendências por consumidor |
| `XAUTOCLAIM chave grupo consumidor ms início [COUNT n]` | X + AUTO + CLAIM | Transfere para `consumidor` as pendentes paradas há mais de `ms` milissegundos | Um cursor para a próxima chamada (`0-0` = acabou) e as entradas |
| `XLEN chave` / `XTRIM chave MAXLEN ~ n` | X + LEN / X + TRIM | Conta as entradas / apara o stream para cerca de `n` entradas | Um número |

**Sessão no `redis-cli`**

```text
127.0.0.1:6379> XADD fila:pedidos * pedido 101 cliente ana
"1793892401815-0"
127.0.0.1:6379> XADD fila:pedidos * pedido 102 cliente bruno
"1793892401819-0"
127.0.0.1:6379> XGROUP CREATE fila:pedidos cozinha 0 MKSTREAM
OK

# cada worker lê mensagens novas ('>') do grupo
127.0.0.1:6379> XREADGROUP GROUP cozinha worker-1 COUNT 1 STREAMS fila:pedidos >
1) 1) "fila:pedidos"
   2) 1) 1) "1793892401815-0"
         2) 1) "pedido" 2) "101" 3) "cliente" 4) "ana"
127.0.0.1:6379> XREADGROUP GROUP cozinha worker-2 COUNT 1 STREAMS fila:pedidos >
   ... recebe o pedido 102

# worker-1 terminou e confirma; worker-2 travou e não confirma
127.0.0.1:6379> XACK fila:pedidos cozinha 1793892401815-0
(integer) 1
127.0.0.1:6379> XPENDING fila:pedidos cozinha
1) (integer) 1                    # uma pendente
2) "1793892401819-0"
3) "1793892401819-0"
4) 1) 1) "worker-2"  2) "1"       # com o worker-2

# worker-3 assume o que está parado há mais de 500 ms
127.0.0.1:6379> XAUTOCLAIM fila:pedidos cozinha worker-3 500 0-0 COUNT 10
1) "0-0"
2) 1) 1) "1793892401819-0"
      2) 1) "pedido" 2) "102" 3) "cliente" 4) "bruno"
```

**Produtor e worker em JavaScript**

```javascript
// stream-produtor.js — publica pedidos no stream
import { createClient } from 'redis';

const client = await createClient().on('error', console.error).connect();

for (const [pedido, cliente] of [[101, 'ana'], [102, 'bruno'], [103, 'caio']]) {
  const id = await client.xAdd(
    'fila:pedidos', '*',
    { pedido: String(pedido), cliente },
    // mantém o stream com cerca de 10 mil entradas, no máximo
    { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10000 } },
  );
  console.log('publicado', id);
}
await client.close();
```

```javascript
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
```

Rode dois workers em terminais separados (`node stream-worker.js worker-1` e `node stream-worker.js worker-2`) e depois o produtor: os pedidos são repartidos entre os dois, e `XPENDING fila:pedidos cozinha` mostra zero pendentes ao final.

**Qual estrutura escolher?**

| Necessidade | List | Sorted Set | Stream |
| --- | --- | --- | --- |
| FIFO simples e rápido | Sim | Não (ordena por nota) | Sim |
| Prioridade ou agendamento | Uma List por nível | Sim | Não |
| Confirmação e reentrega | Manual (`BLMOVE` + `LREM`) | Manual | Nativa (`XACK`, `XAUTOCLAIM`) |
| Vários grupos lendo a mesma mensagem | Não | Não | Sim (um grupo por serviço) |
| Histórico após o consumo | Não (item removido) | Não | Sim, até ser aparado |
| Complexidade de uso | Baixa | Média | Média |

O stream não apaga entradas confirmadas: elas ficam como histórico. Por isso o produtor usa `TRIM` com `MAXLEN ~ 10000`, que mantém o tamanho sob controle.

## 9. Redis com JavaScript (node-redis)

O cliente oficial do Redis para Node.js é o pacote `redis` (node-redis), hoje na versão 6.3 e compatível com Node.js 20 ou superior. Cada comando do `redis-cli` vira um método assíncrono com nome em *camelCase*: `LPUSH` → `lPush`, `BRPOP` → `brPop`, `HGETALL` → `hGetAll`.

**Preparando o projeto**

```bash
mkdir filas-redis && cd filas-redis
npm init -y
npm pkg set type=module      # habilita import/export (módulos ES)
npm install redis
```

**Conexão reutilizável**

```javascript
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
```

O ouvinte de `error` é obrigatório na prática: sem ele, uma queda de rede derruba o processo. Com ele, o cliente tenta reconectar sozinho. Para um Redis com senha, use `redis://usuario:senha@host:6379`.

**Os comandos que você já conhece**

```javascript
// exemplo-basico.js — comandos do redis-cli, agora em JavaScript
import { conectar } from './redis.js';

const client = await conectar();

await client.set('aluno:1:nome', 'Maria');
console.log(await client.get('aluno:1:nome'));        // Maria

await client.hSet('aluno:1', { nome: 'Maria', curso: 'TSI', periodo: 3 });
console.log(await client.hGetAll('aluno:1'));         // { nome: 'Maria', curso: 'TSI', periodo: '3' }

// fila: objetos viram texto com JSON.stringify
await client.lPush('fila:emails', JSON.stringify({ para: 'ana@ex.com', assunto: 'Oi' }));
console.log(await client.lLen('fila:emails'));        // 1
const item = await client.rPop('fila:emails');
console.log(JSON.parse(item));                        // { para: 'ana@ex.com', assunto: 'Oi' }

// transação: os comandos são executados juntos, sem intercalação
const [tamanho, total] = await client
  .multi()
  .lPush('fila:emails', 'a')
  .incr('stats:enfileirados')
  .exec();
console.log(tamanho, total);                          // 1 1

await client.close();
```

**Três regras que evitam a maioria dos erros**

1. **O Redis guarda texto.** Converta objetos com `JSON.stringify` ao enviar e `JSON.parse` ao ler. Números também voltam como texto (`periodo: '3'`), e alguns comandos recusam números: `client.lPush('fila', 5)` lança o erro *must be of type "string | Buffer"*. Use `String(5)`.
2. **As respostas já vêm convertidas.** `brPop` devolve `{ key, element }` ou `null` quando o tempo acaba; `zPopMin` devolve `{ value, score }`; `hGetAll` devolve um objeto.
3. **Comando bloqueante precisa de conexão própria.** Enquanto um `brPop` espera, a conexão inteira fica parada, e todos os outros comandos dela esperam junto. Neste ambiente, um `ping` enviado durante um `brPop` de 2 segundos na mesma conexão levou 2.078 ms para responder; numa conexão separada, respondeu na hora. Crie a conexão extra com `client.duplicate()`:

```javascript
const client = await conectar();               // comandos normais
const bloqueante = await client.duplicate().connect(); // só para brPop/blMove/xReadGroup com BLOCK
```

Existe também o cliente **ioredis**, muito usado e base do BullMQ (seção 11). Os conceitos são os mesmos; mudam os nomes dos métodos (em ioredis, `client.lpush`, tudo minúsculo).

## 10. Projeto prático: fila de e-mails com API e workers

Uma API Express recebe pedidos de envio de e-mail e responde na hora com `202 Accepted`; dois workers retiram as tarefas da fila, com recuperação após queda, até 3 tentativas por tarefa e uma fila de falhas para o que não deu certo. O envio é simulado, para o foco ficar na fila.

&#91;embedded content: fluxo de uma tarefa · 4 listas, 2 decisões\]

Durante todo o trabalho, a tarefa fica na lista de processamento do worker; só o `LREM` final a remove do Redis, e uma queda a devolve à fila com `LMOVE` quando o worker reinicia.

**Estrutura de arquivos**

```text
filas-redis/
├── package.json      ("type": "module")
├── redis.js          conexão (seção 9)
├── fila-redis.js     classe FilaRedis
├── api.js            produtor
└── worker.js         consumidor
```

```bash
npm install redis express
```

**10.1 A classe `FilaRedis`**

Compare com a classe `Fila` da seção 5: a interface é parecida (`enfileirar`, `tamanho`), mas os dados moram no Redis e o "desenfileirar" vira `consumir`, que aplica o padrão de fila confiável da seção 6.6.

```javascript
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
```

Pontos para discutir em aula:

- **`blMove` com tempo limite de 5 s** em vez de `0`: o laço volta periodicamente para checar `deveContinuar()`, o que permite encerrar o worker sem matar uma tarefa no meio.
- **`recuperar` usa `'RIGHT', 'RIGHT'`**: a tarefa presa volta para a ponta direita da fila principal, de onde sai a próxima. Ou seja, ela é a primeira a ser reprocessada.
- **`multi()` na falha**: remover do processamento e reenfileirar acontecem juntos. Se fossem dois comandos soltos, uma queda entre eles poderia duplicar ou perder a tarefa.
- **`lRem` usa o texto exato** (`bruto`) lido da fila. Por isso o objeto modificado (`tentativas++`) é enfileirado como um novo texto.

**10.2 O produtor: `api.js`**

```javascript
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
```

A API não espera o e-mail ser enviado: ela só registra a tarefa e responde. É isso que mantém o tempo de resposta baixo mesmo quando o envio demora ou o servidor de e-mail está fora do ar.

**10.3 O consumidor: `worker.js`**

```javascript
// worker.js — consumidor: retira tarefas e "envia" os e-mails
import { conectar } from './redis.js';
import { FilaRedis } from './fila-redis.js';

const workerId = process.argv[2] ?? 'worker-1'; // nome fixo: permite recuperar após queda
const client = await conectar();
const bloqueante = await client.duplicate().connect(); // conexão só para o blMove
const fila = new FilaRedis(client, 'fila:emails', { maxTentativas: 3 });

// simula o envio: demora 500 ms e falha para endereços @invalido.com
async function enviarEmail({ para, assunto }) {
  await new Promise((r) => setTimeout(r, 500));
  if (para.endsWith('@invalido.com')) throw new Error('domínio inexistente');
  console.log(`[${workerId}] e-mail "${assunto}" enviado para ${para}`);
}

// encerramento gracioso: termina a tarefa atual antes de sair
let rodando = true;
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log(`[${workerId}] encerrando...`);
    rodando = false;
  });
}

const recuperadas = await fila.recuperar(workerId);
if (recuperadas) console.log(`[${workerId}] ${recuperadas} tarefa(s) recuperada(s)`);

console.log(`[${workerId}] aguardando tarefas`);
await fila.consumir(bloqueante, workerId, enviarEmail, () => rodando);

await bloqueante.close();
await client.close();
```

**10.4 Executando**

Abra quatro terminais na pasta do projeto, com o Redis já rodando:

```bash
# Terminal 1
node api.js

# Terminais 2 e 3
node worker.js worker-1
node worker.js worker-2

# Terminal 4: envia 5 e-mails válidos e 1 inválido
for nome in ana bruno caio dani eva; do
  curl -s -X POST localhost:3000/emails -H 'Content-Type: application/json' \
       -d "{\"para\":\"$nome@ifpb.edu.br\",\"assunto\":\"Inscrição confirmada\"}"
done
curl -s -X POST localhost:3000/emails -H 'Content-Type: application/json' \
     -d '{"para":"x@invalido.com","assunto":"Teste"}'
curl -s localhost:3000/status
```

Saída obtida no teste deste tutorial (IDs encurtados):

```text
# Terminal 4
{"id":"4203c11d-...","status":"enfileirado"}      (x6)
{"pendentes":4,"falhas":0}       # logo após enviar
{"pendentes":0,"falhas":1}       # 4 segundos depois

# Terminal 2 (worker-1)
[worker-1] e-mail "Inscrição confirmada" enviado para bruno@ifpb.edu.br
[worker-1] e-mail "Inscrição confirmada" enviado para dani@ifpb.edu.br
[worker-1] tarefa 77e20e83-... falhou (1x) -> fila:emails
[worker-1] tarefa 77e20e83-... falhou (3x) -> fila:emails:falhas

# Terminal 3 (worker-2)
[worker-2] e-mail "Inscrição confirmada" enviado para ana@ifpb.edu.br
[worker-2] e-mail "Inscrição confirmada" enviado para caio@ifpb.edu.br
[worker-2] e-mail "Inscrição confirmada" enviado para eva@ifpb.edu.br
[worker-2] tarefa 77e20e83-... falhou (2x) -> fila:emails
```

Repare que os dois workers dividiram o trabalho sozinhos, e a tarefa inválida passou pelos dois antes de ir para a fila de falhas. Para inspecioná-la: `LRANGE fila:emails:falhas 0 -1` mostra a tarefa com `"tentativas":3` e `"ultimoErro":"domínio inexistente"`.

**10.5 Testando a recuperação após uma queda**

1. Com só o `worker-1` rodando, envie um e-mail e, em menos de meio segundo, mate o processo à força: `kill -9 <pid>` (no Windows, feche o terminal).
2. No `redis-cli`, confira que a tarefa não sumiu: `LRANGE fila:emails:processando:worker-1 0 -1` mostra o JSON dela, e `LLEN fila:emails` mostra `0`.
3. Suba o worker de novo com o **mesmo nome**: `node worker.js worker-1`. A saída no teste foi:

```text
[worker-1] 1 tarefa(s) recuperada(s)
[worker-1] aguardando tarefas
[worker-1] e-mail "Crash test" enviado para ana@ifpb.edu.br
```

Com `RPOP` no lugar de `BLMOVE`, essa tarefa teria se perdido no passo 1.

## 11. BullMQ: filas prontas para produção

O BullMQ é uma biblioteca de filas para Node.js que usa o Redis por baixo e já resolve, com scripts atômicos, tudo o que a seção 10 fez à mão — e mais. Em projetos reais, prefira-o a reinventar a fila; o valor do projeto anterior está em entender o que a biblioteca faz por você.

| O que você fez na mão (seção 10) | Como fica no BullMQ |
| --- | --- |
| `lPush` de um JSON com `id` | `queue.add(nome, dados)` gera o ID e guarda o estado |
| `blMove` + lista de processamento | Trava (*lock*) renovada pelo worker; tarefa parada volta sozinha |
| `tentativas` + reenfileirar | Opção `attempts`, com `backoff` fixo ou exponencial |
| `fila:emails:falhas` | Estado `failed`, consultável com `queue.getFailed()` |
| Agendador com Sorted Set (seção 7) | Opção `delay` e tarefas repetidas (cron) |
| Uma List por prioridade | Opção `priority` |
| Dois processos worker | Opção `concurrency` (e quantos processos quiser) |

**Instalação**

```bash
npm install bullmq ioredis
```

O BullMQ está na versão 6.7, em que o `ioredis` é dependência opcional: sem ele, o BullMQ acusa o erro *could not load the optional 'ioredis' package*. A alternativa é passar um cliente do node-redis já criado em `connection` (por exemplo, `connection: createClient()`), o que também funcionou no teste.

**Produtor**

```javascript
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
```

**Worker**

```javascript
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
```

Saída do teste:

```text
ok   #1 confirmacao -> ana@ifpb.edu.br
erro #2 tentativa 1/3: domínio inexistente
ok   #4 senha -> caio@ifpb.edu.br
erro #2 tentativa 2/3: domínio inexistente
ok   #3 lembrete -> bruno@ifpb.edu.br
erro #2 tentativa 3/3: domínio inexistente
```

Detalhes que costumam confundir:

- **Prioridade**: no BullMQ, tarefas **sem** `priority` saem antes das priorizadas; entre as priorizadas, o número menor vence ([documentação](https://docs.bullmq.io/guide/jobs/prioritized)). Por isso a tarefa `senha` não "furou a fila" da `confirmacao`.
- **`attempts` padrão é 1**: sem configurar, uma tarefa que falha vai direto para `failed`.
- **Memória**: tarefas concluídas ficam guardadas no Redis. Use `removeOnComplete: 1000` (manter só as últimas mil) nas opções do `add` ou em `defaultJobOptions` da `Queue`.

## 12. Projeto 2: fila de extração de texto de PDFs

Um formulário web envia PDFs; a API grava cada arquivo em disco e cria um job no Redis; workers extraem o texto página por página; e um monitor no terminal mostra, ao vivo, a fila, o progresso de cada PDF e os eventos. Extrair texto é um caso clássico de fila: demora, varia com o tamanho do arquivo e não precisa acontecer enquanto o usuário espera a resposta da página.

&#91;embedded content: arquitetura do projeto 2 · 5 componentes\]

A API e os workers nunca conversam diretamente: tudo passa pelo Redis. O monitor apenas lê as chaves e assina o canal de eventos, sem alterar nada.

**O que este projeto acrescenta ao anterior**

- **A fila carrega só o ID.** Os dados de cada job ficam num Hash (`pdf:job:<id>`), e o PDF fica no disco. É a boa prática 5 da seção 13 na prática.
- **Progresso compartilhado.** O worker grava no Hash a página em que está; a página web e o monitor apenas leem.
- **Pub/Sub ao lado da fila.** Os avisos "iniciado", "concluído" e "falhou" chegam ao monitor na hora pelo canal `pdf:eventos`. Se o monitor estiver fechado, os avisos se perdem — mas os jobs não, porque eles estão na List.
- **Índice por data.** Um Sorted Set guarda os IDs com a nota igual ao instante de criação, para o monitor listar os 10 mais recentes.

**As chaves do Redis**

| Chave | Tipo | Conteúdo | Quem escreve | Quem lê |
| --- | --- | --- | --- | --- |
| `pdf:fila` | List | IDs esperando processamento | API (`LPUSH`); worker, ao reenfileirar | Worker (`BLMOVE`) |
| `pdf:processando:<worker>` | List | O ID em andamento naquele worker | Worker (`BLMOVE`) | Worker (`LREM`, recuperação); monitor (`LLEN`) |
| `pdf:job:<id>` | Hash | Nome, caminho, status, página, total de páginas, worker, tentativas, erro, resultado | API e worker (`HSET`) | Página web e monitor (`HGETALL`) |
| `pdf:jobs` | Sorted Set | IDs com nota = instante de criação | API (`ZADD`) | Monitor (`ZRANGE ... REV`) |
| `pdf:contagem` | Hash | Totais de concluídos, erros e retentativas | Worker (`HINCRBY`) | Monitor |
| `pdf:falhas` | List | IDs que falharam 3 vezes | Worker | Monitor (`LLEN`) e você (`LRANGE`) |
| `pdf:eventos` | Canal Pub/Sub | Avisos de mudança de status | API e worker (`PUBLISH`) | Monitor (`SUBSCRIBE`) |

O campo `status` do Hash segue o ciclo `na_fila` → `processando` → `concluido`. Numa falha, volta para `na_fila` (nova tentativa) ou termina em `erro` na terceira vez.

**Estrutura e instalação**

```text
pdf-fila/
├── package.json        ("type": "module")
├── redis.js            conexão (igual à da seção 9)
├── chaves.js           nomes das chaves e função publicar
├── api.js              backend: upload e criação dos jobs
├── public/index.html   frontend: formulário e status
├── worker.js           consumidor: extração do texto
├── monitor.js          painel no terminal
├── amostras/           4 PDFs de teste (um corrompido)
├── uploads/            criada pela API: PDFs recebidos
└── resultados/         criada pelo worker: textos extraídos
```

```bash
npm install redis express multer pdf-parse
```

O projeto usa o **multer** 2.5 para receber arquivos (formulários `multipart/form-data`) e o **pdf-parse** 2.4 para extrair o texto (ele usa o pdf.js da Mozilla por baixo). Use Node.js 22 ou superior. Todo o código desta seção também está no pacote `pdf-fila.zip` que acompanha o tutorial.

```javascript
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
```

O arquivo `redis.js` é o mesmo da seção 9.

**12.1 Backend: `api.js`**

A API faz três coisas: recebe os arquivos, cria um job por PDF e responde na hora com `202`. Ela nunca extrai texto — esse trabalho é dos workers.

```javascript
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
```

Pontos para discutir em aula:

- **`MULTI` na criação.** O Hash, o índice e a entrada na fila são gravados juntos. Sem isso, uma queda entre os comandos poderia deixar um ID na fila sem dados, ou dados sem ID na fila.
- **Ordem importa: Hash antes da fila.** Dentro do `MULTI`, o `HSET` vem antes do `LPUSH`; assim, quando um worker pegar o ID, os dados já existem.
- **Acentos no nome do arquivo.** O multer entrega `originalname` em latin1, e `relatório.pdf` chegaria como `relatÃ³rio.pdf`. A linha com `Buffer.from(..., 'latin1')` corrige isso.
- **Filtro de tipo.** `fileFilter` descarta o que não é PDF; se nada sobrar, a API responde `400`. No teste, enviar um `.txt` devolveu `{"erro":"Envie ao menos um arquivo PDF."}`.
- **Arquivos em disco, não no Redis.** O PDF fica em `uploads/` e o texto em `resultados/`. Isso funciona porque API e workers rodam na mesma máquina; com workers em outros servidores, troque a pasta por um armazenamento compartilhado (um volume de rede ou um serviço de objetos).

**12.2 Frontend: `public/index.html`**

Um formulário com um campo de arquivos e uma tabela que consulta `GET /pdfs/:id` a cada segundo. Quando o job termina, aparece o link para o texto extraído.

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Extração de texto de PDFs</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 16px; color: #222; }
    form { display: flex; gap: 12px; align-items: center; padding: 16px; border: 1px solid #ccc; border-radius: 8px; }
    button { padding: 8px 16px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
    .na_fila { color: #a36b00; } .processando { color: #0b6fa4; }
    .concluido { color: #1a7f37; } .erro { color: #c62828; }
  </style>
</head>
<body>
  <h1>Extração de texto de PDFs</h1>
  <p>Envie até 10 PDFs (20 MB cada). Cada arquivo vira um job na fila do Redis.</p>

  <form id="formulario">
    <input type="file" name="arquivos" accept="application/pdf" multiple required>
    <button type="submit">Enviar para a fila</button>
  </form>
  <p id="mensagem"></p>

  <table>
    <thead><tr><th>Arquivo</th><th>Status</th><th>Páginas</th><th></th></tr></thead>
    <tbody id="jobs"></tbody>
  </table>

  <script>
    const formulario = document.querySelector('#formulario');
    const mensagem = document.querySelector('#mensagem');
    const corpo = document.querySelector('#jobs');
    const meusJobs = []; // IDs enviados nesta página
    const rotulos = { na_fila: 'na fila', processando: 'processando', concluido: 'concluído', erro: 'erro' };

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const resposta = await fetch('/pdfs', { method: 'POST', body: new FormData(formulario) });
      const dados = await resposta.json();
      if (!resposta.ok) {
        mensagem.textContent = dados.erro;
        return;
      }
      mensagem.textContent = `${dados.length} arquivo(s) enviado(s) para a fila.`;
      meusJobs.push(...dados.map((job) => job.id));
      formulario.reset();
    });

    // consulta o status de cada job a cada segundo
    async function atualizar() {
      const jobs = await Promise.all(meusJobs.map((id) => fetch(`/pdfs/${id}`).then((r) => r.json())));
      corpo.replaceChildren(...jobs.map((job) => {
        const linha = document.createElement('tr');
        const celulas = [job.nome, rotulos[job.status], `${job.pagina ?? 0}/${job.paginas ?? '?'}`, ''];
        for (const texto of celulas) {
          const celula = document.createElement('td');
          celula.textContent = texto; // textContent: nome de arquivo nunca vira HTML
          linha.append(celula);
        }
        linha.children[1].className = job.status;
        if (job.status === 'concluido') {
          const link = Object.assign(document.createElement('a'), {
            href: `/pdfs/${job.id}/texto`, target: '_blank', textContent: 'ver texto',
          });
          linha.children[3].append(link);
        }
        return linha;
      }));
    }
    setInterval(atualizar, 1000);
  </script>
</body>
</html>
```

`new FormData(formulario)` monta o corpo `multipart/form-data` com o campo `arquivos`, o mesmo nome esperado por `upload.array('arquivos', 10)` na API. As células da tabela usam `textContent` em vez de `innerHTML`: um arquivo chamado `<script>.pdf` aparece como texto, sem executar nada.

**12.3 Worker: `worker.js`**

O worker usa a mesma fila confiável da seção 6.6 (`BLMOVE` para a lista de processamento, `LREM` ao terminar) e acrescenta o progresso por página e os avisos pelo Pub/Sub.

```javascript
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
```

O que observar:

- **Progresso página a página.** `getInfo()` devolve o total de páginas e `getText({ partial: [n] })` extrai só a página `n`. A cada página, um `HSET ... pagina n` atualiza o Hash, e qualquer cliente que fizer `HGETALL` vê o avanço.
- **`ATRASO_POR_PAGINA_MS`.** PDFs pequenos são extraídos em milissegundos, rápido demais para ver qualquer coisa no monitor. A pausa de 400 ms por página é didática; rode com `ATRASO_POR_PAGINA_MS=0` para medir a velocidade real.
- **`tentativas` mora no Hash do job.** Como a fila carrega só o ID, o contador não pode viajar dentro da mensagem, como na seção 10. `HINCRBY` incrementa e devolve o novo valor numa operação só.
- **Recuperação recomeça do zero.** Se o worker cair na página 3 de 8, o job volta à fila e a extração recomeça da página 1. Para PDFs grandes, salvar cada página extraída permitiria continuar de onde parou (exercício 11).
- **Um PDF corrompido** faz o pdf-parse lançar `Invalid PDF structure.`; depois de 3 tentativas, o ID vai para `pdf:falhas`.

**12.4 Monitor no terminal: `monitor.js`**

O monitor usa as duas formas de saber o que acontece no Redis. O **estado** (quantos na fila, o progresso de cada job) é *puxado* a cada 500 ms com `LLEN`, `HGETALL` e `ZRANGE`. Os **eventos** (iniciou, concluiu, falhou) são *empurrados* pelo Pub/Sub no instante em que acontecem. Não há dependências extras: as cores vêm de `styleText`, do próprio Node.js.

```javascript
// monitor.js — painel da fila no terminal (atualiza a cada 500 ms)
import { styleText } from 'node:util';
import { conectar } from './redis.js';
import { K } from './chaves.js';

const client = await conectar();
const assinante = await client.duplicate().connect(); // conexão dedicada ao Pub/Sub

// 1) Eventos chegam "empurrados" pelo Pub/Sub, no momento em que acontecem
const eventos = [];
await assinante.subscribe(K.eventos, (mensagem) => {
  eventos.unshift(JSON.parse(mensagem));
  eventos.splice(6); // guarda só os 6 mais recentes
});

const rotulos = { na_fila: 'na fila', processando: 'processando', concluido: 'concluído', erro: 'erro' };
const cores = { na_fila: 'yellow', processando: 'cyan', concluido: 'green', erro: 'red' };
const coluna = (texto, largura) => String(texto ?? '').slice(0, largura).padEnd(largura);
const hora = (ms) => new Date(Number(ms)).toLocaleTimeString('pt-BR');

function barra(feito, total, largura = 20) {
  const cheio = total > 0 ? Math.round((feito / total) * largura) : 0;
  return '█'.repeat(cheio) + '░'.repeat(largura - cheio);
}

// soma o tamanho de todas as listas pdf:processando:<worker>
async function contarProcessando() {
  let total = 0;
  for await (const chaves of client.scanIterator({ MATCH: K.processando('*'), COUNT: 100 })) {
    for (const chave of chaves) total += await client.lLen(chave);
  }
  return total;
}

function linhaDoJob(job) {
  const paginas = Number(job.paginas ?? 0);
  const feito = job.status === 'concluido' ? paginas : Number(job.pagina ?? 0);
  const progresso = job.status === 'erro'
    ? coluna(`erro: ${job.erro}`, 28)
    : `${barra(feito, paginas)} ${coluna(paginas ? `${feito}/${paginas}` : '-', 7)}`;
  const status = styleText(cores[job.status] ?? 'white', coluna(rotulos[job.status], 12));
  return ` ${status} ${coluna(job.nome, 24)} ${progresso} ${coluna(job.worker, 9)}`;
}

function linhaDoEvento(e) {
  const nomes = { na_fila: 'na fila', iniciado: 'iniciado', concluido: 'concluído', reenfileirado: 'nova tentativa', erro: 'falhou' };
  const detalhe = {
    iniciado: `(${e.worker})`,
    concluido: `(${e.worker}, ${e.caracteres} caracteres)`,
    reenfileirado: `(${e.worker}, tentativa ${e.tentativas}: ${e.erro})`,
    erro: `(${e.tentativas} tentativas: ${e.erro})`,
  }[e.tipo] ?? '';
  return ` ${styleText('gray', hora(e.em))}  ${coluna(nomes[e.tipo] ?? e.tipo, 15)} ${coluna(e.nome, 24)} ${detalhe}`;
}

// 2) O estado é "puxado" do Redis a cada atualização da tela
async function desenhar() {
  const [naFila, falhas, processando, contagem, ids] = await Promise.all([
    client.lLen(K.fila),
    client.lLen(K.falhas),
    contarProcessando(),
    client.hGetAll(K.contagem),
    client.zRange(K.jobs, 0, 9, { REV: true }), // os 10 jobs mais recentes
  ]);
  const jobs = await Promise.all(ids.map((id) => client.hGetAll(K.job(id))));

  const linhas = [
    styleText('bold', ` Fila de PDFs no Redis — ${hora(Date.now())}`) + styleText('gray', '   (Ctrl+C para sair)'),
    '',
    ` Na fila: ${styleText('yellow', String(naFila))}   ` +
      `Processando: ${styleText('cyan', String(processando))}   ` +
      `Concluídos: ${styleText('green', contagem.concluidos ?? '0')}   ` +
      `Falhas: ${styleText('red', String(falhas))}   ` +
      `Retentativas: ${contagem.retentativas ?? '0'}`,
    '',
    styleText('bold', ` ${coluna('STATUS', 12)} ${coluna('ARQUIVO', 24)} ${coluna('PROGRESSO', 28)} WORKER`),
    ...jobs.map(linhaDoJob),
    '',
    styleText('bold', ' Últimos eventos (Pub/Sub pdf:eventos)'),
    ...eventos.map(linhaDoEvento),
  ];
  // \x1b[H\x1b[2J = volta o cursor ao topo e limpa a tela
  process.stdout.write('\x1b[H\x1b[2J' + linhas.join('\n') + '\n');
}

let ativo = true;
process.on('SIGINT', () => { ativo = false; });

while (ativo) {
  await desenhar();
  await new Promise((r) => setTimeout(r, 500));
}
await assinante.close();
await client.close();
```

Três detalhes do node-redis que aparecem aqui:

- **Pub/Sub precisa de conexão própria.** Uma conexão que chamou `subscribe` só aceita comandos de assinatura; por isso o monitor cria `assinante` com `duplicate()`.
- **`scanIterator` entrega as chaves em lotes.** Cada volta do `for await` traz um **array** de chaves, não uma chave por vez — daí o segundo `for`. Assim o monitor conta os jobs em processamento sem usar `KEYS`.
- **`zRange` com `REV: true`** lê o Sorted Set da maior nota para a menor, ou seja, do job mais novo para o mais antigo.

**12.5 Executando o projeto**

Com o Redis rodando, abra quatro terminais na pasta `pdf-fila`:

```bash
npm install                  # uma vez
npm run api                  # Terminal 1: http://localhost:3000
npm run worker -- worker-1   # Terminal 2
npm run worker -- worker-2   # Terminal 3
npm run monitor              # Terminal 4
```

Abra `http://localhost:3000`, selecione os quatro PDFs da pasta `amostras/` e clique em **Enviar para a fila**. No teste deste tutorial (com `ATRASO_POR_PAGINA_MS=300`), o monitor mostrou, cerca de dois segundos depois do envio:

```text
 Fila de PDFs no Redis — 13:01:02   (Ctrl+C para sair)

 Na fila: 1   Processando: 2   Concluídos: 1   Falhas: 0   Retentativas: 0

 STATUS       ARQUIVO                  PROGRESSO                    WORKER
 na fila      corrompido.pdf           ░░░░░░░░░░░░░░░░░░░░ -
 processando  relatório-final.pdf      ████████████░░░░░░░░ 3/5     worker-2
 concluído    edital-pibic.pdf         ████████████████████ 3/3     worker-2
 processando  apostila-redis.pdf       ███████████████░░░░░ 6/8     worker-1

 Últimos eventos (Pub/Sub pdf:eventos)
 13:01:01  iniciado        relatório-final.pdf      (worker-2)
 13:01:01  concluído       edital-pibic.pdf         (worker-2, 4249 caracteres)
 13:01:00  iniciado        edital-pibic.pdf         (worker-2)
 13:01:00  na fila         corrompido.pdf
 13:01:00  na fila         relatório-final.pdf
 13:01:00  na fila         edital-pibic.pdf
```

E, ao final, com o PDF corrompido já na fila de falhas:

```text
 Fila de PDFs no Redis — 13:01:13   (Ctrl+C para sair)

 Na fila: 0   Processando: 0   Concluídos: 3   Falhas: 1   Retentativas: 2

 STATUS       ARQUIVO                  PROGRESSO                    WORKER
 erro         corrompido.pdf           erro: Invalid PDF structure. worker-1
 concluído    relatório-final.pdf      ████████████████████ 5/5     worker-2
 concluído    edital-pibic.pdf         ████████████████████ 3/3     worker-2
 concluído    apostila-redis.pdf       ████████████████████ 8/8     worker-1

 Últimos eventos (Pub/Sub pdf:eventos)
 13:01:02  falhou          corrompido.pdf           (3 tentativas: Invalid PDF structure.)
 13:01:02  concluído       relatório-final.pdf      (worker-2, 7098 caracteres)
 13:01:02  iniciado        corrompido.pdf           (worker-1)
 13:01:02  nova tentativa  corrompido.pdf           (worker-1, tentativa 2: Invalid PDF structure.)
 13:01:02  iniciado        corrompido.pdf           (worker-1)
 13:01:02  nova tentativa  corrompido.pdf           (worker-1, tentativa 1: Invalid PDF structure.)
```

No navegador, a tabela mostrou os mesmos jobs passando de "processando" para "concluído", com o link **ver texto** abrindo o `.txt` extraído. Repare que os dois workers dividiram os PDFs sozinhos, e que o nome com acento (`relatório-final.pdf`) chegou intacto.

**Teste de queda.** Com um único worker, envie `apostila-redis.pdf` e mate o processo à força no meio da extração (`kill -9`). No teste, o Redis ficou assim:

```text
127.0.0.1:6379> LRANGE pdf:processando:worker-1 0 -1
1) "93b6b5fe-b635-41c6-a21d-f2ffdd274150"
127.0.0.1:6379> HMGET pdf:job:93b6b5fe-b635-41c6-a21d-f2ffdd274150 status pagina paginas
1) "processando"
2) "3"
3) "8"
```

Ao subir `npm run worker -- worker-1` de novo, a saída foi `job 93b6b5fe-... recuperado`, seguida da extração completa das 8 páginas.

## 13. Boas práticas e armadilhas comuns

A maioria dos problemas com filas no Redis vem de três descuidos: o servidor configurado como cache, workers que não toleram reprocessamento e conexões bloqueadas compartilhadas.

1. **Ligue a persistência.** Uma fila que não pode perder tarefas precisa de AOF: `appendonly yes` com `appendfsync everysec` (no máximo cerca de 1 segundo de escritas perdidas numa queda). No Docker: `docker run -d -p 6379:6379 -v redis-dados:/data redis:8 redis-server --appendonly yes`.
2. **Use `maxmemory-policy noeviction`.** Políticas de cache como `allkeys-lru` deixam o Redis **apagar chaves** quando a memória enche — inclusive a sua fila. Com `noeviction`, ele recusa novas escritas e você fica sabendo. Confira com `CONFIG GET maxmemory-policy`.
3. **Escreva workers idempotentes.** Os padrões deste tutorial garantem entrega *pelo menos uma vez*: se o worker enviar o e-mail e cair antes do `lRem`, a tarefa será reprocessada. Proteja o efeito colateral com uma marca de "já feito":

```javascript
// devolve 'OK' na primeira vez e null nas seguintes
const primeiraVez = await client.set(`enviado:${tarefa.id}`, '1', { NX: true, EX: 86400 });
if (!primeiraVez) return; // já processada antes: não envia de novo
```

4. **Uma conexão só para comandos bloqueantes** (`brPop`, `blMove`, `xReadGroup` com `BLOCK`), criada com `client.duplicate()`. Na mesma conexão, todo o resto espera (seção 9).
5. **Mensagens pequenas.** Enfileire referências (`{ "alunoId": 42 }`), não arquivos ou relatórios inteiros. O Redis guarda tudo na RAM.
6. **Monitore duas filas.** O tamanho da fila principal (`LLEN`) mostra se os workers dão conta; o tamanho da fila de falhas mostra se algo quebrou. Fila que só cresce = falta worker ou sobra erro.
7. **Pub/Sub não é fila.** `PUBLISH` entrega só para quem está conectado naquele instante; se o worker estiver fora, a mensagem se perde. Para tarefas, use List, Stream ou BullMQ.
8. **Proteja o servidor.** Nunca exponha a porta 6379 na internet. Configure senha ou usuários ACL (`requirepass`, `ACL SETUSER`) e acesse por rede privada.
9. **Prefixe as chaves** por aplicação (`certificados:fila:emails`) para várias aplicações dividirem o mesmo Redis sem colisão, e use `SCAN` em vez de `KEYS`.

## 14. Exercícios propostos

Os exercícios seguem a ordem do tutorial, do conceito em JavaScript puro até a biblioteca de produção; os de número 1 a 3 cabem numa aula, os demais servem como trabalho.

1. **Fila circular (estrutura de dados).** Implemente em JavaScript uma classe `FilaCircular` com capacidade fixa, usando um array de tamanho N e os índices `inicio` e `fim` com aritmética modular (`(fim + 1) % N`). `enfileirar` deve lançar erro quando a fila estiver cheia. Compare com a classe `Fila` da seção 5: qual usa memória de forma mais previsível?
2. **Fila de atendimento no `redis-cli`.** Enfileire 5 alunos com `LPUSH fila:atendimento`, atenda 2 com `RPOP`, mostre o próximo com `LINDEX` e o tamanho com `LLEN`. Repita usando `RPUSH` + `LPOP`. Depois, troque para `LPUSH` + `LPOP` e explique por que a ordem de atendimento mudou.
3. **Medindo o paralelismo.** Enfileire 100 tarefas no projeto da seção 10 e meça o tempo total com 1, 2 e 4 workers. Monte uma tabela e explique por que o ganho não é infinito.
4. **Agendador atômico com Lua.** Reescreva `moverVencidas` (seção 7.3) para que buscar, remover e enfileirar aconteçam num único script executado com `client.eval(script, { keys: [...], arguments: [String(Date.now())] })`. Ponto de partida:

```lua
local itens = redis.call('ZRANGE', KEYS[1], '-inf', ARGV[1], 'BYSCORE', 'LIMIT', 0, 100)
for _, item in ipairs(itens) do
  -- complete: remova do Sorted Set (KEYS[1]) e coloque na List (KEYS[2])
end
return #itens
```

5. **Retentativa com espera exponencial.** Na classe `FilaRedis`, em vez de reenfileirar na hora após uma falha, agende a nova tentativa para daqui a 2^tentativas segundos (2 s, 4 s, 8 s) usando o Sorted Set da seção 7.3.
6. **Painel da fila de falhas.** Acrescente à `api.js` as rotas `GET /falhas` (lista as tarefas da DLQ) e `POST /falhas/reprocessar` (devolve todas para a fila principal com `lMove`, zerando `tentativas`).
7. **Prioridade x confiabilidade.** Faça a API aceitar `prioridade: "alta" | "normal"` e o worker consumir as duas filas com `brPop` (seção 7.2). Você perdeu a lista de processamento: explique o risco e proponha uma solução.
8. **Dois serviços, um stream.** Crie no mesmo stream os grupos `email` e `auditoria`. Mostre que cada grupo recebe **todas** as mensagens, enquanto os consumidores de um mesmo grupo dividem as mensagens entre si.
9. **Migração para BullMQ.** Reescreva o projeto da seção 10 com BullMQ, mantendo a API Express e o comportamento (3 tentativas, falhas consultáveis). Compare o número de linhas e liste o que o BullMQ passou a fazer por você.

10) **Progresso ao vivo no navegador (projeto 2).** Crie na `api.js` a rota `GET /eventos`, que assina o canal `pdf:eventos` e repassa cada mensagem ao navegador como *Server-Sent Events*. Na página, troque o `setInterval` por um `EventSource('/eventos')`. Compare: quantas requisições por minuto cada abordagem faz com 10 jobs na tela?
11) **Retomar de onde parou (projeto 2).** Faça o worker guardar cada página extraída numa List `pdf:paginas:<id>` (`RPUSH`). Numa retentativa ou recuperação, comece da página `LLEN + 1` em vez da primeira. Teste matando o worker no meio da `apostila-redis.pdf`.
12) **Cancelar um job (projeto 2).** Crie `DELETE /pdfs/:id`: se o job ainda estiver em `pdf:fila`, remova-o com `LREM` e marque o status como `cancelado`. Explique por que cancelar um job que já está em processamento é mais difícil e proponha uma solução usando o Hash do job.

## 15. Referências

Todo o código deste tutorial foi executado com Redis 7.0.15, Node.js 22 e os pacotes `redis` 6.3.1, `express` 5.3.0, `bullmq` 6.7.0 e `ioredis` 6.0.0 — além de multer 2.5.0 e pdf-parse 2.4.5 no projeto 2 —, em novembro de 2026.

- [Redis — Lists](https://redis.io/docs/latest/develop/data-types/lists/): filas com `LPUSH`/`RPOP`, operações bloqueantes e complexidade.
- [Redis — BLPOP](https://redis.io/docs/latest/commands/blpop/): ordem de atendimento entre clientes bloqueados e timeout `0`.
- [Redis — BLMOVE](https://redis.io/docs/latest/commands/blmove/): disponível desde o 6.2, substitui o `BRPOPLPUSH`.
- [Redis — Streams](https://redis.io/docs/latest/develop/data-types/streams/): grupos de consumidores, PEL, `XACK`, `XAUTOCLAIM` e `MAXLEN ~`.
- [Redis — Persistência](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/): RDB, AOF e `appendfsync everysec`.
- [Redis 8 GA](https://redis.io/blog/redis-8-ga/): lançamento em 1º de maio de 2025 e a licença AGPLv3.
- [node-redis no GitHub](https://github.com/redis/node-redis): uso básico, tratamento de erros, `close()` e `createClientPool()`.
- [BullMQ — Prioritized](https://docs.bullmq.io/guide/jobs/prioritized): faixa de prioridades e tarefas sem prioridade.
