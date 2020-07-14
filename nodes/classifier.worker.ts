import { Worker, isMainThread, parentPort, workerData, WorkerOptions, MessagePort } from 'worker_threads'
import fetch, { Response } from 'node-fetch'
import { Node } from 'unist'
import { resolve } from 'path'
import { Document, Classifier, DataSet, Result } from 'dclassify'

const English = require('parse-english')
const pos = require('retext-pos')()
const keywords = require('retext-keywords')()
const toString = require('nlcst-to-string')

export const MESSAGE = {
  STATUS: 'STATUS',
  ERROR: 'ERROR',
  LOG: 'LOG',
  RESULT: 'RESULT',
  PAYLOAD: 'PAYLOAD',
  SHUTDOWN: 'SHUTDOWN',
} as const

if (!isMainThread) {
  initWorker()
}
let a = 1
async function initWorker() {
  if (!parentPort) {
    return
  }
  const port = parentPort
  let classifier: Classifier
  let isInitClassifier = false
  let queue: Document[] = []
  port.on('message', async (message) => {
    switch (message.type) {
      case MESSAGE.PAYLOAD:
        const document = new Document(
          `Text ${a++}`,
          tokenize({ str: message.value.text, extraKeywords: parseKeywords(message.value.keywords || '') }),
        )
        if (!classifier) {
          if (!isInitClassifier) {
            isInitClassifier = true
            queue.push(document)
            classifier = await trainModel(workerData.sheetUrl, port)
            queue.forEach((document) => {
              console.log(document.id)
              const result = classifier.classify(document)
              port.postMessage({
                type: MESSAGE.RESULT,
                value: {
                  payload: message.value,
                  category: result.category,
                  documentId: `${document.id}`,
                },
              })
            })
            break
          }
          queue.push(document)
          break
        }
        const result = classifier.classify(document)
        port.postMessage({
          type: MESSAGE.RESULT,
          value: {
            payload: message.value,
            category: result.category,
            documentId: `${document.id}`,
          },
        })
        break
      case MESSAGE.SHUTDOWN:
        port.postMessage({
          type: MESSAGE.LOG,
          value: `Worker ${message.value} is shutting down...`,
        })
        process.exit(0)
      default:
        break
    }
  })
}

export function trainingWorker(sheetUrl: string): Worker {
  const worker = workerTs(__filename, {
    workerData: { sheetUrl },
  })
  return worker
}

function workerTs(file: string, options: WorkerOptions) {
  if (!options.workerData) {
    options.workerData = {}
  }
  options.workerData.__filename = file
  return new Worker(resolve(__dirname, 'classifier.worker.js'), options)
}

async function trainModel(sheetUrl: string, port: MessagePort) {
  port.postMessage({ type: MESSAGE.STATUS, value: { fill: 'yellow', shape: 'ring', text: 'Fetch And Train Data...' } })
  let json: { feed: { entry: SheetCell[] } }
  try {
    const response: Response = await fetch(sheetUrl)
    json = await response.json()
  } catch (err) {
    port.postMessage({ type: MESSAGE.ERROR, value: `${err.message}.` })
    port.postMessage({ type: MESSAGE.ERROR, value: 'Did you publish your google sheet?' })
    port.postMessage({ type: MESSAGE.STATUS, value: { fill: 'red', shape: 'ring', text: err.message } })
    process.exit(0)
  }

  port.postMessage({ type: MESSAGE.LOG, value: 'Data Fetched' })
  const entries = json.feed.entry
  const datasetProcessingTime = process.hrtime()
  const dataset = createDataset(entries)
  port.postMessage({
    type: MESSAGE.LOG,
    value: `Dataset created in ${process.hrtime(datasetProcessingTime)[0]} seconds`,
  })
  const classifier = new Classifier({ applyInverse: true })

  const trainingTime = process.hrtime()
  classifier.train(dataset)
  port.postMessage({
    type: MESSAGE.LOG,
    value: `Model trained in ${process.hrtime(trainingTime)[0]} seconds`,
  })
  port.postMessage({ type: MESSAGE.STATUS, value: { fill: 'green', shape: 'dot', text: 'Classifier Trained' } })
  return classifier
}

function createDataset(entries: SheetCell[]) {
  const texts = extractCol(entries, '1')
  const keywords = extractCol(entries, '2')
  const categories = extractCol(entries, '3')

  const rows = Object.keys(texts).map((row) => {
    return {
      row,
      text: texts[row],
      keyword: keywords[row] || '',
      category: categories[row] || '',
    }
  })

  const data = rows.map((it) => {
    return {
      category: it.category,
      doc: new Document(it.row, tokenize({ str: it.text, extraKeywords: parseKeywords(it.keyword) })),
    }
  })

  const categoriesSet = rows.map((it) => it.category).filter((it, i, arr) => arr.indexOf(it) === i)

  const dataset = new DataSet()
  categoriesSet.forEach((category) => {
    dataset.add(
      category,
      data.filter((it) => it.category === category).map((it) => it.doc),
    )
  })

  return dataset
}

export function tokenize({ str, extraKeywords = [] }: { str: string; extraKeywords?: string[] }): string[] {
  const tree = new English().parse(str)
  const file = { data: { keywords: [] as Keyword[], keyphrases: [] as Phrase[] } }
  pos(tree)
  keywords(tree, file)
  const allKeywords: string[] = file.data.keywords.map((keyword) => {
    return toString(keyword.matches[0].node)
  })

  const allKeywordPhrases: string[] = file.data.keyphrases.map((phrase) => {
    return phrase.matches[0].nodes.map(toString).join('')
  })
  return [...allKeywords, ...allKeywordPhrases, ...extraKeywords].filter((str, i, arr) => arr.indexOf(str) === i)
}

function extractCol(entries: SheetCell[], col: string) {
  return entries
    .filter((it) => it.gs$cell.col === col)
    .reduce((obj, it) => {
      return {
        ...obj,
        [`row-${it.gs$cell.row}`]: it.content.$t || '',
      }
    }, {} as Record<string, string>)
}

function parseKeywords(keywords: string) {
  return keywords
    .split(',')
    .map((it) => it.trim())
    .filter((it) => it !== '')
}

interface SheetCell {
  gs$cell: {
    row: string
    col: string
  }
  content: {
    $t: string
  }
}

interface Keyword {
  matches: { node: Node }[]
}

interface Phrase {
  matches: { nodes: Node[] }[]
}
