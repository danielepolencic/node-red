declare module '~dclassify/index' {
  export class Classifier {
    constructor(options?: Options)
    train(dataset: DataSet): void
    classify(document: Document): Result
    applyInverse: boolean
    probabilityThreshold: number
    defaultCategory: string
    probabilities: any
  }

  export class Document {
    constructor(value: string, keywords: string[])
    id: string
    token: string[]
    add(token: string): void
  }

  export class DataSet {
    add(label: string, items: Document[]): void
  }

  export interface Options {
    applyInverse?: boolean
    probabilityThreshold?: number
    defaultCategory?: string
  }

  export interface Result {
    category: string
    probability: number
    timesMoreLikely: number
    secondCategory: string
    probabilities: {
      category: string
      probability: any
    }[]
  }
}

declare module 'dclassify' {
  import alias = require('~dclassify/index')
  export = alias
}
