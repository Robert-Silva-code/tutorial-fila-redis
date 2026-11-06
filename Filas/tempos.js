import { FilaEncadeada } from "./fila-encadeada.js";
const fila = new FilaEncadeada()

console.time('enfileirar 100 mil')
for (let i = 0; i < 100_000; i++) fila.enfileirar(i)
console.timeEnd('enfileirar 100 mil')

const inicio = process.hrtime.bigint()
while (!fila.estaVazia()) fila.desenfileirar()
const ns = process.hrtime.bigint() - inicio
console.log(`desenfileirar 100 mil: ${ns} ns (${Number(ns) / 1e6} ms)`)