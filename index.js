var fs = require('fs')
var path = require('path')
var rimraf = require('rimraf').sync
var mkdirp = require('mkdirp')
var Promise = require('rsvp').Promise
var quickTemp = require('quick-temp')
var helpers = require('broccoli-kitchen-sink-helpers')
var walkSync = require('walk-sync')
var mapSeries = require('promise-map-series')
var symlinkOrCopySync = require('symlink-or-copy').sync
var copyDereferenceSync = require('copy-dereference').sync
var findBaseTempDir = require('./find-base-temp-dir.js')

var globalBroccoliFilterCounter = 0;

module.exports = Filter
function Filter (inputTree, options) {
  if (!inputTree) {
    throw new Error('broccoli-filter must be passed an inputTree, instead it received `undefined`');
  }
  this.inputTree = inputTree
  options = options || {}
  if (options.extensions != null) this.extensions = options.extensions
  if (options.targetExtension != null) this.targetExtension = options.targetExtension
  if (options.inputEncoding !== undefined) this.inputEncoding = options.inputEncoding
  if (options.outputEncoding !== undefined) this.outputEncoding = options.outputEncoding
  if (options.cacheByContent !== undefined) this.cacheByContent = options.cacheByContent

  if (options.cacheByContent === true) {
    this.cacheByContent = true
  }

  // First-level mtime cache checked first before content digest. This prevents
  // unnecessary file reads when a file hasn't changed.
  this._fileDigestCache = {}

  if (!options.persistedCacheId) {
    throw new Error('Subclasses of broccoli-persisted-filter must be passed a persistedCacheId to be able to uniquely identify themselves');
  }

  this.instanceNum = globalBroccoliFilterCounter++

  var persistedCacheDirname = 'persisted-' + options.persistedCacheId + '-cache'
  this.persistedCachePath = findBaseTempDir() + '/' + persistedCacheDirname
  this.persistedCacheManifest = this.persistedCachePath + '/persisted-cache.json';

  try {
    if (fs.statSync(this.persistedCacheManifest).isFile()) {
      this._persistedCache = JSON.parse(fs.readFileSync(this.persistedCacheManifest));
    }
  } catch (e) {
    if (e.code != 'ENOENT') {
      throw e;
    }
  }
}

Filter.prototype.rebuild = function () {
  var self = this

  var paths = walkSync(this.inputPath)
    return mapSeries(paths, function (relativePath) {
      if (relativePath.slice(-1) === '/') {
        mkdirp.sync(self.outputPath + '/' + relativePath)
        mkdirp.sync(self.cachePath + '/' + relativePath)
      } else {
        if (self.canProcessFile(relativePath)) {
          return self.processAndCacheFile(self.inputPath, self.outputPath, relativePath)
        } else {
          symlinkOrCopySync(
            self.inputPath + '/' + relativePath, self.outputPath + '/' + relativePath)
        }
      }
    })
}

// Compatibility with Broccoli < 0.14
// See https://github.com/broccolijs/broccoli/blob/master/docs/new-rebuild-api.md
Filter.prototype.read = function (readTree) {
  var self = this

  quickTemp.makeOrRemake(this, 'outputPath')
  quickTemp.makeOrReuse(this, 'cachePath')
  this.needsCleanup = true

  return readTree(this.inputTree)
    .then(function (inputPath) {
      self.inputPath = inputPath
      return self.rebuild()
    })
    .then(function () {
      return self.outputPath
    })
}

Filter.prototype.cleanup = function () {
  if (this.cachePath) {
    this.persistCacheDir();
  }

  if (this.needsCleanup) {
    quickTemp.remove(this, 'outputPath')
    quickTemp.remove(this, 'cachePath')
  } else {
    console.log('Not cleaning up (new)', this.cachePath)
  }
}


Filter.prototype.persistCacheDir = function() {
  if (this._cache && Object.keys(this._cache).length > 0) {
    mkdirp.sync(this.persistedCachePath)
    this._persistedCache = this._persistedCache || {};

    console.log("Merging: ", this._cache, "\nwith:", this._persistedCache);

    // Merge files from memory cache to persisted cache
    for (var relativePath in this._cache) {
      if (this._cache.hasOwnProperty(relativePath)) {
        var cacheEntry =  this._cache[relativePath],
            persistedCacheEntry = this._persistedCache[relativePath],
            outputFiles = cacheEntry.outputFiles;

        // Only copy files to the persisted folder if they are different
        if (!persistedCacheEntry || cacheEntry.hash != persistedCacheEntry.hash) {

          for (var i = 0; i < outputFiles.length; i++) {
            if (persistedCacheEntry) {
              rimraf(this.persistedCachePath + '/' + outputFiles[i]);
            }

            mkdirp.sync(path.dirname(this.persistedCachePath + '/' + outputFiles[i]))
            copyDereferenceSync(this.cachePath + '/' + outputFiles[i], this.persistedCachePath + '/' + outputFiles[i]);
          }

          this._persistedCache[relativePath] = this._cache[relativePath];
        }
      }
    }
    fs.writeFileSync(this.persistedCacheManifest, JSON.stringify(this._persistedCache, null, 2));
  }
}

