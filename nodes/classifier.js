module.exports = function (RED) {
  function ClassifierNode(config) {
    RED.nodes.createNode(this, config)
    const node = this

    const dclassify = require('dclassify')
    const Classifier = dclassify.Classifier
    const DataSet = dclassify.DataSet
    const Document = dclassify.Document

    const text1 = new Document('text1', tokenize('amazing, awesome movie!! Yeah!! Oh boy'))
    const text2 = new Document('text2', tokenize('Sweet, this is incredible, amazing, perfect, great!!'))
    const text3 = new Document('text3', tokenize('terrible, shitty thing. Damn. Sucks!!'))

    const data = new DataSet()
    data.add('positive', [text1, text2])
    data.add('negative', [text3])

    const options = {
      applyInverse: true,
    }

    const classifier = new Classifier(options)

    node.log('Classifier is training....')

    const fakePromise = new Promise((resolve) =>
      setTimeout(() => {
        classifier.train(data)
        node.log('Classifier trained after 10 seconds.')
        resolve()
      }, 10000),
    )

    // For debug
    let queueNum = 1
    node.on('input', function (msg, send, done) {
      const payload = msg.payload
      const id = msg._msgid
      const newText = new Document(`Text ${queueNum++}`, tokenize(payload))

      fakePromise.then(() => {
        const result = classifier.classify(newText)
        send({
          payload,
          category: result.category,
          name: newText.id,
        })
        done()
      })
    })
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function tokenize(str) {
  return str.split(' ')
}
