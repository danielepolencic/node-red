module.exports = function (RED) {
  function ClassifierNode(config) {
    RED.nodes.createNode(this, config)
    const name = config.name

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

    // train the classifier
    classifier.train(data)

    console.log('Classifier trained.')
    console.log(JSON.stringify(classifier.probabilities, null, 2))

    const node = this
    node.on('input', function (msg, send, done) {
      node.log(JSON.stringify(msg, null, 2))
      const payload = msg.payload
      const id = msg._msgid
      const newText = new Document(id, tokenize(payload))
      const result = classifier.classify(newText)
      node.log(JSON.stringify(result, null, 2))
      send({
        payload,
        category: result.category,
      })
      done()
    })
  }
  RED.nodes.registerType('classifier', ClassifierNode)
}

function tokenize(str) {
  return str.split(' ')
}
