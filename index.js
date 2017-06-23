'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const promisify = require('es6-promisify');
const execa = require('execa');
const fse = require('fs-extra');
const recursiveReadDir = require('recursive-readdir');

const {name: packageName} = require('./package.json');
const {
  createFtpClient,
  getLeaveDirectories,
  isFileUsefulAtRuntime,
  normalizePathToLinux,
} = require('./utils');

const mkdtemp = promisify(fs.mkdtemp);

const defaultHandlers = {
  beforeClosingConnection() {
    return Promise.resolve();
  },
  beforeUpload() {
    return Promise.resolve();
  },
  onFileUploaded() {},
  onStatusUpdate() {},
};

const ftpDeployPackage = (packageDirectory, ftpConfig, handlers = {}) => {
  const {
    beforeClosingConnection,
    beforeUpload,
    onFileUploaded,
    onStatusUpdate: updateStatus,
  } = Object.assign(defaultHandlers, handlers);

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
          .filter(isFileUsefulAtRuntime)
          .map(filePath => path.relative(deploymentDirectory, filePath))
      )
      .then(usefulNodeModulesFile => sourceFiles.concat(usefulNodeModulesFile))
      .then(filePaths => filePaths.map(normalizePathToLinux))
  );

  const ftpConnect = Promise.resolve().then(() => {
    const client = createFtpClient();

    const res = client.on('ready').then(() => {
      updateStatus('FTP connection established');
      return client;
    });

    client.connect(ftpConfig);

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
