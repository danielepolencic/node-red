declare module 'dclassify' {
  class Classifier {
    train(dataset: DataSet): void
    classify(document: Document): Result
    applyInverse: boolean
    probabilityThreshold: number
    defaultCategory: string
    probabilities: any
  }

  class Document {
    constructor()
    id: string
    token: string[]
    add(token: string): void
  }

  class DataSet {
    add(label: string, items: Document[]): void
  }

  interface ClassifierConstructor {
    new (options?: Options): Classifier
  }

  interface DocumentConstructor {
    new (id: string, token: string[]): Document
  }

  interface DataSetConstructor {
    new (): DataSet
  }

  interface Options {
    applyInverse?: boolean
    probabilityThreshold?: number
    defaultCategory?: string
  }

  interface Result {
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
