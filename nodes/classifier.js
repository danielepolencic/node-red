const fetch = require('node-fetch')
const dclassify = require('dclassify')
const Classifier = dclassify.Classifier
const Document = dclassify.Document
const DataSet = dclassify.DataSet

module.exports = function (RED) {
  function ClassifierNode(config) {
    RED.nodes.createNode(this, config)
    const node = this

    const sheetId = config.sheetId
    const sheetPage = config.sheetPage
    const sheetUrl = getSheetUrl(sheetId, sheetPage)

    const promise = trainModel(sheetUrl, node)

    // For debug
    let queueNum = 1
    node.on('input', function (msg, send, done) {
      const payload = msg.payload
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

function trainModel(sheetUrl, node) {
  node.status({ fill: 'yellow', shape: 'ring', text: 'Fetch And Train Data...' })
  return fetch(sheetUrl)
    .then((res) => res.json())
    .then((json) => {
      node.log('Data Fetched')
      return json
    })
    .then((json) => {
      const entries = json.feed.entry
      const startTime = process.hrtime()
      const dataset = createDataset(entries)
      node.log(`Dataset created in ${process.hrtime(startTime)[0]} seconds`)

      const options = {
        applyInverse: true,
      }
      const classifier = new Classifier(options)

      return new Promise((resolve) => {
        const startTime = process.hrtime()
        classifier.train(dataset)
        node.log(`Model trained in ${process.hrtime(startTime)[0]} seconds`)
        node.status({ fill: 'green', shape: 'dot', text: 'Classifier Trained' })
        resolve(classifier)
      })
    })
    .catch((err) => {
      node.error(`${err.message}.`)
      node.error('Did you publish your goolge sheet?')
      node.status({ fill: 'red', shape: 'ring', text: err.message })
    })
}

function createDataset(entries) {
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

  return dataset
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
