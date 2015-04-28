'use strict';

var fs = require('fs');
var path = require('path');
var expect = require('expect.js');
var RSVP = require('rsvp');
var root = process.cwd();
var broccoli = require('broccoli');

var Filter = require('..');


var builder;

describe('broccoli-filter', function(){
  var sourcePath = 'tests/fixtures/sample-project';
  var existingJSRelativePath = 'sub-folder/core.js'
  var existingJSFile = sourcePath + '/' + existingJSRelativePath;
  var existingJSContent = '"YIPPIE"\n';
  var dummyChangedFile = sourcePath + '/dummy-changed-file.txt';
  var dummyJSChangedFile = sourcePath + '/dummy-changed-file.js';

  beforeEach(function() {
    // Rest the mtime to some specific time in the past, so that other tests
    // don't muck with the mtime
    fs.utimesSync(existingJSFile, new Date(), new Date(1399424542459));
  });

  afterEach(function() {
    if (builder) {
      builder.cleanup();
    }

    if (fs.existsSync(dummyChangedFile)) {
      fs.unlinkSync(dummyChangedFile);
    }

    if (fs.existsSync(dummyJSChangedFile)) {
      fs.unlinkSync(dummyJSChangedFile);
    }

    fs.writeFileSync(existingJSFile, existingJSContent);
  });

  function runAnonFilter(sourcePath, options, overriddenMethods) {
    function TestFilter(inputTree, options) {
      if(!(this instanceof TestFilter)) {
        return new TestFilter(inputTree, options);
      }

      Filter.call(this, inputTree, options);
    }

    TestFilter.prototype = Object.create(Filter.prototype);
    TestFilter.prototype.constructor = TestFilter;

    for (var key in overriddenMethods) {
      if (overriddenMethods.hasOwnProperty(key)) {
        TestFilter.prototype[key] = overriddenMethods[key];
      }
    }

    return new TestFilter(sourcePath, options);
  }

  describe('processString', function() {
    it('is called when there is no cache', function(){
      var processStringCalled = false;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCalled = true;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);
      return builder.build().finally(function() {
        expect(processStringCalled).to.be.ok();

        builder.build().finally(function() {
          expect(processStringCalled).to.be.ok();
        });
      });
    });

    it('is provided a source and destination directory', function(){
      var processStringCalled = false;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          expect(content).to.be.equal(existingJSContent);
          expect(relativePath).to.equal(existingJSRelativePath);
          return content;
        }
      })

      builder = new broccoli.Builder(tree);
      return builder.build()
    });

    it('is only called once if input is not changing', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);
      expect(processStringCount).to.eql(0);
      return builder.build().then(function () {
          builder.build();
          expect(processStringCount).to.eql(1);
        }).then(function() {
          expect(processStringCount).to.eql(1);
        });
    });

    it('is called again if input is changed', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(dummyJSChangedFile, 'bergh');

          return builder.build()
        })
        .finally(function() {
          expect(processStringCount).to.eql(2);
        });
    });

    it('is called again if existing file is changed', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(existingJSFile, '"YIPPIE"\n"KI-YAY"\n');
          return builder.build();
        })
        .finally(function() {
          expect(processStringCount).to.eql(2);
        });
    });

    it('is called if an existing file is modified but the content stays the same', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(existingJSFile, fs.readFileSync(existingJSFile));

          return builder.build()
        })
        .finally(function() {
          expect(processStringCount).to.eql(2);
        });
    });

    it('is not called if an existing file is modified but the content stays the same when cacheByContent is enabled', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js'],
        cacheByContent: true
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(existingJSFile, fs.readFileSync(existingJSFile));

          return builder.build()
        })
        .finally(function() {
          expect(processStringCount).to.eql(1);
        });
    });

    it('is not called if input is changed but filtered (via getDestFilePath)', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        },
        getDestFilePath: function(relativePath) {
          if (relativePath === existingJSRelativePath) {
            return relativePath;
          } else {
            return;
          }
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(dummyChangedFile, 'bergh');

          return builder.build();
        })
        .finally(function() {
          expect(processStringCount).to.eql(1);
        });
    });

    it('does not call updateCache again if input is changed but filtered (via extensions)', function(){
      var processStringCount = 0;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCount++;
          return content;
        }
      })

      builder = new broccoli.Builder(tree);

      return builder.build()
        .finally(function() {
          expect(processStringCount).to.eql(1);
        })
        .then(function() {
          fs.writeFileSync(dummyChangedFile, 'bergh');

          return builder.build();
        })
        .finally(function() {
          expect(processStringCount).to.eql(1);
        });
    });
  });

  describe('hashing', function() {
    it('can override the hash function', function(){
      var hashEntryCalled = false;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js'],
        targetExtension: 'bestjs'
      }, {
        processString: function(content, relativePath) {
          return content;
        },

        hashEntry: function(srcDir, destDir, cacheEntry) {
          hashEntryCalled = true;

          expect(srcDir).to.be.equal(sourcePath);
          expect(destDir).to.be.ok();
          expect(cacheEntry.inputFiles).to.eql([ 'sub-folder/core.js' ]);
          expect(cacheEntry.outputFiles).to.eql([ 'sub-folder/core.bestjs' ]);

          return Filter.prototype.hashEntry.call(this, srcDir, destDir, cacheEntry);
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().finally(function() {
        expect(hashEntryCalled).to.be.ok();
      });
    });

    it('custom hash function can force re-process', function(){
      var processStringCtr = 0;
      var buildCtr = 1;
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          processStringCtr++;
          return content;
        },

        hashEntry: function(srcDir, destDir, cacheEntry) {
          // Only change the hash every other build
          var hash = 'some-hash-';

          if ((buildCtr % 2) === 1) {
            hash += buildCtr;
          } else {
            hash += buildCtr - 1;
          }

          return hash;
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().finally(function() {
        expect(processStringCtr).to.be.eql(1);

        buildCtr++;
        return builder.build().finally(function() {
          expect(processStringCtr).to.be.eql(1);

          buildCtr++;
          return builder.build().finally(function() {
            expect(processStringCtr).to.be.eql(2);

            buildCtr++;
            return builder.build().finally(function() {
              expect(processStringCtr).to.be.eql(2);

              buildCtr++;
              return builder.build().finally(function() {
                expect(processStringCtr).to.be.eql(3);
              });
            });
          });
        });
      });
    });
  });

  describe('other', function() {
    it('can write files to destDir, and they will be in the final output', function(){
      var tree = runAnonFilter(sourcePath, {
        extensions: ['js']
      }, {
        processString: function(content, relativePath) {
          return 'zomg blammo';
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function(dir) {
        expect(fs.readFileSync(dir.directory + '/' + existingJSRelativePath, {encoding: 'utf8'})).to.eql('zomg blammo');
      });
    });

    it('can return a promise that is resolved', function(){
      var thenCalled = false;
      var tree = runAnonFilter(sourcePath, {
          extensions: ['js']
        }, {
        processString: function(content, relativePath) {
          return {then: function(callback) {
            thenCalled = true;
            callback();
            return content;
          }};
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function(dir) {
        expect(thenCalled).to.be.ok();
      });
    });
  });
});
