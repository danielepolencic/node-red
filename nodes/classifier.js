const dclassify = require('dclassify')
const fetch = require('node-fetch')

module.exports = function (RED) {
  function ClassifierNode(config) {
    RED.nodes.createNode(this, config)
    const node = this

    const sheetId = config.sheetId
    const sheetPage = config.sheetPage
    const sheetUrl = getSheetUrl(sheetId, sheetPage)

    const Classifier = dclassify.Classifier
    const DataSet = dclassify.DataSet
    const Document = dclassify.Document
    const options = {
      applyInverse: true,
    }
    const classifier = new Classifier(options)

    node.status({ fill: 'yellow', shape: 'ring', text: 'Fetch And Train Data...' })

    const promise = fetch(sheetUrl)
      .then((res) => res.json())
      .then((json) => {
        node.log('Data Fetched')
        return json
      })
      .then((json) => {
        const entries = json.feed.entry

        const texts = entries
          .filter((it) => it.gs$cell.col === '1')
          .reduce((obj, it) => {
            return {
              ...obj,
              [`row-${it.gs$cell.row}`]: it.content.$t,
            }
          }, {})
        const categories = entries
          .filter((it) => it.gs$cell.col === '2')
          .reduce((obj, it) => {
            return {
              ...obj,
              [`row-${it.gs$cell.row}`]: it.content.$t,
            }
          }, {})
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

        return new Promise((resolve) => {
          classifier.train(dataset)
          resolve('Classifier Trained')
        })
      })
      .catch((err) => {
        node.error(`${err.message}.`)
        node.error('Did you publish your goolge sheet?')
        node.status({ fill: 'red', shape: 'ring', text: err.message })
      })

    promise.then((msg) => {
      node.log('Model Trained')
      node.status({ fill: 'green', shape: 'dot', text: msg })
    })

    // For debug
    let queueNum = 1
    node.on('input', function (msg, send, done) {
      const payload = msg.payload
      const newText = new Document(`Text ${queueNum++}`, tokenize(payload))
      promise
        .then(() => {
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

function tokenize(str) {
  return str
    .toLowerCase()
    .replace(/\W/g, ' ')
    .split(' ')
    .filter((it) => it !== '')
}

function getSheetUrl(id, page) {
  return `https://spreadsheets.google.com/feeds/cells/${id}/${page}/public/full?alt=json`
}
