import { Red, NodeProperties, Node } from 'node-red'
import { Response } from 'node-fetch'
import { Node as EnglishNode } from 'unist'
import {
  Classifier as ClassifierClass,
  ClassifierConstructor,
  DocumentConstructor,
  DataSetConstructor,
} from 'dclassify'
import { tokenize, trainingWorker, MESSAGE } from '../workers/classifierWorker'

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

module.exports = function (RED: Red) {
  function ClassifierNode(this: Node, config: NodeProps) {
    RED.nodes.createNode(this, config)
    const node = this

    const sheetId = config.sheetId
    const sheetPage = config.sheetPage
    const sheetUrl = getSheetUrl(sheetId, sheetPage)
    let worker = trainingWorker(sheetUrl, node)

    worker.on('message', (message) => {
      if (message.type === MESSAGE.RESULT) {
        node.send({
          payload: message.value.payload,
          category: message.value.category,
          name: message.value.name,
        })
      }
    })

    // For debug
    node.on('input', function (msg, send, done) {
      const payload = msg.payload
      // if (payload === 'reload') {
      //   promise = trainingWorker(sheetUrl, node)
      //   send({
      //     payload,
      //     category: '',
      //     name: payload,
      //   })
      //   done()
      // }
      worker.postMessage({ type: MESSAGE.PAYLOAD, value: payload })
      done()
    })
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function getSheetUrl(id: string, page: number) {
  return `https://spreadsheets.google.com/feeds/cells/${id}/${page}/public/full?alt=json`
}
