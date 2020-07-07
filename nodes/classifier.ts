import { Red, NodeProperties, Node } from 'node-red'
import { Response } from 'node-fetch'
import { Node as EnglishNode } from 'unist'
import {
  Classifier as ClassifierClass,
  ClassifierConstructor,
  DocumentConstructor,
  DataSetConstructor,
} from 'dclassify'

const fetch = require('node-fetch')
const dclassify = require('dclassify')
const Classifier: ClassifierConstructor = dclassify.Classifier
const Document: DocumentConstructor = dclassify.Document
const DataSet: DataSetConstructor = dclassify.DataSet
const English = require('parse-english')
const pos = require('retext-pos')()
const keywords = require('retext-keywords')()
const toString = require('nlcst-to-string')

interface NodeProps extends NodeProperties {
  sheetId: string
  sheetPage: number
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
  matches: { node: EnglishNode }[]
}

interface Phrase {
  matches: { nodes: EnglishNode[] }[]
}

module.exports = function (RED: Red) {
  function ClassifierNode(this: Node, config: NodeProps) {
    RED.nodes.createNode(this, config)
    const node = this

    const sheetId = config.sheetId
    const sheetPage = config.sheetPage
    const sheetUrl = getSheetUrl(sheetId, sheetPage)

    let promise = trainModel(sheetUrl, node)

    // For debug
    let queueNum = 1
    node.on('input', function (msg, send, done) {
      const payload = msg.payload
      if (payload === 'reload') {
        promise = trainModel(sheetUrl, node)
        send({
          payload,
          category: '',
          name: payload,
        })
        done()
      }
      const newText = new Document(`Text ${queueNum++}`, tokenize(payload))
      promise
        .then((classifier) => {
          const result = classifier.classify(newText)
          send({
            payload,
            category: result.category,
            name: newText.id,
          })
          done()
        })
        .catch((err) => {
          node.error(err)
          done()
        })
    })
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function trainModel(sheetUrl: string, node: Node): Promise<ClassifierClass> {
  node.status({ fill: 'yellow', shape: 'ring', text: 'Fetch And Train Data...' })
  return fetch(sheetUrl)
    .then((res: Response) => res.json())
    .then((json: any) => {
      node.log('Data Fetched')
      return json
    })
    .then((json: any) => {
      const entries = json.feed.entry
      const startTime = process.hrtime()
      const dataset = createDataset(entries)
      node.log(`Dataset created in ${process.hrtime(startTime)[0]} seconds`)

      const options = {
        applyInverse: true,
      }
      const classifier: ClassifierClass = new Classifier(options)

      return new Promise((resolve) => {
        const startTime = process.hrtime()
        classifier.train(dataset)
        node.log(`Model trained in ${process.hrtime(startTime)[0]} seconds`)
        node.status({ fill: 'green', shape: 'dot', text: 'Classifier Trained' })
        resolve(classifier)
      })
    })
    .catch((err: Error) => {
      node.error(`${err.message}.`)
      node.error('Did you publish your goolge sheet?')
      node.status({ fill: 'red', shape: 'ring', text: err.message })
    })
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

function tokenize(str: string): string[] {
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

function getSheetUrl(id: string, page: number) {
  return `https://spreadsheets.google.com/feeds/cells/${id}/${page}/public/full?alt=json`
}
