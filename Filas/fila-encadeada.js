class No {
    constructor(valor) {
        this.valor = valor
        this.proximo = null
    }
}

export class FilaEncadeada {
    #inicio = null
    #fim = null
    #tamanho = 0

    enfileirar(item) {
        const novo = new No(item)
        if (this.#fim) {
            this.#fim.proximo = novo
        } else {
            this.#inicio = novo
        }
        this.#fim = novo
        this.#tamanho++
    }

    desenfileirar() {
        if (this.estaVazia()) return undefined
        const {valor} = this.#inicio
        this.#inicio = this.#inicio.proximo
        if (this.#inicio === null) this.#fim = null
        this.#tamanho--
        return valor
    }

    frente() {
        return this.#inicio?.valor
    }

    tamanho() {
        return this.#tamanho
    }

    estaVazia() {
        return this.#tamanho === 0
    }
}