Filter.prototype.canProcessFile = function (relativePath) {
  return this.getDestFilePath(relativePath) != null
}

Filter.prototype.getDestFilePath = function (relativePath) {
  for (var i = 0; i < this.extensions.length; i++) {
    var ext = this.extensions[i]
    if (relativePath.slice(-ext.length - 1) === '.' + ext) {
      if (this.targetExtension != null) {
        relativePath = relativePath.slice(0, -ext.length) + this.targetExtension
      }
      return relativePath
    }
  }
  return null
}

// To do: Get rid of the srcDir/destDir args because we now have inputPath/outputPath
// https://github.com/search?q=processAndCacheFile&type=Code&utf8=%E2%9C%93

Filter.prototype.processAndCacheFile = function (srcDir, destDir, relativePath) {
  var self = this

  this._cache = this._cache || {}
  var cacheEntry = this._cache[relativePath]
  var persistedCacheEntry = this._persistedCache && this._persistedCache[relativePath]

  if (cacheEntry != null && cacheEntry.hash === self.hashEntry(srcDir, destDir, cacheEntry)) {
    symlinkOrCopyFromCache(cacheEntry, self.cachePath)
  } else if (persistedCacheEntry != null && persistedCacheEntry.hash === self.hashEntry(srcDir, destDir, persistedCacheEntry)) {
    symlinkOrCopyFromCache(persistedCacheEntry, self.persistedCachePath)
  } else {
    return Promise.resolve()
      .then(function () {
        return self.processFile(srcDir, self.cachePath, relativePath)
      })
      .catch(function (err) {
        // Augment for helpful error reporting
        err.broccoliInfo = err.broccoliInfo || {}
        err.broccoliInfo.file = path.join(srcDir, relativePath)
        // Compatibility
        if (err.line != null) err.broccoliInfo.firstLine = err.line
        if (err.column != null) err.broccoliInfo.firstColumn = err.column
        throw err
      })
      .then(function (cacheInfo) {
        symlinkOrCopyToOutput(cacheInfo, destDir)
      })
  }

  function symlinkOrCopyFromCache (cacheEntry, cachePath) {
    for (var i = 0; i < cacheEntry.outputFiles.length; i++) {
      var cachedRelativePath = cacheEntry.outputFiles[i]
      var dest = destDir + '/' + cachedRelativePath

      mkdirp.sync(path.dirname(dest))
      // We may be able to link as an optimization here, because we control
      // the cache directory; we need to be 100% sure though that we don't try
      // to hardlink symlinks, as that can lead to directory hardlinks on OS X
      symlinkOrCopySync(
        cachePath + '/' + cachedRelativePath, dest)
    }
  }

  function symlinkOrCopyToOutput (cacheInfo) {
    var cacheEntry = {
      inputFiles: (cacheInfo || {}).inputFiles || [relativePath],
      outputFiles: (cacheInfo || {}).outputFiles || [self.getDestFilePath(relativePath)]
    }

    for (var i = 0; i < cacheEntry.outputFiles.length; i++) {
      symlinkOrCopySync(
        self.cachePath + '/' + cacheEntry.outputFiles[i],
        self.outputPath + '/' + cacheEntry.outputFiles[i])
    }
    cacheEntry.hash = self.hashEntry(srcDir, destDir, cacheEntry)
    self._cache[relativePath] = cacheEntry
  }
}

Filter.prototype.hashEntry = function(srcDir, destDir, cacheEntry) {
  var hashOptions;

  if (this.cacheByContent) {
    hashOptions = {
      digestCache: this._fileDigestCache,
      hashContent: true
    }
  }

  return cacheEntry.inputFiles.map(function (filePath) {
    return helpers.hashTree(srcDir + '/' + filePath, hashOptions)
  }).join(',')
}

Filter.prototype.processFile = function (srcDir, destDir, relativePath) {
  var self = this
  var inputEncoding = (this.inputEncoding === undefined) ? 'utf8' : this.inputEncoding
  var outputEncoding = (this.outputEncoding === undefined) ? 'utf8' : this.outputEncoding
  var string = fs.readFileSync(srcDir + '/' + relativePath, { encoding: inputEncoding })
  return Promise.resolve(self.processString(string, relativePath))
    .then(function (outputString) {
      var outputPath = self.getDestFilePath(relativePath)
      fs.writeFileSync(destDir + '/' + outputPath, outputString, { encoding: outputEncoding })
    })
}
