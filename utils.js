'use strict';

const fs = require('fs');
const path = require('path');

const promisify = require('es6-promisify');
const FtpClient = require('ftp');

const createFtpClient = () => {
  const clientWithCallbacks = new FtpClient();
  const client = {};

  [
    'cwd',
    'end',
    'get',
    'list',
    'mkdir',
    'on',
    'put',
    'rmdir',
  ].forEach(methodName => {
    client[methodName] = promisify(
      clientWithCallbacks[methodName].bind(clientWithCallbacks)
    );
  });

  client.connect = clientWithCallbacks.connect.bind(clientWithCallbacks);

  return client;
};

const getLeaveDirectories = filePaths => {
  const leaves = new Set();
  // eslint-disable-next-line max-statements
  filePaths.forEach(filePath => {
    const directory = path.dirname(filePath);
    if (directory === '.') {
      return;
    }
    if (leaves.size) {
      const currentLeaves = Array.from(leaves);
      const falseLeaf = currentLeaves.find(
        potentialLeaf =>
          directory.length > potentialLeaf.length &&
          directory.startsWith(potentialLeaf)
      );
      // eslint-disable-next-line no-undefined
      if (falseLeaf === undefined) {
        const isLeaf = currentLeaves.every(leaf => !leaf.startsWith(directory));
        if (isLeaf) {
          leaves.add(directory);
        }
      } else {
        leaves.delete(falseLeaf);
        leaves.add(directory);
      }
    } else {
      leaves.add(directory);
    }
  });
  return Array.from(leaves);
};

const isFileUsefulAtRuntime = filePath =>
  // Only keep files...
  // eslint-disable-next-line no-sync
  fs.lstatSync(filePath).isFile() &&
  // That should be there...
  !filePath.includes('/test/') &&
  // And useful at run time.
  ['.js', '.json'].includes(path.extname(filePath));

const normalizePathToLinux = filePath => filePath.replace(/\\/g, '/');

module.exports = {
  createFtpClient,
  getLeaveDirectories,
  isFileUsefulAtRuntime,
  normalizePathToLinux,
};
