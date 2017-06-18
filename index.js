/* eslint-disable max-statements, no-magic-numbers, no-undefined */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const promisify = require('es6-promisify');
const execa = require('execa');
const fse = require('fs-extra');
const FtpClient = require('ftp');
const recursiveReadDir = require('recursive-readdir');

const {name: packageName} = require('./package.json');

const mkdtemp = promisify(fs.mkdtemp);

const getLeaveDirectories = filePaths => {
  const leaves = new Set();
  filePaths.forEach(filePath => {
    const directory = path.dirname(filePath);
    if (directory === '.') {
      return;
    }
    if (leaves.size === 0) {
      leaves.add(directory);
    } else {
      const currentLeaves = Array.from(leaves);
      const falseLeaf = currentLeaves.find(
        potentialLeaf =>
          directory.length > potentialLeaf.length &&
          directory.startsWith(potentialLeaf)
      );
      if (falseLeaf === undefined) {
        const isLeaf = currentLeaves.every(leaf => !leaf.startsWith(directory));
        if (isLeaf) {
          leaves.add(directory);
        }
      } else {
        leaves.delete(falseLeaf);
        leaves.add(directory);
      }
    }
  });
  return Array.from(leaves);
};

const ftpDeployPackage = (packageDirectory, ftpConfig, handlers = {}) => {
  const beforeClosingConnection =
    handlers.beforeClosingConnection || (() => Promise.resolve());
  const beforeUpload = handlers.beforeUpload || (() => Promise.resolve());
  const onFileUploaded = handlers.onFileUploaded || (() => {});
  const updateStatus = handlers.onStatusUpdate || (() => {});

  updateStatus(`starting deployment of ${packageDirectory}`);

  const getSourceFiles = fse
    .readJson(path.join(packageDirectory, 'package.json'))
    .then(packageObj => packageObj.files.concat('package.json'));

  const createDeploymentDirectory = mkdtemp(
    path.join(os.tmpdir(), `${packageName}-`)
  ).then(deploymentDirectory => {
    updateStatus(`deployment directory ${deploymentDirectory} created`);
    return deploymentDirectory;
  });

  const getFilesToUpload = Promise.all([
    getSourceFiles,
    createDeploymentDirectory,
  ]).then(([sourceFiles, deploymentDirectory]) =>
    Promise.all(
      sourceFiles.map(filePath =>
        fse.copy(
          path.join(packageDirectory, filePath),
          path.join(deploymentDirectory, filePath)
        )
      )
    )
      .then(() => {
        updateStatus('installing npm dependencies');
        return execa('npm', ['install', '--production'], {
          cwd: deploymentDirectory,
        });
      })
      .then(() =>
        recursiveReadDir(path.join(deploymentDirectory, 'node_modules'))
      )
      .then(nodeModulesFiles =>
        nodeModulesFiles
          .filter(
            filePath =>
              // Only keep files...
              // eslint-disable-next-line no-sync
              fs.lstatSync(filePath).isFile() &&
              // That should be there...
              !filePath.includes('/test/') &&
              // And useful at run time.
              ['.js', '.json'].includes(path.extname(filePath))
          )
          .map(filePath => path.relative(deploymentDirectory, filePath))
      )
      .then(usefulNodeModulesFile => sourceFiles.concat(usefulNodeModulesFile))
  );

  const ftpConnect = Promise.resolve().then(() => {
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

    const res = client.on('ready').then(() => {
      updateStatus('FTP connection established');
      return client;
    });

    clientWithCallbacks.connect(ftpConfig);

    return res;
  });

  const upload = Promise.all([
    createDeploymentDirectory,
    getFilesToUpload,
    ftpConnect,
  ]).then(([deploymentDirectory, filesToUpload, ftpClient]) => {
    updateStatus('preparing remote directory structure');

    const remotePath = ftpConfig.path;
    const remoteDirectory = path.basename(remotePath);
    const leaveDirectories = getLeaveDirectories(filesToUpload);

    return ftpClient
      .cwd(path.dirname(remotePath))
      .then(() => ftpClient.rmdir(remoteDirectory, true))
      .then(() => ftpClient.mkdir(remoteDirectory))
      .then(() => ftpClient.cwd(remoteDirectory))
      .then(() =>
        Promise.all(
          leaveDirectories.map(directory => ftpClient.mkdir(directory, true))
        )
      )
      .then(() => beforeUpload(ftpClient, filesToUpload))
      .then(() => {
        updateStatus('uploading');
        return Promise.all(
          filesToUpload.map(filePath =>
            ftpClient
              .put(path.join(deploymentDirectory, filePath), filePath)
              .then(() => {
                onFileUploaded(filePath);
              })
          )
        );
      })
      .then(() =>
        beforeClosingConnection(ftpClient)
          .catch(err => {
            updateStatus('error while deploying');
            // eslint-disable-next-line no-console
            console.error(err);
          })
          .then(() => {
            ftpClient.end();
            return fse.remove(deploymentDirectory);
          })
      );
  });

  return upload;
};

module.exports = ftpDeployPackage;
