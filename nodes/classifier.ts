import { Red, NodeProperties, Node } from 'node-red'
import { trainingWorker, MESSAGE } from './classifier.worker'
import { Worker } from 'worker_threads'

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

    let currentWorker = initWorker(sheetUrl)

    node.on('input', function (msg, send, done) {
      switch (msg.payload) {
        case 'reload': {
          currentWorker.postMessage({
            type: MESSAGE.SHUTDOWN,
            value: currentWorker.threadId,
          })
          currentWorker = initWorker(sheetUrl)
          done()
          return
        }
        default: {
          currentWorker.postMessage({ type: MESSAGE.PAYLOAD, value: msg.payload })
          break
        }
      }
      done()
    })

    function initWorker(sheetUrl: string): Worker {
      const worker = trainingWorker(sheetUrl)
      worker.on('message', (message) => {
        switch (message.type) {
          case MESSAGE.STATUS:
            node.status(message.value)
            break
          case MESSAGE.ERROR:
            node.error(message.value)
            break
          case MESSAGE.LOG:
            node.log(message.value)
            break
          case MESSAGE.RESULT:
            node.log(`Classified. ${message.value.documentId}, Worker ${currentWorker.threadId}`)
            node.send({
              payload: message.value.payload,
              category: message.value.category,
            })
            break
          default:
            break
        }
      })
      worker.on('error', (err) => node.error(err))
      worker.on('exit', (code: number) => {
        if (code !== 0) node.error(new Error(`Worker stopped with exit code ${code}`))
      })
      return worker
    }
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function getSheetUrl(id: string, page: number) {
  return `https://spreadsheets.google.com/feeds/cells/${id}/${page}/public/full?alt=json`
}
