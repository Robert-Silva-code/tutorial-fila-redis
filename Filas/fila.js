export class Fila {
    #itens = {}
    #inicio = 0
    #fim = 0

    enfileirar(item) {
        this.#itens[this.#fim] = item
        this.#fim++
    }

    desenfileirar() {
        if (this.estaVazia()) return undefined
        const item = this.#itens[this.#inicio]
        delete this.#itens[this.#inicio]
        this.#inicio++
        return item
    }

    frente() {
        return this.#itens[this.#inicio]
    }

    tamanho(){
        return this.#fim - this.#inicio
    }

    estaVazia(){
        return this.tamanho() === 0
    }
}