//import { Fila } from "./fila.js";
import { FilaEncadeada as Fila } from "./fila-encadeada.js"

const atendimento = new Fila()
atendimento.enfileirar('Samuel')
atendimento.enfileirar('Davi')
atendimento.enfileirar('Santos')

console.log(atendimento.frente())
console.log(atendimento.desenfileirar())
console.log(atendimento.desenfileirar())
console.log(atendimento.tamanho())