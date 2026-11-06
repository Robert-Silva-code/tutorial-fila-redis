export class FilaArray {
    #itens = [];

    enfileirar(item) {
        this.#itens.push(item)
    }

    desenfileirar() {
        return this.#itens.shift()
    }

    frente() {
        return this.#itens[0]
    }

    tamanho(){
        return this.#itens.length
    }

    estaVazia(){
        return this.#itens.length === 0
    }
}