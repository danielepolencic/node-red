module.exports = function (RED) {
  function ExampleNode(config) {
    RED.nodes.createNode(this, config)
    const name = config.name
    const node = this
    node.on('input', function (msg, send, done) {
      node.log(JSON.stringify(msg, null, 2))
      send({
        payload: `Hello ${name || 'world'}`,
      })
      done()
    })
  }
  RED.nodes.registerType('example', ExampleNode)
}
