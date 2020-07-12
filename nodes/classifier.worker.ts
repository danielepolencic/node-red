import { Worker, isMainThread, parentPort, workerData, WorkerOptions, MessagePort } from 'worker_threads'
import fetch, { Response } from 'node-fetch'
import { Node } from 'unist'
import { resolve } from 'path'
import { Document, Classifier, DataSet } from 'dclassify'

const English = require('parse-english')
const pos = require('retext-pos')()
const keywords = require('retext-keywords')()
const toString = require('nlcst-to-string')

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

export const MESSAGE = {
  STATUS: 'STATUS',
  ERROR: 'ERROR',
  LOG: 'LOG',
  TRAINED: 'TRAINED',
  RESULT: 'RESULT',
  PAYLOAD: 'PAYLOAD',
  SHUTDOWN: 'SHUTDOWN',
}

// For debug
let queueNum = 1

if (!isMainThread) {
  initWorker()
}

async function initWorker() {
  if (parentPort) {
    const port = parentPort
    const classifier = await trainModel(workerData.sheetUrl, port)
    port.on('message', (message) => {
      switch (message.type) {
        case MESSAGE.PAYLOAD:
          const newText = new Document(`Text ${queueNum++}`, tokenize(message.value))
          const result = classifier.classify(newText)
          port.postMessage({
            type: MESSAGE.RESULT,
            value: {
              payload: message.value,
              category: result.category,
              name: `${newText.id}`,
            },
          })
          break
        case MESSAGE.SHUTDOWN:
          port.postMessage({
            type: MESSAGE.LOG,
            value: `Worker ${message.value} is shuting down...`,
          })
          process.exit(0)
        default:
          break
      }
    })
  }
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
  let json
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
  let startTime = process.hrtime()
  const dataset = createDataset(entries)
  port.postMessage({ type: MESSAGE.LOG, value: `Dataset created in ${process.hrtime(startTime)[0]} seconds` })
  const options = { applyInverse: true }
  const classifier = new Classifier(options)

  startTime = process.hrtime()
  classifier.train(dataset)
  port.postMessage({
    type: MESSAGE.LOG,
    value: `Model trained in ${process.hrtime(startTime)[0]} seconds`,
  })
  port.postMessage({ type: MESSAGE.STATUS, value: { fill: 'green', shape: 'dot', text: 'Classifier Trained' } })
  port.postMessage({ type: MESSAGE.TRAINED, value: '' })
  return classifier
}

function createDataset(entries: SheetCell[]) {
  const texts = entries
    .filter((it) => it.gs$cell.col === '1')
    .reduce((obj, it) => {
      return {
        ...obj,
        [`row-${it.gs$cell.row}`]: it.content.$t,
      }
    }, {} as Record<string, string>)

  const categories = entries
    .filter((it) => it.gs$cell.col === '2')
    .reduce((obj, it) => {
      return {
        ...obj,
        [`row-${it.gs$cell.row}`]: it.content.$t,
      }
    }, {} as Record<string, string>)

  const rows = Object.keys(texts).map((row) => {
    return {
      row,
      text: texts[row],
      category: categories[row] || '',
    }
  })

  const data = rows.map((it) => {
    return {
      category: it.category,
      doc: new Document(it.row, tokenize(it.text)),
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

export function tokenize(str: string): string[] {
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
  return [...allKeywords, ...allKeywordPhrases]
}
