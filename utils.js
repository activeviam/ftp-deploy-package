'use strict';

const path = require('path');

const decompress = require('decompress');
const promisify = require('es6-promisify');
const execa = require('execa');
const fse = require('fs-extra');
const FtpClient = require('ftp');

const packageDirectoryInTgz = 'package';
const copySourceFiles = (packageDirectory, distDirectory) =>
  execa('npm', ['pack'], {
    cwd: packageDirectory,
  })
    .then(({stdout: tgzFilename}) => {
      const tgzPath = path.join(packageDirectory, tgzFilename);
      return decompress(tgzPath, distDirectory).then(files =>
        fse.remove(tgzPath).then(() => files)
      );
    })
    .then(files =>
      files.map(file => path.relative(packageDirectoryInTgz, file.path))
    )
    .then(filePaths => ({
      directory: path.join(distDirectory, packageDirectoryInTgz),
      filePaths,
    }));

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
          directory.startsWith(`${potentialLeaf}/`)
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

const normalizePathToLinux = filePath => filePath.replace(/\\/g, '/');

module.exports = {
  copySourceFiles,
  createFtpClient,
  getLeaveDirectories,
  normalizePathToLinux,
};
