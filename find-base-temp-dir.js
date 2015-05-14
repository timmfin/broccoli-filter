var fs = require('fs');

// Pulled from node-temp-dir. Remove this when Broccoli has a central way of
// getting at the temp directory location
var baseDir;

module.exports = function findBaseDir () {
  if (baseDir == null) {
    try {
      if (fs.statSync('tmp').isDirectory()) {
        baseDir = fs.realpathSync('tmp')
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      // We could try other directories, but for now we just create ./tmp if
      // it doesn't exist
      fs.mkdirSync('tmp')
      baseDir = fs.realpathSync('tmp')
    }
  }

  return baseDir
}
