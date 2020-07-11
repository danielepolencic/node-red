import { Red, NodeProperties, Node } from 'node-red'
import { trainingWorker, MESSAGE } from '../workers/classifierWorker'
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
    let newWorker: Worker
    let currentWorker: Worker

    currentWorker = trainingWorker(sheetUrl)
    initWorkerListener(currentWorker, true)
    function initWorkerListener(worker: Worker, isFirstWorker = false) {
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
            node.send({
              payload: message.value.payload,
              category: message.value.category,
              // For debug
              name: `${message.value.name}, Worker ${currentWorker.threadId}`,
            })
            break
          case MESSAGE.TRAINED:
            if (!isFirstWorker) {
              currentWorker.postMessage({
                type: MESSAGE.SHUTDOWN,
                value: currentWorker.threadId,
              })
            }
            currentWorker = worker
            break
          default:
            break
        }
      })
      worker.on('error', (err) => node.error(err))
      worker.on('exit', (code: number) => {
        if (code !== 0) node.error(new Error(`Worker stopped with exit code ${code}`))
      })
    }

    node.on('input', function (msg, send, done) {
      const payload = msg.payload
      if (payload === 'reload') {
        newWorker = trainingWorker(sheetUrl)
        initWorkerListener(newWorker)
        done()
        return
      }
      currentWorker.postMessage({ type: MESSAGE.PAYLOAD, value: payload })
      done()
    })
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function getSheetUrl(id: string, page: number) {
  return `https://spreadsheets.google.com/feeds/cells/${id}/${page}/public/full?alt=json`
}
